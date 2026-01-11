const express = require('express');
const multer = require('multer');
const vision = require('@google-cloud/vision');
const speech = require('@google-cloud/speech');
const Anthropic = require('@anthropic-ai/sdk');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');

const app = express();
const upload = multer({ limits: { fileSize: 8 * 1024 * 1024 } });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Google Cloud Speech Request Queue - prevent simultaneous calls
class RequestQueue {
    constructor() {
        this.queue = [];
        this.processing = false;
    }

    async add(fn) {
        return new Promise((resolve, reject) => {
            this.queue.push({ fn, resolve, reject });
            this.process();
        });
    }

    async process() {
        if (this.processing || this.queue.length === 0) return;

        this.processing = true;
        const { fn, resolve, reject } = this.queue.shift();

        try {
            const result = await fn();
            resolve(result);
        } catch (error) {
            reject(error);
        } finally {
            this.processing = false;
            this.process(); // Process next item
        }
    }
}

const speechQueue = new RequestQueue();

// Configure Google Cloud Speech client
let speechClient;
try {
    if (process.env.GOOGLE_CREDS) {
        // Local development with explicit credentials
        speechClient = new speech.SpeechClient({
            credentials: JSON.parse(process.env.GOOGLE_CREDS)
        });
    } else {
        // Railway/production - uses automatic authentication
        speechClient = new speech.SpeechClient();
    }
} catch (error) {
    console.error('Speech client initialization error:', error.message);
    speechClient = new speech.SpeechClient(); // Fallback to default
}

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

