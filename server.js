// server.js - Inventory Image Parser Backend (OCR -> LLM formatting)
const express = require('express');
const multer = require('multer');
const cors = require('cors');
const sharp = require('sharp');
const { v4: uuidv4 } = require('uuid');

const vision = require('@google-cloud/vision');
const speech = require('@google-cloud/speech');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Performance optimization modules
const { 
  generateCacheKey, 
  getCached, 
  setCached, 
  getStats,
  // Inventory-hash functions (Phase 1)
  generateInventoryHash,
  generateCacheKeyWithHash,
  getCachedWithValidation,
  setCachedWithHash
} = require('./cache');
const { getCredentialPath } = require('./credentialManager');
const { fetchWithTimeout } = require('./utils');

const app = express();
const upload = multer({
  limits: { fileSize: 8 * 1024 * 1024 }, // 8MB limit
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'audio/webm', 'audio/wav', 'audio/mp3', 'audio/mpeg'];
    if (!allowed.includes(file.mimetype)) {
      return cb(new Error('Invalid file type.'));
    }
    cb(null, true);
  }
});

// CORS configuration
app.use(cors({
  origin: process.env.ALLOWED_ORIGIN || '*',
  methods: ['POST', 'OPTIONS', 'GET'],
  allowedHeaders: ['Content-Type']
}));

app.use(express.json());

// Serve static files
app.use(express.static(__dirname));

// Serve the frontend HTML file with explicit UTF-8 encoding
app.get('/', (req, res) => {
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.sendFile(__dirname + '/index.html');
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Helper to sanitize Google Cloud credentials JSON (4-step normalization)
function normalizeGoogleCredsJson(raw) {
  if (!raw) {
    throw new Error('Missing Google Cloud credentials JSON env var.');
  }
  
  const tryParse = (s) => {
    const o = JSON.parse(s);
    return JSON.stringify(o);
  };
  
  // 1) Try direct JSON parse
  try {
    return tryParse(raw);
  } catch (e1) {
    // Continue to next attempt
  }
  
  // 2) Try base64 decode (common in env vars)
  try {
    const decoded = Buffer.from(raw, 'base64').toString('utf8');
    return tryParse(decoded);
  } catch (e2) {
    // Continue to next attempt
  }
  
  // 3) Repair newline issues (remove carriage returns)
  try {
    const repaired = raw.replace(/\r/g, '');
    return tryParse(repaired);
  } catch (e3) {
    // Continue to next attempt
  }
  
  // 4) Last resort: convert actual newlines into escaped \n then parse
  try {
    const escaped = raw.replace(/\r?\n/g, '\\n');
    return tryParse(escaped);
  } catch (e4) {
    // All attempts failed
  }
  
  throw new Error('Invalid Google Cloud credentials JSON (bad escaping/newlines).');
}

// Google Vision client (Optimized with async credential management and timeouts)
let visionClient = null;
let visionClientPromise = null;

async function getVisionClient() {
  if (visionClient) return visionClient;

  // Prevent multiple simultaneous initializations
  if (visionClientPromise) return visionClientPromise;

  visionClientPromise = (async () => {
    // Get explicit credentials from environment
    const raw = process.env.GOOGLE_CREDS || process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
    if (!raw) {
      throw new Error('Missing Google Cloud credentials (GOOGLE_CREDS or GOOGLE_APPLICATION_CREDENTIALS_JSON)');
    }
    
    let credentials;
    try {
      const normalized = normalizeGoogleCredsJson(raw);
      credentials = JSON.parse(normalized);
      // Fix private_key newlines (Railway/env var escaping)
      if (credentials.private_key) {
        credentials.private_key = credentials.private_key.replace(/\\n/g, '\n');
      }
    } catch (parseError) {
      throw new Error(`Failed to parse Google Cloud credentials: ${parseError.message}`);
    }
    
    visionClient = new vision.ImageAnnotatorClient({ 
      credentials: credentials,
      projectId: credentials.project_id,
      timeout: 30000,
      retry: {
        initialRetryDelayMillis: 100,
        retryDelayMultiplier: 1.3,
        maxRetryDelayMillis: 5000,
        totalTimeoutMillis: 30000,
        maxRetries: 3
      }
    });
    
    console.log(`Google Vision auth ready for project: ${credentials.project_id}`);
    return visionClient;
  })();

  return visionClientPromise;
}

// Google Speech client (Optimized with async credential management and timeouts)
let speechClient = null;
let speechClientPromise = null;

async function getSpeechClient() {
  if (speechClient) return speechClient;

  // Prevent multiple simultaneous initializations
  if (speechClientPromise) return speechClientPromise;

  speechClientPromise = (async () => {
    // Get explicit credentials from environment
    const raw = process.env.GOOGLE_CREDS || process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
    if (!raw) {
      throw new Error('Missing Google Cloud credentials (GOOGLE_CREDS or GOOGLE_APPLICATION_CREDENTIALS_JSON)');
    }
    
    let credentials;
    try {
      const normalized = normalizeGoogleCredsJson(raw);
      credentials = JSON.parse(normalized);
      // Fix private_key newlines (Railway/env var escaping)
      if (credentials.private_key) {
        credentials.private_key = credentials.private_key.replace(/\\n/g, '\n');
      }
    } catch (parseError) {
      throw new Error(`Failed to parse Google Cloud credentials: ${parseError.message}`);
    }
    
    speechClient = new speech.SpeechClient({ 
      credentials: credentials,
      projectId: credentials.project_id,
      timeout: 20000,
      retry: {
        initialRetryDelayMillis: 100,
        retryDelayMultiplier: 1.3,
        maxRetryDelayMillis: 5000,
        totalTimeoutMillis: 20000,
        maxRetries: 3
      }
    });
    
    console.log(`Google Speech auth ready for project: ${credentials.project_id}`);
    return speechClient;
  })();

  return speechClientPromise;
}

// Preprocess image for OCR
async function preprocessForOcr(buffer) {
  return sharp(buffer)
    .rotate()
    .resize(2000, 2000, { fit: 'inside', withoutEnlargement: true })
    .png({ compressionLevel: 6 })
    .toBuffer();
}

// OCR one image buffer
async function ocrBuffer(client, buffer) {
  const [result] = await client.documentTextDetection({
    image: { content: buffer.toString('base64') }
  });
  return result.fullTextAnnotation?.text || '';
}

// Build strict OCR-to-JSON prompt
function buildPrompt(ocrText, imageCount) {
  return `
You are an inventory document parser.

You will receive OCR text extracted from ${imageCount} image(s).

RULES:
- Do NOT invent items
- Do NOT standardize abbreviations
- Do NOT infer missing items
- If unclear, put in "unmapped"
- Return JSON ONLY

OCR TEXT:
${ocrText}

Return ONLY:
{
  "extracted": [
    { "raw_text": "exact text", "quantity": 0 }
  ],
  "unmapped": [
    { "raw_text": "exact text", "reason": "unclear or partial" }
  ]
}
`.trim();
}

// Extract JSON safely
function extractJson(text) {
  const start = text.indexOf('{');
  if (start === -1) throw new Error('No JSON found');
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === '{') depth++;
    if (text[i] === '}') depth--;
    if (depth === 0) return JSON.parse(text.slice(start, i + 1));
  }
  throw new Error('Invalid JSON');
}

