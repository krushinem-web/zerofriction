const express = require('express');
const multer = require('multer');
const speech = require('@google-cloud/speech');
const vision = require('@google-cloud/vision');
const Anthropic = require('@anthropic-ai/sdk');
const { v4: uuidv4 } = require('uuid');

const app = express();
const upload = multer({ limits: { fileSize: 8 * 1024 * 1024 } });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Configure Vision client - Railway uses automatic auth, local uses GOOGLE_CREDS
let visionClient;
try {
    if (process.env.GOOGLE_CREDS) {
        // Local development with explicit credentials
        visionClient = new vision.ImageAnnotatorClient({
            credentials: JSON.parse(process.env.GOOGLE_CREDS)
        });
    } else {
        // Railway/production - uses automatic authentication
        visionClient = new vision.ImageAnnotatorClient();
    }
} catch (error) {
    console.error('Vision client initialization error:', error.message);
    visionClient = new vision.ImageAnnotatorClient(); // Fallback to default
}

app.use(express.json());
app.use(express.static(__dirname));

// Server-side KrushProfile and Project Memory
let krushProfile = { aliases: {} }; // { "alias": "canonicalName" }
let activeProjects = {}; // { projectId: { masterList: [], counts: {} } }

// Vision OCR scan storage (in-memory MVP)
let scanResults = {}; // { scanId: { scanId, items, pages, createdAt, filenames } }

// Initialize with test data for verification
scanResults['test-scan-123'] = {
    scanId: 'test-scan-123',
    items: [
        { id: 'shrimp_skewer_sk', name: 'SHRIMP SKEWER (SK)', count: 0, page: 1, sourceLine: 15 },
        { id: 'chicken_breast', name: 'CHICKEN BREAST', count: 0, page: 1, sourceLine: 16 },
        { id: 'salmon_fillet_po', name: 'SALMON FILLET (PO)', count: 0, page: 1, sourceLine: 17 },
        { id: 'beef_tenderloin', name: 'BEEF TENDERLOIN', count: 0, page: 1, sourceLine: 18 },
        { id: 'pork_chop', name: 'PORK CHOP', count: 0, page: 1, sourceLine: 19 }
    ],
    pages: [{ filename: 'count_sheet.jpg', text: 'PROTEIN\n15 SHRIMP SKEWER (SK) 7\n16 CHICKEN BREAST 52\n17 SALMON FILLET (PO) 2\n18 BEEF TENDERLOIN 156\n19 PORK CHOP 23' }],
    createdAt: new Date().toISOString(),
    filenames: ['count_sheet.jpg']
};

