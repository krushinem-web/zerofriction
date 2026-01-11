# KrushFlow Audio API Setup

## Overview
KrushFlow uses:
- **Voice Mapping**: BOTH ChatGPT (OpenAI Whisper) AND Google Cloud Speech-to-Text for side-by-side transcription comparison
- **Live Count**: Google Cloud Speech-to-Text API for speech-to-text
- **Command Parsing**: Claude API for validation and parsing

## Architecture

### Audio Flow (Live Count & Voice Mapping)
```
User speaks
  ↓
Browser records audio (MediaRecorder API)
  ↓
Audio sent to server
  ↓
Google Cloud Speech-to-Text API
  - Encoding: WEBM_OPUS
  - Sample Rate: 48000 Hz
  - Model: default
  - Response: plain text transcript
  ↓
Transcript returned to client
  ↓
Client attempts local pattern matching
  ↓
If no match → Send to Claude API for parsing
  ↓
Claude returns: {item, operation, quantity}
  ↓
KrushFlow validates against master list + aliases
  ↓
Apply arithmetic mutation or queue as unmatched
```

## API Responsibilities

### Google Cloud Speech-to-Text API (STT Only)
- **Purpose:** Speech-to-text transcription only
- **Input:** Audio file (webm/opus preferred)
- **Output:** Plain text transcript
- **Configuration:**
  - **Encoding:** WEBM_OPUS
  - **Sample Rate:** 48000 Hz
  - **Language:** en-US
  - **Model:** default
  - **Features:** Automatic punctuation enabled

### Claude API (Parsing Only)
- **Purpose:** Parse transcript into structured command
- **Input:** Text transcript + master list + aliases
- **Output:** `{item: string, operation: "ADD|SUBTRACT|SET", quantity: number}`
- **Model:** `claude-3-5-sonnet-20241022`
- **Used when:** Local pattern matching fails

### KrushFlow Engine (Validation & State)
- Alias resolution
- Master list validation
- Arithmetic operations (ADD/SUBTRACT/SET)
- State persistence
- Unmatched queue management
- Export ordering

## Hard Boundary Rule
**The Audio API never interprets inventory meaning or math.**

KrushFlow remains the single authority for:
- Validation
- Alias resolution
- Arithmetic
- Persistence
- Output ordering

## Environment Variables

Add these to Railway Dashboard → Variables:

```bash
# Required for all features
ANTHROPIC_API_KEY=sk-ant-...your-key...       # Claude API

# Required for OCR (New Project sheet scanning) and Speech-to-Text
GOOGLE_CREDS={"type":"service_account",...}    # Google Cloud Vision & Speech
# Note: Railway can use default Google Cloud auth if deployed with GCP service account

# Optional for local dev
PORT=3000
```

## Endpoints

### Audio Transcription
- `POST /audio/transcribe-live-count` - Live Count mode
- `POST /audio/transcribe-mapping` - Voice Mapping mode

### Command Parsing
- `POST /live-count/parse-command` - Parse transcript with Claude

### Persistence
- `POST /live-count/autosave` - 3-minute autosave
- `POST /live-count/save` - Manual save

## Cost Optimization

1. **Local pattern matching first** - Free, instant
2. **Google Cloud Speech API** - Fast, accurate transcription
3. **Claude API parsing** - Only when patterns don't match
4. **Request queueing** - Prevents rate limiting and connection errors

## Migration Notes

When moving to new infrastructure:
1. Copy environment variables to new platform
2. Update Railway deployment if needed
3. No code changes required (all config via env vars)