// Main parse endpoint (Optimized with caching)
app.post('/parse', upload.array('images', 30), async (req, res) => {
  const requestId = uuidv4();

  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ requestId, error: 'No images provided' });
    }

    // ========================================================================
    // INVENTORY-AWARE CACHING (Phase 1)
    // ========================================================================

    // Check if inventory list provided
    let inventory = null;
    let useInventoryHash = false;

    if (req.body.inventory) {
      try {
        inventory = JSON.parse(req.body.inventory);
        if (Array.isArray(inventory) && inventory.length > 0) {
          useInventoryHash = true;
        }
      } catch (err) {
        console.warn('Invalid inventory JSON, falling back to simple caching:', err.message);
      }
    }

    // Generate cache key based on inventory availability
    let cacheKey, cachedResult;

    if (useInventoryHash) {
      // Inventory-aware caching with hash validation
      const currentInvHash = generateInventoryHash(inventory);
      cacheKey = generateCacheKeyWithHash(req.files, currentInvHash);
      cachedResult = getCachedWithValidation(cacheKey, currentInvHash);
      
      if (cachedResult) {
        console.log(`Cache HIT (inventory-aware) for request ${requestId}`);
        return res.json({
          ...cachedResult,
          requestId,
          cached: true,
          cacheType: 'inventory-aware'
        });
      }
    } else {
      // Fallback to simple caching (no inventory awareness)
      cacheKey = generateCacheKey(req.files);
      cachedResult = getCached(cacheKey);
      
      if (cachedResult) {
        console.log(`Cache HIT (simple) for request ${requestId}`);
        return res.json({
          ...cachedResult,
          requestId,
          cached: true,
          cacheType: 'simple'
        });
      }
    }

    console.log(`Cache MISS for request ${requestId} (type: ${useInventoryHash ? 'inventory-aware' : 'simple'})`);

    const client = await getVisionClient();

    const ocrTexts = await Promise.all(
      req.files.map(async file => {
        try {
          const pre = await preprocessForOcr(file.buffer);
          return await ocrBuffer(client, pre);
        } catch {
          return '';
        }
      })
    );

    const combinedOcrText = ocrTexts
      .map((t, i) => `--- IMAGE ${i + 1} ---\n${t}`)
      .join('\n\n');

    if (!combinedOcrText.trim()) {
      return res.json({
        requestId,
        success: true,
        extracted: [],
        unmapped: [{ raw_text: '', reason: 'No readable OCR text' }]
      });
    }

    const prompt = buildPrompt(combinedOcrText, req.files.length);

    const response = await fetchWithTimeout(
      'https://api.anthropic.com/v1/messages',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 4000,
          messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }]
        })
      },
      30000 // 30 second timeout
    );

    if (!response.ok) {
      throw new Error(`Anthropic API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const text = data.content.map(c => c.text || '').join('\n');

    const parsed = extractJson(text);

    const result = {
      success: true,
      extracted: parsed.extracted || [],
      unmapped: parsed.unmapped || []
    };

    // ========================================================================
    // CACHE STORAGE (Inventory-aware or Simple)
    // ========================================================================

    if (useInventoryHash) {
      // Cache with inventory hash validation
      const currentInvHash = generateInventoryHash(inventory);
      const ttl = 28800; // 8 hours (Phase 2 will add adaptive TTL)
      setCachedWithHash(cacheKey, result, currentInvHash, ttl);
    } else {
      // Simple caching
      setCached(cacheKey, result, 28800);
    }

    res.json({
      requestId,
      ...result,
      cached: false,
      cacheType: useInventoryHash ? 'inventory-aware' : 'simple'
    });

  } catch (err) {
    res.status(500).json({
      requestId,
      error: 'Server error',
      details: err.message
    });
  }
});

// Voice processing endpoint - USES GOOGLE SPEECH-TO-TEXT ONLY
app.post('/process-voice', upload.single('audio'), async (req, res) => {
  const requestId = uuidv4();

  try {
    if (!req.file) {
      return res.status(400).json({ requestId, error: 'No audio file provided' });
    }

    const client = await getSpeechClient();

    // Configure recognition
    const audio = {
      content: req.file.buffer.toString('base64')
    };

    const config = {
      encoding: 'WEBM_OPUS',
      sampleRateHertz: 48000, // WebM typically uses 48kHz
      languageCode: 'en-US',
      enableAutomaticPunctuation: false, // We want raw text
      model: 'command_and_search' // Optimized for short commands
    };

    const request = {
      audio: audio,
      config: config
    };

    // Perform speech recognition
    const [response] = await client.recognize(request);
    
    if (!response.results || response.results.length === 0) {
      return res.json({
        requestId,
        success: true,
        transcription: '' // No speech detected
      });
    }

    // Get the transcription - take the first alternative (most confident)
    const transcription = response.results
      .map(result => result.alternatives[0].transcript)
      .join(' ')
      .trim();

    res.json({
      requestId,
      success: true,
      transcription: transcription // RAW TEXT - no interpretation
    });

  } catch (err) {
    console.error('Voice processing error:', err);
    res.status(500).json({
      requestId,
      error: 'Voice processing failed',
      details: err.message
    });
  }
});

// Daily Count interpretation endpoint
app.post('/interpret-count', express.json(), async (req, res) => {
  const requestId = uuidv4();

  try {
    const { transcription, inventory, aliases } = req.body;

    if (!transcription || !inventory || !aliases) {
      return res.status(400).json({
        requestId,
        error: 'Missing required fields: transcription, inventory, aliases'
      });
    }

    // Simplified prompt for voice command interpretation
    const prompt = `Parse this voice command: "${transcription}"

Inventory items:
${inventory.join('\n')}

Aliases:
${Object.entries(aliases).map(([item, aliasList]) => 
  `${item}: ${aliasList.join(', ')}`
).join('\n')}

Extract the item name and count. Match to inventory using aliases.

Return JSON only:
{
  "raw_text": "exact transcription",
  "matched_item": "EXACT_INVENTORY_NAME",
  "count": number
}

If no match, return:
{
  "raw_text": "exact transcription",
  "matched_item": null,
  "count": null,
  "error": "reason"
  "reason": "no matching alias | ambiguous | no numeric quantity"
}

No markdown, no explanations, JSON only.`;

    const response = await fetchWithTimeout(
      'https://api.anthropic.com/v1/messages',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 200,
          messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }]
        })
      },
      30000 // 30 second timeout
    );

    if (!response.ok) {
      throw new Error(`Anthropic API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const text = data.content.map(c => c.text || '').join('\n');

    // Use existing extractJson function (enforces no markdown)
    const parsed = extractJson(text);

    res.json({
      requestId,
      success: true,
      interpretation: parsed
    });

  } catch (err) {
    console.error('Daily Count interpretation error:', err);
    res.status(500).json({
      requestId,
      error: 'Interpretation failed',
      details: err.message
    });
  }
});