// LEGACY ENDPOINT - Replaced by /audio/transcribe-live-count (uses OpenAI instead of Google Cloud Speech)
// app.post('/daily-count/process', upload.single('audio'), async (req, res) => {
//     const speechClient = new speech.SpeechClient();
//     const { projectId } = req.body;
//     const project = activeProjects[projectId];
//
//     // 1 & 2) STT Perception
//     const [response] = await speechClient.recognize({
//         audio: { content: req.file.buffer.toString('base64') },
//         config: { encoding: 'WEBM_OPUS', sampleRateHertz: 48000, languageCode: 'en-US' }
//     });
//     const transcript = response.results[0].alternatives[0].transcript.toLowerCase();
//
//     // 3) Parse with Claude Intelligence (Item, Op, Qty)
//     const aiResponse = await anthropic.messages.create({
//         model: "claude-3-5-sonnet-20241022",
//         max_tokens: 300,
//         messages: [{
//             role: "user",
//             content: `Extract from: "${transcript}".
//             Rules: Verb must be ADD, SUBTRACT, or SET. Quantity must be numeric.
//             Return JSON: {"item": "string", "op": "ADD|SUBTRACT|SET", "qty": number}`
//         }]
//     });
//     const parsed = JSON.parse(aiResponse.content[0].text);
//
//     // 4) Matching Engine
//     let target = null;
//     if (krushProfile.aliases[parsed.item]) {
//         target = krushProfile.aliases[parsed.item];
//     } else if (project.masterList.includes(parsed.item)) {
//         target = parsed.item;
//     }
//
//     // 5) Apply ONLY if single confident match exists
//     if (target) {
//         if (parsed.op === 'ADD') project.counts[target] = (project.counts[target] || 0) + parsed.qty;
//         if (parsed.op === 'SUBTRACT') project.counts[target] = (project.counts[target] || 0) - parsed.qty;
//         if (parsed.op === 'SET') project.counts[target] = parsed.qty;
//
//         return res.json({ success: true, item: target, val: project.counts[target], transcript });
//     }
//
//     // NO-GUESSING: Return as Unresolved
//     res.json({ success: false, unresolved: true, transcript, parsed });
// });

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
// Uses constrained intent-resolution engine for maximum accuracy
app.post('/live-count/parse-command', express.json(), async (req, res) => {
    try {
        const { transcript, masterList, aliases, recentContext } = req.body;

        if (!transcript) {
            return res.status(400).json({ error: 'Transcript required' });
        }

        if (!masterList || !Array.isArray(masterList)) {
            return res.status(400).json({ error: 'Master list required' });
        }

        console.log(`[Live Count Parse] Transcript: "${transcript}"`);
        console.log(`[Live Count Parse] Master list: ${masterList.length} items`);
        console.log(`[Live Count Parse] Aliases: ${Object.keys(aliases || {}).length} mappings`);

        // Build alias context for Claude
        const aliasContext = [];
        if (aliases) {
            for (const [masterItem, aliasList] of Object.entries(aliases)) {
                if (aliasList && aliasList.length > 0) {
                    aliasContext.push(`${masterItem}: ${aliasList.join(', ')}`);
                }
            }
        }

        // Use Claude API with constrained intent-resolution prompt
        const aiResponse = await anthropic.messages.create({
            model: "claude-3-5-sonnet-20241022",
            max_tokens: 500,
            messages: [{
                role: "user",
                content: `You are a constrained intent-resolution engine for a voice-driven counting system.

IMPORTANT:
You are NOT a speech recognizer.
You are NOT allowed to invent items.
You may ONLY choose from the provided candidate lists.

Your job is to resolve user intent from imperfect voice transcription by choosing the most plausible interpretation under strict constraints.

––––––––––––––––––––
INPUT
––––––––––––––––––––

TRANSCRIPT: "${transcript}"

VALID CANDIDATE ITEMS (canonical inventory items):
${masterList.join('\n')}

${aliasContext.length > 0 ? `KNOWN VOICE ALIASES:\n${aliasContext.join('\n')}` : ''}

${recentContext ? `RECENT CONTEXT: ${recentContext}` : ''}

––––––––––––––––––––
ABSOLUTE RULES (NON-NEGOTIABLE)
––––––––––––––––––––

• You may ONLY output a canonical item that exists in the candidate list.
• You may NOT invent, rename, or modify item names.
• If no candidate is plausible, return canonicalItem: "UNMAPPED".
• If confidence is low, mark needsConfirmation: true.
• Output JSON ONLY. No commentary. No markdown.

––––––––––––––––––––
VERB INTERPRETATION RULES
––––––––––––––––––––

Normalize operations as:

ADD       → increase existing count
SUBTRACT  → decrease existing count (minimum 0)
SET       → overwrite existing count
ERASE     → equivalent to SET with value 0

Notes:
• "at", "equals", "is" → usually SET
• "add", "plus", "and" → ADD
• "take away", "minus", "subtract" → SUBTRACT
• "erase", "clear", "zero" → ERASE
• If unclear, choose the most conservative interpretation.

––––––––––––––––––––
NUMBER HANDLING RULES
––––––––––––––––––––

• Combine multiple numbers ONLY if speech implies addition (e.g., "34 plus 34" → 68)
• Do NOT invent numbers
• If no valid number is present, set value = null

––––––––––––––––––––
CONFIDENCE RULES
––––––––––––––––––––

Return a confidence score from 0.00 to 1.00 based on:
• Strength of match between item phrase and chosen item
• Clarity of verb
• Clarity of number interpretation
• Use of recent context (if provided)

Guidelines:
≥ 0.85 → confident (needsConfirmation: false)
0.60–0.84 → plausible but needs confirmation (needsConfirmation: true)
< 0.60 → UNMAPPED

––––––––––––––––––––
ALIAS LEARNING RULE
––––––––––––––––––––

If the spoken item phrase clearly maps to a canonical item but isn't in the alias list, return an aliasToSave value so the system can store it permanently.

Example:
spoken: "rebs"
canonical: "Ribs"
aliasToSave: "rebs"

––––––––––––––––––––
OUTPUT FORMAT (STRICT)
––––––––––––––––––––

Return EXACTLY this JSON structure:

{
  "canonicalItem": "string | UNMAPPED",
  "operation": "ADD | SUBTRACT | SET | ERASE | null",
  "value": number | null,
  "confidence": number,
  "needsConfirmation": boolean,
  "aliasToSave": "string | null"
}

––––––––––––––––––––
DECISION PRIORITY ORDER
––––––––––––––––––––

1) Exact alias match (if provided)
2) Strong phonetic similarity to candidate items
3) Fuzzy textual similarity to candidate items
4) Recent context (if provided)
5) If still unclear → UNMAPPED

Never guess outside the candidate list.
Never hallucinate.
Never optimize for convenience over correctness.`
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

        // Handle UNMAPPED response
        if (parsed.canonicalItem === 'UNMAPPED') {
            console.log(`[Live Count Parse] UNMAPPED - confidence too low or no match`);
            return res.json({
                success: false,
                error: 'Could not identify item from master list',
                unmapped: true
            });
        }

        // Validate canonical item exists in master list
        const matchedItem = masterList.find(item =>
            item.toLowerCase().trim() === parsed.canonicalItem.toLowerCase().trim()
        );

        if (!matchedItem) {
            console.log(`[Live Count Parse] ERROR: Claude returned item not in master list: "${parsed.canonicalItem}"`);
            return res.json({
                success: false,
                error: 'Invalid item returned'
            });
        }

        // Success!
        console.log(`[Live Count Parse] SUCCESS: ${parsed.operation} ${parsed.value} ${matchedItem} (confidence: ${parsed.confidence})`);

        res.json({
            success: true,
            item: matchedItem,
            operation: parsed.operation,
            quantity: parsed.value,
            confidence: parsed.confidence,
            needsConfirmation: parsed.needsConfirmation,
            aliasToSave: parsed.aliasToSave
        });

    } catch (error) {
        console.error('[Live Count Parse] Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Helper: Parse operation from transcript
function parseOperation(transcript) {
    const lower = transcript.toLowerCase();

    if (/\b(erase|clear|delete|zero)\b/.test(lower)) return 'ERASE';
    if (/\b(add|plus|and)\b/.test(lower)) return 'ADD';
    if (/\b(subtract|minus|take away|remove)\b/.test(lower)) return 'SUBTRACT';
    if (/\b(at|equals|is|set)\b/.test(lower)) return 'SET';

    // Default to SET if no clear operation
    return 'SET';
}

// Helper: Extract number from transcript
function extractNumber(transcript) {
    // Handle written numbers
    const numberWords = {
        'zero': 0, 'one': 1, 'two': 2, 'three': 3, 'four': 4,
        'five': 5, 'six': 6, 'seven': 7, 'eight': 8, 'nine': 9,
        'ten': 10, 'eleven': 11, 'twelve': 12, 'thirteen': 13,
        'fourteen': 14, 'fifteen': 15, 'sixteen': 16, 'seventeen': 17,
        'eighteen': 18, 'nineteen': 19, 'twenty': 20, 'thirty': 30,
        'forty': 40, 'fifty': 50, 'sixty': 60, 'seventy': 70,
        'eighty': 80, 'ninety': 90, 'hundred': 100
    };

    // Try to find digit sequences first
    const digitMatch = transcript.match(/\b\d+\b/);
    if (digitMatch) {
        return parseInt(digitMatch[0], 10);
    }

    // Try to find written numbers
    const words = transcript.toLowerCase().split(/\s+/);
    for (const word of words) {
        if (numberWords[word] !== undefined) {
            return numberWords[word];
        }
    }

    return null;
}

// Helper: Current Protocol Resolution (simple matching)
function resolveCurrentProtocol(transcript, masterListCandidates, aliasDictionary) {
    const lower = transcript.toLowerCase().trim();

    // 1. Try exact alias match
    for (const [canonical, aliases] of Object.entries(aliasDictionary)) {
        if (aliases && Array.isArray(aliases)) {
            for (const alias of aliases) {
                if (lower.includes(alias.toLowerCase())) {
                    return {
                        canonicalItem: canonical,
                        confidence: 0.95,
                        matchType: 'alias'
                    };
                }
            }
        }
    }

    // 2. Try exact match in master list
    for (const item of masterListCandidates) {
        if (lower.includes(item.toLowerCase())) {
            return {
                canonicalItem: item,
                confidence: 0.90,
                matchType: 'exact'
            };
        }
    }

    // 3. Try fuzzy match (simple)
    let bestMatch = null;
    let bestSimilarity = 0;

    for (const item of masterListCandidates) {
        const similarity = calculateSimilarity(lower, item.toLowerCase());
        if (similarity > bestSimilarity) {
            bestSimilarity = similarity;
            bestMatch = item;
        }
    }

    if (bestSimilarity >= 0.70) {
        return {
            canonicalItem: bestMatch,
            confidence: bestSimilarity,
            matchType: 'fuzzy'
        };
    }

    return {
        canonicalItem: 'UNMAPPED',
        confidence: 0,
        matchType: 'none'
    };
}

// Helper: New Protocol Resolution (with alternatives and better ambiguity handling)
function resolveNewProtocol(transcript, alternatives, masterListCandidates, aliasDictionary, recentContext) {
    const allTranscripts = [transcript, ...alternatives];
    const topChoices = new Set();

    // Try each transcript variant
    const results = allTranscripts.map(trans => {
        const lower = trans.toLowerCase().trim();

        // 1. Alias match
        for (const [canonical, aliases] of Object.entries(aliasDictionary)) {
            if (aliases && Array.isArray(aliases)) {
                for (const alias of aliases) {
                    if (lower.includes(alias.toLowerCase())) {
                        topChoices.add(canonical);
                        return {
                            canonicalItem: canonical,
                            confidence: 0.95,
                            source: 'alias'
                        };
                    }
                }
            }
        }

        // 2. Exact match
        for (const item of masterListCandidates) {
            if (lower.includes(item.toLowerCase())) {
                topChoices.add(item);
                return {
                    canonicalItem: item,
                    confidence: 0.90,
                    source: 'exact'
                };
            }
        }

        // 3. Fuzzy/phonetic match
        let bestMatch = null;
        let bestSimilarity = 0;

        for (const item of masterListCandidates) {
            const similarity = calculateSimilarity(lower, item.toLowerCase());
            if (similarity > bestSimilarity) {
                bestSimilarity = similarity;
                bestMatch = item;
            }
        }

        if (bestMatch && bestSimilarity >= 0.60) {
            topChoices.add(bestMatch);
            return {
                canonicalItem: bestMatch,
                confidence: bestSimilarity,
                source: 'fuzzy'
            };
        }

        return {
            canonicalItem: 'UNMAPPED',
            confidence: 0,
            source: 'none'
        };
    });

    // Pick best result
    results.sort((a, b) => b.confidence - a.confidence);
    const best = results[0];

    // Build top 3 choices
    const topChoicesArray = Array.from(topChoices).slice(0, 3);
    while (topChoicesArray.length < 3) {
        topChoicesArray.push('UNMAPPED');
    }

    return {
        canonicalItem: best.canonicalItem,
        confidence: best.confidence,
        matchType: best.source,
        topChoices: topChoicesArray
    };
}

// Side-by-Side Protocol Comparator for Voice Mapping (ALWAYS maps to target item)
function compareProtocolsForVoiceMapping(transcript, alternatives, targetItem, aliasDictionary, rawAudioMeta) {
    // In Voice Mapping, we're TRAINING - whatever is said should map to the target item
    // We just compare HOW the two protocols would transcribe/parse it

    const operation = parseOperation(transcript);
    const value = operation === 'ERASE' ? 0 : extractNumber(transcript);

    // PROTOCOL 1: Current Installed
    // Simple match - just shows the transcript
    const returnCurrentInstalled = {
        recording: {
            endOnPauseRequired: true,
            vadDetected: rawAudioMeta?.vadPauseMs != null,
            vadPauseMs: rawAudioMeta?.vadPauseMs || null,
            vadAssumed: rawAudioMeta?.vadPauseMs == null
        },
        inputUsed: {
            transcript: transcript,
            confidence: null
        },
        resolution: {
            canonicalItem: targetItem,  // ALWAYS the target item in Voice Mapping
            operation: operation,
            value: value,
            confidence: 1.0,  // We're training, so confidence is always 100%
            needsConfirmation: false,  // No confirmation needed in training mode
            topChoices: [targetItem, targetItem, targetItem]
        },
        alias: {
            shouldAutoSave: true,  // Always save in Voice Mapping
            aliasToSave: transcript.toLowerCase().trim()
        }
    };

    // PROTOCOL 2: New (Google STT + alternatives)
    // Uses alternatives for better transcription
    const returnNewGoogleStt = {
        recording: {
            endOnPauseRequired: true,
            vadDetected: rawAudioMeta?.vadPauseMs != null,
            vadPauseMs: rawAudioMeta?.vadPauseMs || null,
            vadAssumed: rawAudioMeta?.vadPauseMs == null,
            endOfUtteranceMs: rawAudioMeta?.endOfUtteranceMs || null
        },
        inputUsed: {
            transcript: transcript,
            alternativesUsed: alternatives.slice(0, 3),
            wordConfidencesPresent: false
        },
        resolution: {
            canonicalItem: targetItem,  // ALWAYS the target item in Voice Mapping
            operation: operation,
            value: value,
            confidence: 1.0,  // We're training, so confidence is always 100%
            needsConfirmation: false,  // No confirmation needed in training mode
            topChoices: [targetItem, targetItem, targetItem]
        },
        alias: {
            shouldAutoSave: true,  // Always save in Voice Mapping
            aliasToSave: transcript.toLowerCase().trim()
        }
    };

    // Comparison flags - mostly about transcription differences
    const comparisonFlags = {
        differentCanonicalItem: false,  // Always the same (target item)
        differentOperation: false,
        differentValue: false,
        currentWouldSilentlyCommit: true,  // Both auto-save in Voice Mapping
        newWouldRequestConfirmation: false,
        aliasWouldBeSavedInNewButNotCurrent: false,
        notes: [
            'Voice Mapping mode: Training alias for "' + targetItem + '"',
            'Transcript: "' + transcript + '"',
            alternatives.length > 0 ? 'Alternatives: ' + alternatives.join(', ') : 'No alternatives available'
        ]
    };

    return {
        return_current_installed: returnCurrentInstalled,
        return_new_googleStt_plus_chatgpt_ambiguity: returnNewGoogleStt,
        comparisonFlags: comparisonFlags
    };
}

// Side-by-Side Protocol Comparator (implemented directly, no file reading)
function compareProtocols(transcript, alternatives, masterListCandidates, aliasDictionary, recentContext, rawAudioMeta) {
    // PROTOCOL 1: Current Installed
    const currentResult = resolveCurrentProtocol(transcript, masterListCandidates, aliasDictionary);
    const currentOperation = parseOperation(transcript);
    const currentValue = currentOperation === 'ERASE' ? 0 : extractNumber(transcript);

    const returnCurrentInstalled = {
        recording: {
            endOnPauseRequired: true,
            vadDetected: rawAudioMeta?.vadPauseMs != null,
            vadPauseMs: rawAudioMeta?.vadPauseMs || null,
            vadAssumed: rawAudioMeta?.vadPauseMs == null
        },
        inputUsed: {
            transcript: transcript,
            confidence: null
        },
        resolution: {
            canonicalItem: currentResult.canonicalItem,
            operation: currentOperation,
            value: currentValue,
            confidence: currentResult.confidence,
            needsConfirmation: currentResult.confidence < 0.85,
            topChoices: [
                currentResult.canonicalItem !== 'UNMAPPED' ? currentResult.canonicalItem : 'UNMAPPED',
                'UNMAPPED',
                'UNMAPPED'
            ]
        },
        alias: {
            shouldAutoSave: false,
            aliasToSave: null
        }
    };

    // PROTOCOL 2: New (Google STT + ChatGPT ambiguity)
    const newResult = resolveNewProtocol(transcript, alternatives, masterListCandidates, aliasDictionary, recentContext);
    const newOperation = parseOperation(transcript);
    const newValue = newOperation === 'ERASE' ? 0 : extractNumber(transcript);

    const returnNewGoogleStt = {
        recording: {
            endOnPauseRequired: true,
            vadDetected: rawAudioMeta?.vadPauseMs != null,
            vadPauseMs: rawAudioMeta?.vadPauseMs || null,
            vadAssumed: rawAudioMeta?.vadPauseMs == null,
            endOfUtteranceMs: rawAudioMeta?.endOfUtteranceMs || null
        },
        inputUsed: {
            transcript: transcript,
            alternativesUsed: alternatives.slice(0, 3),
            wordConfidencesPresent: false
        },
        resolution: {
            canonicalItem: newResult.canonicalItem,
            operation: newOperation,
            value: newValue,
            confidence: newResult.confidence,
            needsConfirmation: newResult.confidence < 0.85,
            topChoices: newResult.topChoices
        },
        alias: {
            shouldAutoSave: newResult.confidence >= 0.85 && newResult.canonicalItem !== 'UNMAPPED',
            aliasToSave: newResult.confidence >= 0.85 && newResult.canonicalItem !== 'UNMAPPED' ?
                transcript.toLowerCase().trim() : null
        }
    };

    // Comparison flags
    const comparisonFlags = {
        differentCanonicalItem: returnCurrentInstalled.resolution.canonicalItem !== returnNewGoogleStt.resolution.canonicalItem,
        differentOperation: returnCurrentInstalled.resolution.operation !== returnNewGoogleStt.resolution.operation,
        differentValue: returnCurrentInstalled.resolution.value !== returnNewGoogleStt.resolution.value,
        currentWouldSilentlyCommit: !returnCurrentInstalled.resolution.needsConfirmation && returnCurrentInstalled.resolution.canonicalItem !== 'UNMAPPED',
        newWouldRequestConfirmation: returnNewGoogleStt.resolution.needsConfirmation,
        aliasWouldBeSavedInNewButNotCurrent: returnNewGoogleStt.alias.shouldAutoSave && !returnCurrentInstalled.alias.shouldAutoSave,
        notes: []
    };

    if (comparisonFlags.differentCanonicalItem) {
        comparisonFlags.notes.push(`Different items: Current="${returnCurrentInstalled.resolution.canonicalItem}" vs New="${returnNewGoogleStt.resolution.canonicalItem}"`);
    }
    if (comparisonFlags.currentWouldSilentlyCommit && comparisonFlags.newWouldRequestConfirmation) {
        comparisonFlags.notes.push('New protocol prevents silent commit that current would allow');
    }

    return {
        return_current_installed: returnCurrentInstalled,
        return_new_googleStt_plus_chatgpt_ambiguity: returnNewGoogleStt,
        comparisonFlags: comparisonFlags
    };
}

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

// ============================================
// GOOGLE CLOUD SPEECH TRANSCRIPTION ENDPOINTS
// ============================================

// Audio transcription for Live Count - WITH SIDE-BY-SIDE PROTOCOL COMPARISON
app.post('/audio/transcribe-live-count', upload.single('audio'), async (req, res) => {
    const requestId = uuidv4().substring(0, 8);
    const startTime = Date.now();

    console.log(`🎤 [${requestId}] HIT /audio/transcribe-live-count at ${new Date().toISOString()}`);

    try {
        if (!req.file) {
            console.log(`❌ [${requestId}] No audio file in request`);
            return res.status(400).json({ error: 'No audio file provided' });
        }

        // Parse additional form data (sent alongside audio)
        const masterListCandidates = req.body.masterListCandidates ? JSON.parse(req.body.masterListCandidates) : null;
        const aliasDictionary = req.body.aliasDictionary ? JSON.parse(req.body.aliasDictionary) : {};
        const recentContext = req.body.recentContext ? JSON.parse(req.body.recentContext) : null;

        console.log(`📊 [${requestId}] Audio: ${req.file.size} bytes, ${req.file.mimetype}`);
        console.log(`📋 [${requestId}] Master list: ${masterListCandidates ? masterListCandidates.length : 0} items`);
        console.log(`🔤 [${requestId}] Recent context: ${recentContext ? 'provided' : 'none'}`);

        // Validate minimum audio size
        const MIN_AUDIO_SIZE = 2000; // 2KB minimum (about 0.1 seconds of audio)
        if (req.file.size < MIN_AUDIO_SIZE) {
            console.log(`⚠️  [${requestId}] Rejected: ${req.file.size} bytes < ${MIN_AUDIO_SIZE} bytes minimum`);
            return res.json({
                success: false,
                error: 'Audio file too short - please speak for at least 1 second'
            });
        }

        // Fully buffer the uploaded file (already in req.file.buffer via multer)
        console.log(`✅ [${requestId}] Audio buffered and validated`);

        // Queue Google Cloud Speech API call to prevent simultaneous requests
        console.log(`📥 [${requestId}] Queuing for Google Cloud Speech`);

        const googleSttResponse = await speechQueue.add(async () => {
            const queueStartTime = Date.now();
            console.log(`🔄 [${requestId}] Start Google Speech call (queued ${queueStartTime - startTime}ms)`);

            let transcript = '';
            let alternatives = [];
            let retryCount = 0;
            const maxRetries = 3;

            while (retryCount <= maxRetries) {
                const attemptStart = Date.now();
                try {
                    const [response] = await speechClient.recognize({
                        audio: {
                            content: req.file.buffer.toString('base64')
                        },
                        config: {
                            encoding: 'WEBM_OPUS',
                            sampleRateHertz: 48000,
                            languageCode: 'en-US',
                            enableAutomaticPunctuation: true,
                            model: 'default',
                            maxAlternatives: 3 // Get alternatives for protocol comparison
                        }
                    });

                    const attemptDuration = Date.now() - attemptStart;

                    if (!response.results || response.results.length === 0) {
                        console.log(`⚠️  [${requestId}] No speech detected (${attemptDuration}ms, attempt ${retryCount + 1})`);
                        return { transcript: '', alternatives: [] };
                    }

                    // Get primary transcript
                    transcript = response.results
                        .map(r => r.alternatives[0].transcript)
                        .join(' ');

                    // Get alternatives if available
                    if (response.results[0] && response.results[0].alternatives) {
                        alternatives = response.results[0].alternatives
                            .slice(1, 4) // Take up to 3 alternatives (excluding primary)
                            .map(alt => alt.transcript);
                    }

                    console.log(`✅ [${requestId}] Google Speech success (${attemptDuration}ms, attempt ${retryCount + 1})`);
                    console.log(`📄 [${requestId}] Primary transcript: "${transcript}"`);
                    if (alternatives.length > 0) {
                        console.log(`📄 [${requestId}] Alternatives: ${JSON.stringify(alternatives)}`);
                    }
                    break; // Success - exit retry loop
                } catch (retryError) {
                    const attemptDuration = Date.now() - attemptStart;
                    const isNetworkError = retryError.code === 'ECONNRESET' ||
                                          retryError.code === 'ETIMEDOUT' ||
                                          retryError.code === 'ENOTFOUND' ||
                                          retryError.code === 14 || // Google UNAVAILABLE
                                          retryError.code === 4;   // Google DEADLINE_EXCEEDED

                    if (!isNetworkError || retryCount >= maxRetries) {
                        console.log(`❌ [${requestId}] Failed after ${attemptDuration}ms: ${retryError.message} (code: ${retryError.code}, attempt ${retryCount + 1})`);
                        throw retryError; // Non-network error or max retries reached
                    }

                    retryCount++;
                    // Exponential backoff with jitter: base * 2^retry + random(0-1000ms)
                    const backoff = (1000 * Math.pow(2, retryCount - 1)) + Math.floor(Math.random() * 1000);
                    console.log(`⚠️  [${requestId}] Retry ${retryCount}/${maxRetries} after ${attemptDuration}ms - ${retryError.code || retryError.message} - waiting ${backoff}ms`);
                    await new Promise(resolve => setTimeout(resolve, backoff));
                }
            }

            return { transcript, alternatives };
        });

        const { transcript, alternatives } = googleSttResponse;

        // If we have master list data, run protocol comparison
        let protocolComparison = null;
        if (masterListCandidates && masterListCandidates.length > 0) {
            console.log(`🔬 [${requestId}] Running side-by-side protocol comparison...`);

            try {
                const rawAudioMeta = {
                    sampleRate: 48000,
                    durationMs: Math.round((req.file.size / 48000) * 1000), // Rough estimate
                    vadPauseMs: null,
                    noiseLevel: null,
                    deviceHints: null
                };

                protocolComparison = compareProtocols(
                    transcript,
                    alternatives,
                    masterListCandidates,
                    aliasDictionary,
                    recentContext,
                    rawAudioMeta
                );

                console.log(`✅ [${requestId}] Protocol comparison complete`);

                // Log comparison flags
                if (protocolComparison.comparisonFlags) {
                    console.log(`🔬 [${requestId}] Comparison: Different item=${protocolComparison.comparisonFlags.differentCanonicalItem}, Different op=${protocolComparison.comparisonFlags.differentOperation}`);
                }

            } catch (error) {
                console.error(`⚠️  [${requestId}] Protocol comparison failed:`, error.message);
                // Don't fail the whole request if comparison fails
            }
        }

        const totalDuration = Date.now() - startTime;
        console.log(`✅ [${requestId}] Complete: ${totalDuration}ms total`);

        res.json({
            success: true,
            transcript: transcript,
            alternatives: alternatives,
            protocolComparison: protocolComparison
        });

    } catch (error) {
        const totalDuration = Date.now() - startTime;
        console.error(`❌ [${requestId}] FAILED after ${totalDuration}ms`);
        console.error(`   Error: ${error.message}`);
        console.error(`   Code: ${error.code}`);
        console.error(`   Type: ${error.constructor.name}`);

        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Audio transcription for Voice Mapping - WITH SIDE-BY-SIDE PROTOCOL COMPARISON
app.post('/audio/transcribe-mapping', upload.single('audio'), async (req, res) => {
    const requestId = uuidv4().substring(0, 8);
    const startTime = Date.now();

    console.log(`🗣️  [${requestId}] HIT /audio/transcribe-mapping at ${new Date().toISOString()}`);

    try {
        if (!req.file) {
            console.log(`❌ [${requestId}] No audio file in request`);
            return res.status(400).json({ error: 'No audio file provided' });
        }

        // Parse additional form data (sent alongside audio)
        const masterListCandidates = req.body.masterListCandidates ? JSON.parse(req.body.masterListCandidates) : null;
        const aliasDictionary = req.body.aliasDictionary ? JSON.parse(req.body.aliasDictionary) : {};
        const targetItem = req.body.targetItem || null;

        console.log(`📊 [${requestId}] Audio: ${req.file.size} bytes, ${req.file.mimetype}`);
        console.log(`📋 [${requestId}] Master list: ${masterListCandidates ? masterListCandidates.length : 0} items`);
        console.log(`🔤 [${requestId}] Target item: ${targetItem || 'none'}`);

        // Validate minimum audio size
        const MIN_AUDIO_SIZE = 2000; // 2KB minimum (about 0.1 seconds of audio)
        if (req.file.size < MIN_AUDIO_SIZE) {
            console.log(`⚠️  [${requestId}] Rejected: ${req.file.size} bytes < ${MIN_AUDIO_SIZE} bytes minimum`);
            return res.json({
                success: false,
                error: 'Audio file too short - please speak for at least 1 second'
            });
        }

        // Fully buffer the uploaded file (already in req.file.buffer via multer)
        console.log(`✅ [${requestId}] Audio buffered and validated`);

        // Queue Google Cloud Speech API call to prevent simultaneous requests
        console.log(`📥 [${requestId}] Queuing for Google Cloud Speech (Voice Mapping)`);

        const googleSttResponse = await speechQueue.add(async () => {
            const queueStartTime = Date.now();
            console.log(`🔄 [${requestId}] Start Google Speech call (queued ${queueStartTime - startTime}ms, Voice Mapping)`);

            let transcript = '';
            let alternatives = [];
            let retryCount = 0;
            const maxRetries = 3;

            while (retryCount <= maxRetries) {
                const attemptStart = Date.now();
                try {
                    const [response] = await speechClient.recognize({
                        audio: {
                            content: req.file.buffer.toString('base64')
                        },
                        config: {
                            encoding: 'WEBM_OPUS',
                            sampleRateHertz: 48000,
                            languageCode: 'en-US',
                            enableAutomaticPunctuation: true,
                            model: 'default',
                            maxAlternatives: 3 // Get alternatives for protocol comparison
                        }
                    });

                    const attemptDuration = Date.now() - attemptStart;

                    if (!response.results || response.results.length === 0) {
                        console.log(`⚠️  [${requestId}] No speech detected (${attemptDuration}ms, attempt ${retryCount + 1}, Voice Mapping)`);
                        return { transcript: '', alternatives: [] };
                    }

                    // Get primary transcript
                    transcript = response.results
                        .map(r => r.alternatives[0].transcript)
                        .join(' ');

                    // Get alternatives if available
                    if (response.results[0] && response.results[0].alternatives) {
                        alternatives = response.results[0].alternatives
                            .slice(1, 4) // Take up to 3 alternatives (excluding primary)
                            .map(alt => alt.transcript);
                    }

                    console.log(`✅ [${requestId}] Google Speech success (${attemptDuration}ms, attempt ${retryCount + 1}, Voice Mapping)`);
                    console.log(`📄 [${requestId}] Primary transcript: "${transcript}"`);
                    if (alternatives.length > 0) {
                        console.log(`📄 [${requestId}] Alternatives: ${JSON.stringify(alternatives)}`);
                    }
                    break; // Success - exit retry loop
                } catch (retryError) {
                    const attemptDuration = Date.now() - attemptStart;
                    const isNetworkError = retryError.code === 'ECONNRESET' ||
                                          retryError.code === 'ETIMEDOUT' ||
                                          retryError.code === 'ENOTFOUND' ||
                                          retryError.code === 14 || // Google UNAVAILABLE
                                          retryError.code === 4;   // Google DEADLINE_EXCEEDED

                    if (!isNetworkError || retryCount >= maxRetries) {
                        console.log(`❌ [${requestId}] Failed after ${attemptDuration}ms: ${retryError.message} (code: ${retryError.code}, attempt ${retryCount + 1}, Voice Mapping)`);
                        throw retryError; // Non-network error or max retries reached
                    }

                    retryCount++;
                    // Exponential backoff with jitter: base * 2^retry + random(0-1000ms)
                    const backoff = (1000 * Math.pow(2, retryCount - 1)) + Math.floor(Math.random() * 1000);
                    console.log(`⚠️  [${requestId}] Retry ${retryCount}/${maxRetries} after ${attemptDuration}ms - ${retryError.code || retryError.message} - waiting ${backoff}ms (Voice Mapping)`);
                    await new Promise(resolve => setTimeout(resolve, backoff));
                }
            }

            return { transcript, alternatives };
        });

        const { transcript, alternatives } = googleSttResponse;

        // Run protocol comparison
        let protocolComparison = null;
        if (targetItem) {
            // Voice Mapping mode - use special comparator that ALWAYS maps to target item
            console.log(`🔬 [${requestId}] Running Voice Mapping protocol comparison for "${targetItem}"...`);

            try {
                const rawAudioMeta = {
                    sampleRate: 48000,
                    durationMs: Math.round((req.file.size / 48000) * 1000),
                    vadPauseMs: null,
                    noiseLevel: null,
                    deviceHints: null
                };

                protocolComparison = compareProtocolsForVoiceMapping(
                    transcript,
                    alternatives,
                    targetItem,
                    aliasDictionary,
                    rawAudioMeta
                );

                console.log(`✅ [${requestId}] Voice Mapping comparison complete`);
                console.log(`🔬 [${requestId}] Training alias "${transcript}" → "${targetItem}"`);
                console.log(`🔬 [${requestId}] Alternatives: ${alternatives.join(', ')}`);

            } catch (error) {
                console.error(`⚠️  [${requestId}] Protocol comparison failed:`, error.message);
                // Don't fail the whole request if comparison fails
            }
        } else if (masterListCandidates && masterListCandidates.length > 0) {
            // Live Count mode - use regular comparator
            console.log(`🔬 [${requestId}] Running side-by-side protocol comparison...`);

            try {
                const rawAudioMeta = {
                    sampleRate: 48000,
                    durationMs: Math.round((req.file.size / 48000) * 1000),
                    vadPauseMs: null,
                    noiseLevel: null,
                    deviceHints: null
                };

                protocolComparison = compareProtocols(
                    transcript,
                    alternatives,
                    masterListCandidates,
                    aliasDictionary,
                    null,
                    rawAudioMeta
                );

                console.log(`✅ [${requestId}] Protocol comparison complete`);

                // Log comparison flags
                if (protocolComparison.comparisonFlags) {
                    console.log(`🔬 [${requestId}] Comparison: Different item=${protocolComparison.comparisonFlags.differentCanonicalItem}, Different op=${protocolComparison.comparisonFlags.differentOperation}`);
                }

            } catch (error) {
                console.error(`⚠️  [${requestId}] Protocol comparison failed:`, error.message);
                // Don't fail the whole request if comparison fails
            }
        }

        const totalDuration = Date.now() - startTime;
        console.log(`✅ [${requestId}] Complete: ${totalDuration}ms total (Voice Mapping)`);

        res.json({
            success: true,
            transcript: transcript,
            alternatives: alternatives,
            protocolComparison: protocolComparison
        });

    } catch (error) {
        const totalDuration = Date.now() - startTime;
        console.error(`❌ [${requestId}] FAILED after ${totalDuration}ms (Voice Mapping)`);
        console.error(`   Error: ${error.message}`);
        console.error(`   Code: ${error.code}`);
        console.error(`   Type: ${error.constructor.name}`);

        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log('');
    console.log('🔐 Environment Configuration Check:');
    console.log('  ANTHROPIC_API_KEY:', process.env.ANTHROPIC_API_KEY ? `✅ Set (${process.env.ANTHROPIC_API_KEY.substring(0, 15)}...)` : '❌ NOT SET');
    console.log('  GOOGLE_CREDS:', process.env.GOOGLE_CREDS ? '✅ Set' : '⚠️  Not set (uses default auth)');
    console.log('');
    console.log('📍 Active Audio Routes:');
    console.log('  POST /audio/transcribe-live-count → Google Cloud Speech + Side-by-Side Protocol Comparison');
    console.log('  POST /audio/transcribe-mapping → Google Cloud Speech + Side-by-Side Protocol Comparison');
    console.log('');
    console.log('📍 Command Parsing Routes:');
    console.log('  POST /live-count/parse-command → Constrained Intent Resolution (Claude API)');
    console.log('');
    console.log('🔧 Request Queue: Active (prevents simultaneous Speech API calls)');
    console.log('🔬 Protocol Comparison: Implemented directly (no file reading)');
    console.log('');
});
