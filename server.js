const express = require('express');
const multer = require('multer');
const cors = require('cors');
const vision = require('@google-cloud/vision');
const speech = require('@google-cloud/speech');
const { v4: uuidv4 } = require('uuid');

const app = express();
const upload = multer({ limits: { fileSize: 8 * 1024 * 1024 } });

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

const creds = JSON.parse(process.env.GOOGLE_CREDS);
const visionClient = new vision.ImageAnnotatorClient({ credentials: creds });
const speechClient = new speech.SpeechClient({ credentials: creds });

app.get('/', (req, res) => res.sendFile(__dirname + '/index.html'));

// PART 1: IMAGE -> OCR (Extract raw text only)
app.post('/parse', upload.array('images', 30), async (req, res) => {
    try {
        const ocrTexts = await Promise.all(req.files.map(async (file) => {
            const [result] = await visionClient.documentTextDetection(file.buffer);
            return result.fullTextAnnotation?.text || '';
        }));
        res.json({
            extracted: ocrTexts.map(t => ({ raw_text: t, quantity: 0 })),
            unmapped: []
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PART 2: VOICE -> TRANSCRIPTION (Raw text capture)
app.post('/process-voice', upload.single('audio'), async (req, res) => {
    try {
        const audio = { content: req.file.buffer.toString('base64') };
        const config = { encoding: 'WEBM_OPUS', sampleRateHertz: 48000, languageCode: 'en-US' };
        const [response] = await speechClient.recognize({ audio, config });
        const transcription = response.results.map(r => r.alternatives[0].transcript).join(' ');
        res.json({ transcription: transcription.toLowerCase() });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Zero-Friction Engine running on ${PORT}`));