// Image parsing endpoint
app.post('/parse', upload.array('images', 30), async (req, res) => {
    try {
        const images = req.files;
        if (!images || images.length === 0) {
            return res.status(400).json({ error: 'No images uploaded' });
        }

        // Use Claude Vision to extract inventory items from images
        const imageContents = images.map(img => ({
            type: 'image',
            source: {
                type: 'buffer',
                media_type: img.mimetype,
                data: img.buffer.toString('base64')
            }
        }));

        const aiResponse = await anthropic.messages.create({
            model: "claude-3-5-sonnet-20241022",
            max_tokens: 4096,
            messages: [{
                role: "user",
                content: [
                    ...imageContents,
                    {
                        type: 'text',
                        text: `Extract all inventory items from these prep sheet images. Return a JSON array of item names only. Format: {"items": ["item1", "item2", ...]}`
                    }
                ]
            }]
        });

        const parsed = JSON.parse(aiResponse.content[0].text);
        res.json({ items: parsed.items || [] });
    } catch (error) {
        console.error('Parse error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/daily-count/process', upload.single('audio'), async (req, res) => {
    const speechClient = new speech.SpeechClient();
    const { projectId } = req.body;
    const project = activeProjects[projectId];

    // 1 & 2) STT Perception
    const [response] = await speechClient.recognize({
        audio: { content: req.file.buffer.toString('base64') },
        config: { encoding: 'WEBM_OPUS', sampleRateHertz: 48000, languageCode: 'en-US' }
    });
    const transcript = response.results[0].alternatives[0].transcript.toLowerCase();

    // 3) Parse with Claude Intelligence (Item, Op, Qty)
    const aiResponse = await anthropic.messages.create({
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 300,
        messages: [{
            role: "user",
            content: `Extract from: "${transcript}". 
            Rules: Verb must be ADD, SUBTRACT, or SET. Quantity must be numeric.
            Return JSON: {"item": "string", "op": "ADD|SUBTRACT|SET", "qty": number}`
        }]
    });
    const parsed = JSON.parse(aiResponse.content[0].text);

    // 4) Matching Engine
    let target = null;
    if (krushProfile.aliases[parsed.item]) {
        target = krushProfile.aliases[parsed.item];
    } else if (project.masterList.includes(parsed.item)) {
        target = parsed.item;
    }

    // 5) Apply ONLY if single confident match exists
    if (target) {
        if (parsed.op === 'ADD') project.counts[target] = (project.counts[target] || 0) + parsed.qty;
        if (parsed.op === 'SUBTRACT') project.counts[target] = (project.counts[target] || 0) - parsed.qty;
        if (parsed.op === 'SET') project.counts[target] = parsed.qty;
        
        return res.json({ success: true, item: target, val: project.counts[target], transcript });
    }

    // NO-GUESSING: Return as Unresolved
    res.json({ success: false, unresolved: true, transcript, parsed });
});

// Helper function to extract countable items from Vision OCR results
// Stage 2: LLM Formatter - TEXT ONLY INPUT
async function formatItemsWithLLM(rawOcrText) {
    const prompt = `You are an inventory prep-sheet OCR formatter.

INPUT: raw OCR text from restaurant inventory/count sheets.

GOAL:
Extract ONLY the inventory ITEM NAMES and output them as a single vertical list,
top-to-bottom, exactly in the order they appear.

RULES:
1) Item names only - PRESERVE any parenthetical codes like (SK), (PO), (FR)
2) Preserve order exactly as it appears
3) No inference
4) Minimal typo fixes only
5) Exclude row numbers, quantities, and section headers like "PROTEIN" or "VEGETABLES"
6) One item per line, no bullets or numbering
7) Do NOT add any preamble or explanation - output ONLY the item names

OUTPUT FORMAT:
<item name>
<item name>

RAW OCR TEXT:
${rawOcrText}`;

    console.log('[LLM Formatter] Sending raw OCR text to Claude (text-only, no images)');
    console.log(`[LLM Formatter] Input length: ${rawOcrText.length} characters`);

    const response = await anthropic.messages.create({
        model: 'claude-3-haiku-20240307',
        max_tokens: 2000,
        messages: [{
            role: 'user',
            content: prompt  // TEXT ONLY - NO IMAGES, NO BUFFERS, NO BASE64
        }]
    });

    const llmOutput = response.content[0].text;
    console.log(`[LLM Formatter] Output length: ${llmOutput.length} characters`);
    console.log(`[LLM Formatter] Output:\n${llmOutput}`);

    return llmOutput;
}

// Stage 3: Post-LLM Validation
function validateLLMOutput(llmOutput) {
    const lines = llmOutput.trim().split('\n').filter(l => l.trim());
    
    console.log(`[Validation] Checking ${lines.length} lines`);
    
    const validItems = [];
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        
        // Skip preamble text (conversational phrases)
        if (/^(here|this|the following|below|above|note|please|i have|i've|let me)/i.test(line)) {
            console.log(`[Validation] Skipping preamble: "${line}"`);
            continue;
        }
        
        // Skip bullets or numbering
        if (/^[\d\.\-\*\•\·\)]/.test(line)) {
            console.log(`[Validation] Skipping numbered/bulleted line: "${line}"`);
            continue;
        }
        
        // Skip numeric-only
        if (/^\d+$/.test(line)) {
            console.log(`[Validation] Skipping numeric-only line: "${line}"`);
            continue;
        }
        
        // Skip if empty or too short
        if (line.length < 2) {
            console.log(`[Validation] Skipping too short: "${line}"`);
            continue;
        }
        
        // Section headers should already be filtered by LLM
        // Keep all remaining lines as valid items
        
        // This is a valid item name
        validItems.push(line);
    }
    
    console.log(`[Validation] ${validItems.length} valid items extracted from ${lines.length} lines`);
    return validItems;
}

// Helper function for Stage 4: Master List Alignment
// Uses deterministic matching - exact match or clear fuzzy match only
function alignWithMasterList(scannedItems, masterList) {
    console.log(`[Stage 4 Alignment] Matching ${scannedItems.length} scanned items against ${masterList.length} master items`);

    const matched = [];
    const unmatched = [];

    scannedItems.forEach(scannedItem => {
        const scannedName = scannedItem.toLowerCase().trim();

        // Try exact match first (case-insensitive)
        const exactMatch = masterList.find(masterItem =>
            masterItem.toLowerCase().trim() === scannedName
        );

        if (exactMatch) {
            matched.push({
                scannedName: scannedItem,
                masterName: exactMatch,
                matchType: 'exact',
                confidence: 1.0
            });
            console.log(`[Alignment] EXACT MATCH: "${scannedItem}" → "${exactMatch}"`);
            return;
        }

        // Try fuzzy match (simple Levenshtein-like similarity)
        let bestMatch = null;
        let bestSimilarity = 0;

        masterList.forEach(masterItem => {
            const similarity = calculateSimilarity(scannedName, masterItem.toLowerCase().trim());
            if (similarity > bestSimilarity) {
                bestSimilarity = similarity;
                bestMatch = masterItem;
            }
        });

        // Only accept fuzzy match if confidence is very high (>= 0.85)
        // This prevents false positives - ambiguity is rejected, not corrected
        if (bestSimilarity >= 0.85) {
            matched.push({
                scannedName: scannedItem,
                masterName: bestMatch,
                matchType: 'fuzzy',
                confidence: bestSimilarity
            });
            console.log(`[Alignment] FUZZY MATCH: "${scannedItem}" → "${bestMatch}" (${(bestSimilarity * 100).toFixed(0)}%)`);
        } else {
            unmatched.push({
                scannedName: scannedItem,
                suggestedMatch: bestSimilarity > 0.6 ? bestMatch : null,
                confidence: bestSimilarity
            });
            console.log(`[Alignment] UNMATCHED: "${scannedItem}" (best: "${bestMatch}" at ${(bestSimilarity * 100).toFixed(0)}%)`);
        }
    });

    console.log(`[Stage 4 Complete] ${matched.length} matched, ${unmatched.length} unmatched`);

    return { matched, unmatched };
}

// Simple string similarity calculation (Dice coefficient)
function calculateSimilarity(str1, str2) {
    if (str1 === str2) return 1.0;
    if (str1.length < 2 || str2.length < 2) return 0;

    const bigrams1 = new Set();
    for (let i = 0; i < str1.length - 1; i++) {
        bigrams1.add(str1.substring(i, i + 2));
    }

    const bigrams2 = new Set();
    for (let i = 0; i < str2.length - 1; i++) {
        bigrams2.add(str2.substring(i, i + 2));
    }

    const intersection = new Set([...bigrams1].filter(x => bigrams2.has(x)));
    return (2.0 * intersection.size) / (bigrams1.size + bigrams2.size);
}

// Google Cloud Vision OCR endpoint for document scanning
app.post('/vision/parse', upload.array('images', 30), async (req, res) => {
    try {
        const images = req.files;
        if (!images || images.length === 0) {
            return res.status(400).json({ error: 'No images uploaded' });
        }

        console.log(`[Vision OCR] Processing ${images.length} image(s)`);

        // Process each image with Google Cloud Vision
        const pages = [];

        for (let i = 0; i < images.length; i++) {
            const img = images[i];
            console.log(`[Vision OCR] Processing image ${i + 1}/${images.length}: ${img.originalname}`);

            // Construct Vision API request - CORRECT FORMAT
            const request = {
                image: {
                    content: img.buffer  // Raw buffer, NOT base64 string, NOT "type":"buffer" schema
                }
            };

            // Log request structure (without actual image data)
            console.log('[Vision OCR] Request structure:', JSON.stringify({
                image: {
                    content: `<Buffer ${img.buffer.length} bytes>`
                }
            }));

            // Call Vision API for document text detection
            const [result] = await visionClient.documentTextDetection(request);

            const fullText = result.fullTextAnnotation?.text || '';
            console.log(`[Vision OCR] Extracted ${fullText.length} characters from ${img.originalname}`);

            pages.push({
                filename: img.originalname,
                text: fullText
            });
        }

        // Stage 1 Complete: Raw OCR text extracted
        const rawOcrText = pages.map(p => p.text).join('\n\n');
        console.log(`[Stage 1 Complete] Extracted ${rawOcrText.length} characters from ${pages.length} page(s)`);

        // Stage 2: LLM Formatter (TEXT ONLY)
        console.log('[Stage 2] Sending raw OCR text to LLM formatter...');
        const llmOutput = await formatItemsWithLLM(rawOcrText);
        console.log('[Stage 2 Complete] LLM formatting complete');

        // Stage 3: Validation
        console.log('[Stage 3] Validating LLM output...');
        const itemNames = validateLLMOutput(llmOutput);
        console.log(`[Stage 3 Complete] Validated ${itemNames.length} items`);

        // Stage 4: Prepare response
        const items = itemNames.map((name, index) => ({
            id: `item_${index}`,
            name: name,
            count: 0
        }));
        console.log(`[Stage 4] Prepared ${items.length} items for UI`);

        // Generate scanId and store results
        const scanId = uuidv4();
        const filenames = images.map(img => img.originalname);

        scanResults[scanId] = {
            scanId,
            items,
            pages,
            createdAt: new Date().toISOString(),
            filenames
        };

        console.log(`[Vision OCR] Stored scan ${scanId} with ${items.length} items`);

        res.json({
            scanId,
            items,
            pages
        });
    } catch (error) {
        console.error(`[Error] ${error.stage || 'unknown'} stage failed:`, error.message);
        res.status(500).json({
            error: 'Processing failed',
            message: error.message,
            stage: error.stage || 'unknown'
        });
    }
});

// Update scan counts endpoint
app.post('/vision/update-counts', express.json(), (req, res) => {
    try {
        const { scanId, items } = req.body;
        
        if (!scanId || !items) {
            return res.status(400).json({ error: 'scanId and items required' });
        }
        
        const scan = scanResults[scanId];
        if (!scan) {
            return res.status(404).json({ error: 'Scan not found' });
        }
        
        // Update counts
        items.forEach(updatedItem => {
            const item = scan.items.find(i => i.id === updatedItem.id);
            if (item) {
                item.count = updatedItem.count;
            }
        });
        
        console.log(`[Vision OCR] Updated counts for scan ${scanId}`);
        res.json({ success: true });
        
    } catch (error) {
        console.error('[Vision OCR] Update counts error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Download scan results as CSV
app.get('/vision/download.csv', (req, res) => {
    try {
        const { scanId } = req.query;
        
        if (!scanId) {
            return res.status(400).json({ error: 'scanId parameter required' });
        }
        
        const scan = scanResults[scanId];
        if (!scan) {
            return res.status(404).json({ error: 'Scan not found' });
        }
        
        console.log(`[Vision OCR] Downloading CSV for scan ${scanId}`);
        
        // Generate CSV content: Single column with ItemName header and quoted values
        // Requirement: Every item name must be quoted, commas preserved, quotes escaped
        const escapeCSV = (value) => {
            // Escape double quotes by doubling them
            const escaped = value.replace(/"/g, '""');
            // Always wrap in double quotes
            return `"${escaped}"`;
        };
        
        const header = 'ItemName';
        const rows = scan.items.map(item => escapeCSV(item.name || ''));
        const csv = [header, ...rows].join('\n');
        
        // Set download headers
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="scan_${scanId}.csv"`);
        res.send(csv);
        
    } catch (error) {
        console.error('[Vision OCR] CSV download error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Download scan results as JSON
app.get('/vision/download.json', (req, res) => {
    try {
        const { scanId } = req.query;
        
        if (!scanId) {
            return res.status(400).json({ error: 'scanId parameter required' });
        }
        
        const scan = scanResults[scanId];
        if (!scan) {
            return res.status(404).json({ error: 'Scan not found' });
        }
        
        console.log(`[Vision OCR] Downloading JSON for scan ${scanId}`);
        
        // Set download headers
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="scan_${scanId}.json"`);
        res.json(scan);
        
    } catch (error) {
        console.error('[Vision OCR] JSON download error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Excel parsing endpoint (placeholder - requires xlsx library)
app.post('/parse-excel', upload.single('file'), async (req, res) => {
    try {
        // For now, return error indicating xlsx support needed
        res.status(501).json({ 
            error: 'Excel parsing not yet implemented',
            message: 'Please install xlsx library: npm install xlsx'
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// MASTER LIST PERSISTENCE ENDPOINTS
// ============================================
const fs = require('fs');
const path = require('path');

// Ensure data directory exists
const DATA_DIR = path.join(__dirname, 'data', 'projects');
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Validate project name (prevent path traversal)
function validateProjectName(name) {
    if (!name || typeof name !== 'string') {
        return false;
    }
    // Only allow letters, numbers, dash, underscore, and spaces
    const validPattern = /^[a-zA-Z0-9_\-\s]+$/;
    return validPattern.test(name) && name.length > 0 && name.length <= 100;
}

// Save master list to server
app.post('/projects/save-master-list', express.json(), (req, res) => {
    try {
        const { projectName, items } = req.body;
        
        // Validate project name
        if (!validateProjectName(projectName)) {
            return res.status(400).json({ 
                error: 'Invalid project name. Use only letters, numbers, dashes, underscores, and spaces.' 
            });
        }
        
        // Validate items
        if (!Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ error: 'Items must be a non-empty array' });
        }
        
        // Create project directory
        const projectDir = path.join(DATA_DIR, projectName.replace(/\s+/g, '_'));
        if (!fs.existsSync(projectDir)) {
            fs.mkdirSync(projectDir, { recursive: true });
        }
        
        // Save master list
        const masterListPath = path.join(projectDir, 'master_list.json');
        const data = {
            projectName,
            items,
            createdAt: new Date().toISOString(),
            itemCount: items.length
        };
        
        fs.writeFileSync(masterListPath, JSON.stringify(data, null, 2));
        
        console.log(`[Master List] Saved: ${projectName} (${items.length} items)`);
        res.json({ success: true, projectName, itemCount: items.length });
        
    } catch (error) {
        console.error('[Master List] Save error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Retrieve master list from server
app.get('/projects/:projectName/master-list', (req, res) => {
    try {
        const { projectName } = req.params;

        // Validate project name
        if (!validateProjectName(projectName)) {
            return res.status(400).json({ error: 'Invalid project name' });
        }

        const projectDir = path.join(DATA_DIR, projectName.replace(/\s+/g, '_'));
        const masterListPath = path.join(projectDir, 'master_list.json');

        if (!fs.existsSync(masterListPath)) {
            return res.status(404).json({ error: 'Master list not found' });
        }

        const data = JSON.parse(fs.readFileSync(masterListPath, 'utf8'));
        res.json(data);

    } catch (error) {
        console.error('[Master List] Retrieve error:', error);
        res.status(500).json({ error: error.message });
    }
});

// List all saved projects
app.get('/projects/list', (req, res) => {
    try {
        if (!fs.existsSync(DATA_DIR)) {
            return res.json({ projects: [] });
        }

        const projectDirs = fs.readdirSync(DATA_DIR);
        const projects = [];

        projectDirs.forEach(dirName => {
            const masterListPath = path.join(DATA_DIR, dirName, 'master_list.json');
            if (fs.existsSync(masterListPath)) {
                const data = JSON.parse(fs.readFileSync(masterListPath, 'utf8'));
                projects.push({
                    name: data.projectName,
                    itemCount: data.itemCount,
                    createdAt: data.createdAt
                });
            }
        });

        // Sort by most recent first
        projects.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

        res.json({ projects });

    } catch (error) {
        console.error('[Projects] List error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Stage 4: Align scanned items with master list
app.post('/vision/align-master-list', express.json(), (req, res) => {
    try {
        const { scanId, projectName } = req.body;

        if (!scanId) {
            return res.status(400).json({ error: 'scanId required' });
        }

        if (!projectName) {
            return res.status(400).json({ error: 'projectName required' });
        }

        // Get scan results
        const scan = scanResults[scanId];
        if (!scan) {
            return res.status(404).json({ error: 'Scan not found' });
        }

        // Load master list
        if (!validateProjectName(projectName)) {
            return res.status(400).json({ error: 'Invalid project name' });
        }

        const projectDir = path.join(DATA_DIR, projectName.replace(/\s+/g, '_'));
        const masterListPath = path.join(projectDir, 'master_list.json');

        if (!fs.existsSync(masterListPath)) {
            return res.status(404).json({ error: 'Master list not found for this project' });
        }

        const masterData = JSON.parse(fs.readFileSync(masterListPath, 'utf8'));
        const masterList = masterData.items;

        // Extract scanned item names
        const scannedItemNames = scan.items.map(item => item.name);

        // Perform Stage 4: Master List Alignment
        const alignment = alignWithMasterList(scannedItemNames, masterList);

        // Store alignment results in scan
        scanResults[scanId].alignment = alignment;
        scanResults[scanId].projectName = projectName;
        scanResults[scanId].masterList = masterList;

        console.log(`[Alignment] Completed for scan ${scanId} with project "${projectName}"`);

        res.json({
            success: true,
            alignment,
            masterList
        });

    } catch (error) {
        console.error('[Alignment] Error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// VOICE MAPPING / ALIAS MANAGEMENT ENDPOINTS
// ============================================

// Save voice aliases for a project
app.post('/projects/:projectName/aliases', express.json(), (req, res) => {
    try {
        const { projectName } = req.params;
        const { aliases } = req.body;

        if (!validateProjectName(projectName)) {
            return res.status(400).json({ error: 'Invalid project name' });
        }

        if (!aliases || typeof aliases !== 'object') {
            return res.status(400).json({ error: 'Aliases must be an object' });
        }

        const projectDir = path.join(DATA_DIR, projectName.replace(/\s+/g, '_'));
        if (!fs.existsSync(projectDir)) {
            return res.status(404).json({ error: 'Project not found' });
        }

        // Save aliases to file
        const aliasesPath = path.join(projectDir, 'aliases.json');
        const data = {
            projectName,
            aliases,
            updatedAt: new Date().toISOString()
        };

        fs.writeFileSync(aliasesPath, JSON.stringify(data, null, 2));

        console.log(`[Aliases] Saved ${Object.keys(aliases).length} aliases for project "${projectName}"`);

        res.json({ success: true, aliasCount: Object.keys(aliases).length });

    } catch (error) {
        console.error('[Aliases] Save error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Retrieve voice aliases for a project
app.get('/projects/:projectName/aliases', (req, res) => {
    try {
        const { projectName } = req.params;

        if (!validateProjectName(projectName)) {
            return res.status(400).json({ error: 'Invalid project name' });
        }

        const projectDir = path.join(DATA_DIR, projectName.replace(/\s+/g, '_'));
        const aliasesPath = path.join(projectDir, 'aliases.json');

        if (!fs.existsSync(aliasesPath)) {
            // Return empty aliases if none saved yet
            return res.json({ projectName, aliases: {}, updatedAt: null });
        }

        const data = JSON.parse(fs.readFileSync(aliasesPath, 'utf8'));
        res.json(data);

    } catch (error) {
        console.error('[Aliases] Retrieve error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// LIVE COUNT ENDPOINTS (Browser-based voice recognition)
// ============================================

// Parse voice command using Claude API (client sends transcript, not audio)
app.post('/live-count/parse-command', express.json(), async (req, res) => {
    try {
        const { transcript, masterList, aliases } = req.body;

        if (!transcript) {
            return res.status(400).json({ error: 'Transcript required' });
        }

        if (!masterList || !Array.isArray(masterList)) {
            return res.status(400).json({ error: 'Master list required' });
        }

        console.log(`[Live Count Parse] Transcript: "${transcript}"`);
        console.log(`[Live Count Parse] Master list: ${masterList.length} items`);
        console.log(`[Live Count Parse] Aliases: ${Object.keys(aliases || {}).length} mappings`);

        // Use Claude API to parse voice command
        const aiResponse = await anthropic.messages.create({
            model: "claude-3-5-sonnet-20241022",
            max_tokens: 300,
            messages: [{
                role: "user",
                content: `You are a voice command parser for inventory counting.

TRANSCRIPT: "${transcript}"

RULES:
1. Extract: item name, operation (ADD/SUBTRACT/SET), and quantity (number)
2. Operation MUST be one of: ADD, SUBTRACT, SET
3. Quantity MUST be a positive number
4. If the command is unclear or missing any part, return {"error": "description"}
5. Be lenient with phrasing but strict about having all three parts

EXAMPLES:
- "add 5 shrimp" → {"item": "shrimp", "operation": "ADD", "quantity": 5}
- "set chicken to 100" → {"item": "chicken", "operation": "SET", "quantity": 100}
- "subtract 3 salmon" → {"item": "salmon", "operation": "SUBTRACT", "quantity": 3}

Return ONLY valid JSON in this format:
{"item": "string", "operation": "ADD|SUBTRACT|SET", "quantity": number}

Or if error:
{"error": "description of what's missing or unclear"}`
            }]
        });

        const parsedText = aiResponse.content[0].text.trim();
        console.log(`[Live Count Parse] Claude response: ${parsedText}`);

        let parsed;
        try {
            parsed = JSON.parse(parsedText);
        } catch (e) {
            console.error('[Live Count Parse] Failed to parse Claude response as JSON');
            return res.json({
                success: false,
                error: 'Could not parse voice command'
            });
        }

        // If Claude returned an error
        if (parsed.error) {
            console.log(`[Live Count Parse] Claude error: ${parsed.error}`);
            return res.json({
                success: false,
                error: parsed.error
            });
        }

        // Validate parsed data
        if (!parsed.item || !parsed.operation || parsed.quantity === undefined) {
            return res.json({
                success: false,
                error: 'Invalid command format'
            });
        }

        // Match item against master list and aliases
        const itemLower = parsed.item.toLowerCase().trim();
        let matchedItem = null;

        // Check aliases first
        if (aliases) {
            for (const [masterItem, aliasList] of Object.entries(aliases)) {
                if (aliasList.some(alias => alias.toLowerCase().trim() === itemLower)) {
                    matchedItem = masterItem;
                    console.log(`[Live Count Parse] ALIAS MATCH: "${parsed.item}" → "${masterItem}"`);
                    break;
                }
            }
        }

        // Check master list if no alias match
        if (!matchedItem) {
            matchedItem = masterList.find(item =>
                item.toLowerCase().trim() === itemLower
            );
            if (matchedItem) {
                console.log(`[Live Count Parse] MASTER LIST MATCH: "${parsed.item}" → "${matchedItem}"`);
            }
        }

        // If no match found
        if (!matchedItem) {
            console.log(`[Live Count Parse] NO MATCH for "${parsed.item}"`);
            return res.json({
                success: false,
                error: 'Item not found in master list'
            });
        }

        // Success!
        console.log(`[Live Count Parse] SUCCESS: ${parsed.operation} ${parsed.quantity} ${matchedItem}`);
        res.json({
            success: true,
            item: matchedItem,
            operation: parsed.operation,
            quantity: parsed.quantity
        });

    } catch (error) {
        console.error('[Live Count Parse] Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Autosave Live Count state (3-minute interval)
app.post('/live-count/autosave', express.json(), async (req, res) => {
    try {
        const { projectName, masterList, counts, timestamp } = req.body;

        if (!projectName || !validateProjectName(projectName)) {
            return res.status(400).json({ error: 'Valid project name required' });
        }

        console.log(`[Live Count Autosave] Project: "${projectName}"`);

        const projectDir = path.join(DATA_DIR, projectName.replace(/\s+/g, '_'));
        if (!fs.existsSync(projectDir)) {
            fs.mkdirSync(projectDir, { recursive: true });
        }

        // Save counts to autosave file
        const autosavePath = path.join(projectDir, 'live_count_autosave.json');
        const data = {
            projectName,
            masterList,
            counts,
            timestamp,
            savedAt: new Date().toISOString()
        };

        fs.writeFileSync(autosavePath, JSON.stringify(data, null, 2));

        console.log(`[Live Count Autosave] Saved at ${data.savedAt}`);
        res.json({ success: true, savedAt: data.savedAt });

    } catch (error) {
        console.error('[Live Count Autosave] Error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Manual save Live Count state
app.post('/live-count/save', express.json(), async (req, res) => {
    try {
        const { projectName, masterList, counts, timestamp } = req.body;

        if (!projectName || !validateProjectName(projectName)) {
            return res.status(400).json({ error: 'Valid project name required' });
        }

        console.log(`[Live Count Manual Save] Project: "${projectName}"`);

        const projectDir = path.join(DATA_DIR, projectName.replace(/\s+/g, '_'));
        if (!fs.existsSync(projectDir)) {
            fs.mkdirSync(projectDir, { recursive: true });
        }

        // Save to manual save file (separate from autosave)
        const savePath = path.join(projectDir, 'live_count.json');
        const data = {
            projectName,
            masterList,
            counts,
            timestamp,
            savedAt: new Date().toISOString()
        };

        fs.writeFileSync(savePath, JSON.stringify(data, null, 2));

        console.log(`[Live Count Manual Save] Saved at ${data.savedAt}`);
        res.json({ success: true, savedAt: data.savedAt });

    } catch (error) {
        console.error('[Live Count Manual Save] Error:', error);
        res.status(500).json({ error: error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
