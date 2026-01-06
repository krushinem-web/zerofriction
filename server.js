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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
