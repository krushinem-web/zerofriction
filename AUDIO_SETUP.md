# KrushFlow Audio API Setup

## Overview
KrushFlow uses **OpenAI Audio Transcription API** for speech-to-text, then **Claude API** for command parsing and validation.

## Architecture

### Audio Flow (Live Count & Voice Mapping)
```
User speaks
  ↓
Browser records audio (MediaRecorder API)
  ↓
Audio sent to server
  ↓
OpenAI Audio Transcription API (/v1/audio/transcriptions)
  - Model: gpt-4o-mini-transcribe (fast, cost-efficient)
  - Fallback: gpt-4o-transcribe (higher accuracy)
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

### OpenAI Audio API (STT Only)
- **Purpose:** Speech-to-text transcription only
- **Input:** Audio file (webm, mp3, wav, etc.)
- **Output:** Plain text transcript
- **Models:**
  - `gpt-4o-mini-transcribe` - Default, fast, cost-efficient
  - `gpt-4o-transcribe` - Higher accuracy fallback
- **Configuration:**
  - **Live Count:** Streaming enabled for real-time
  - **Voice Mapping:** Streaming disabled

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
OPENAI_API_KEY=sk-proj-...your-key...         # OpenAI Audio API

# Required for OCR (New Project sheet scanning)
GOOGLE_CREDS={"type":"service_account",...}    # Google Cloud Vision

# Optional for local dev
PORT=3000
```

## Endpoints

### Audio Transcription
- `POST /audio/transcribe-live-count` - Live Count mode (streaming)
- `POST /audio/transcribe-mapping` - Voice Mapping mode (no streaming)

### Command Parsing
- `POST /live-count/parse-command` - Parse transcript with Claude

### Persistence
- `POST /live-count/autosave` - 3-minute autosave
- `POST /live-count/save` - Manual save

## Cost Optimization

1. **Local pattern matching first** - Free, instant
2. **OpenAI Audio API fallback** - Fast, cheap transcription
3. **Claude API parsing** - Only when patterns don't match
4. **Accuracy fallback** - `gpt-4o-transcribe` only if mini fails

## Migration Notes

When moving to new infrastructure:
1. Copy environment variables to new platform
2. Update Railway deployment if needed
3. No code changes required (all config via env vars)
