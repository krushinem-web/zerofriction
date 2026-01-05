const express = require('express');
const multer = require('multer');
const speech = require('@google-cloud/speech');
const Anthropic = require('@anthropic-ai/sdk');
const { v4: uuidv4 } = require('uuid');

const app = express();
const upload = multer({ limits: { fileSize: 8 * 1024 * 1024 } });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

app.use(express.json());
app.use(express.static(__dirname));

// Server-side KrushProfile and Project Memory
let krushProfile = { aliases: {} }; // { "alias": "canonicalName" }
let activeProjects = {}; // { projectId: { masterList: [], counts: {} } }

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

app.listen(3000);