// Multi-item Daily Count interpretation endpoint
app.post('/interpret-multi-count', express.json(), async (req, res) => {
  const requestId = uuidv4();

  try {
    const { transcription, inventory, aliases, userVoiceProfile } = req.body;

    if (!transcription || !inventory || !aliases) {
      return res.status(400).json({
        requestId,
        error: 'Missing required fields: transcription, inventory, aliases'
      });
    }

    // Simplified multi-item interpretation prompt
    const hasKrushProfile = userVoiceProfile && Object.keys(userVoiceProfile).length > 0;
    
    const krushProfileSection = hasKrushProfile ? `

User Voice Profile (priority):
${Object.entries(userVoiceProfile).map(([item, variants]) => 
  `${item}: ${variants.join(', ')}`
).join('\n')}
` : '';
    
    const prompt = `Parse multiple items from voice command: "${transcription}"

Inventory items:
${inventory.join('\n')}

Aliases:
${Object.entries(aliases).map(([item, aliasList]) => 
  `${item}: ${aliasList.join(', ')}`
).join('\n')}${krushProfileSection}

Extract ALL items with counts. Match to inventory using aliases.
Handle delimiters: "at", "add", "is", "and", commas.

Return JSON only:
{
  "items": [
    {"item": "EXACT_INVENTORY_NAME", "count": 12, "confidence": "high"},
    {"item": "EXACT_INVENTORY_NAME", "count": 6, "confidence": "medium"}
  ],
  "unmapped": [
    {
      "raw_text": "spoken phrase",
      "item_phrase": "cleaned item name",
      "count_value": 5,
      "suggested_item": "BEST_MATCH",
      "reason": "no match | ambiguous"
    }
  ]
}

Confidence: "high" = exact alias match, "medium" = fuzzy match.
No markdown, JSON only.`;

    const response = await fetchWithTimeout(
      'https://api.anthropic.com/v1/messages',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1000,
          messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }]
        })
      },
      30000 // 30 second timeout
    );

    if (!response.ok) {
      throw new Error(`Anthropic API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const text = data.content.map(c => c.text || '').join('\n');

    // Use existing extractJson function
    const parsed = extractJson(text);

    res.json({
      requestId,
      success: true,
      interpretation: parsed
    });

  } catch (err) {
    console.error('Multi-item interpretation error:', err);
    res.status(500).json({
      requestId,
      error: 'Multi-item interpretation failed',
      details: err.message
    });
  }
});

// Cache statistics endpoint (Enhanced with inventory-hash metrics)
app.get('/cache-stats', (req, res) => {
  const stats = getStats();
  const totalRequests = stats.hits + stats.misses;
  const hitRate = totalRequests > 0 ? stats.hits / totalRequests : 0;

  // Count inventory-aware vs simple cache entries
  const keys = stats.keys || 0;
  
  res.json({
    // Basic cache stats
    hits: stats.hits,
    misses: stats.misses,
    keys: keys,
    hitRate: parseFloat(hitRate.toFixed(3)),
    
    // Memory usage
    ksize: stats.ksize || 0,  // Key size in bytes
    vsize: stats.vsize || 0,  // Value size in bytes
    
    // Inventory-hash info (Phase 1)
    inventoryHashEnabled: true,
    phase: 'Phase 1: Core Hash Validation',
    
    // Timestamp
    timestamp: new Date().toISOString()
  });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);

  // Handle specific error types
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({
      error: 'File too large',
      details: 'Maximum file size is 8MB'
    });
  }

  if (err.message && err.message.includes('timeout')) {
    return res.status(504).json({
      error: 'Request timeout',
      details: 'External service took too long to respond'
    });
  }

  if (err.message && (err.message.includes('ECONNREFUSED') || err.message.includes('ENOTFOUND'))) {
    return res.status(503).json({
      error: 'Service unavailable',
      details: 'Unable to connect to external service'
    });
  }

  // Generic error response
  res.status(500).json({
    error: 'Internal server error',
    details: process.env.NODE_ENV === 'development' ? err.message : 'An unexpected error occurred'
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Initialize clients before starting server
async function initializeClients() {
  try {
    console.log('Initializing Google Cloud clients...');
    await getVisionClient();
    await getSpeechClient();
    console.log('Google Cloud clients initialized successfully');
  } catch (err) {
    console.error('Failed to initialize Google Cloud clients:', err);
    console.error('Server will attempt lazy initialization on first request');
  }
}

const PORT = process.env.PORT || 3000;

// Initialize clients then start server
initializeClients().then(() => {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Claude key set: ${!!process.env.ANTHROPIC_API_KEY}`);
    console.log(`Google OCR set: ${!!(process.env.GOOGLE_CREDS || process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON)}`);
    console.log(`Google STT set: ${!!(process.env.GOOGLE_CREDS || process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON)}`);
    console.log('Performance optimizations: Caching ✓ | Timeouts ✓ | Async Credentials ✓');
  });
});
