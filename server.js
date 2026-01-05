const express = require('express');
const multer = require('multer');
const cors = require('cors');
const vision = require('@google-cloud/vision');
const { v4: uuidv4 } = require('uuid');

const app = express();
const upload = multer({ limits: { fileSize: 8 * 1024 * 1024 } });

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// Google Auth Check
const creds = process.env.GOOGLE_CREDS ? JSON.parse(process.env.GOOGLE_CREDS) : null;
const visionClient = creds ? new vision.ImageAnnotatorClient({ credentials: creds }) : null;

app.get('/', (req, res) => res.sendFile(__dirname + '/index.html'));

app.post('/parse', upload.array('images', 30), async (req, res) => {
    if (!visionClient) return res.status(500).json({ error: "Google Credentials missing" });
    
    try {
        const ocrResults = await Promise.all(req.files.map(async (file) => {
            const [result] = await visionClient.documentTextDetection(file.buffer);
            return result.fullTextAnnotation?.text || '';
        }));
        
        // This is where you would call the Claude API using combinedText
        res.json({ success: true, extracted: ocrResults });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
