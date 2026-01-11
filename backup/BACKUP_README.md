# KrushFlow Application Backup

**Last Updated:** See LAST_UPDATED.txt
**Purpose:** Complete backup of all files required to run the KrushFlow application

## Quick Update

To update this backup folder with the latest changes, run from the main directory:

**Windows:**
```cmd
update-backup.bat
```

**Mac/Linux:**
```bash
./update-backup.sh
```

This will copy all necessary files to the backup folder.

## Contents

### Core Application Files
- `server.js` - Node.js backend server (Google STT transcription, Claude API)
- `index.html` - Frontend UI (Live Count, Voice Mapping, Daily Count)
- `package.json` - Node.js dependencies
- `pnpm-lock.yaml` - Package lock file

### Deployment Configuration
- `nixpacks.toml` - Railway deployment configuration
- `railway.toml` - Railway-specific settings
- `.npmrc` - npm configuration
- `.gitignore` - Git ignore rules

### Assets
- `logo.svg` - Application logo (SVG)
- `logo.png` - Application logo (PNG)
- `live_count.svg` - Live Count mode icon
- `new_project.svg` - New project icon
- `voice_mapping.svg` - Voice Mapping mode icon

### Setup & Documentation
- `.env.example` - Environment variable template
- `setup.bash` - Setup script
- `README.md` - Project documentation (if exists)

## How to Restore

1. **Copy all files to a new directory:**
   ```bash
   cp -r backup/* /path/to/new/directory/
   ```

2. **Install dependencies:**
   ```bash
   cd /path/to/new/directory
   pnpm install
   ```

3. **Set up environment variables:**
   ```bash
   cp .env.example .env
   # Edit .env with your actual API keys:
   # - ANTHROPIC_API_KEY
   # - GOOGLE_CREDS (Google Cloud credentials JSON)
   ```

4. **Run the application:**
   ```bash
   node server.js
   ```

## Environment Variables Required

- `ANTHROPIC_API_KEY` - Claude API key for command parsing
- `GOOGLE_CREDS` - Google Cloud Speech-to-Text credentials (JSON string)
- `PORT` - Server port (optional, defaults to 3000)

## Technology Stack

- **Backend:** Node.js, Express
- **Frontend:** Vanilla JavaScript, HTML5, CSS3
- **APIs:**
  - Google Cloud Speech-to-Text (3-version transcription)
  - Anthropic Claude (intent resolution)
- **Deployment:** Railway (Nixpacks)
- **Package Manager:** pnpm

## Important Notes

1. **Google STT Only:** This application uses Google Cloud Speech-to-Text API exclusively. OpenAI/ChatGPT has been removed.

2. **3-Version Transcription:** Both Live Count and Voice Mapping modes return 3 Google STT versions (Primary + Alternative 1 + Alternative 2).

3. **Build Configuration:** The `nixpacks.toml` includes `--no-frozen-lockfile` flag to handle lockfile mismatches during Railway deployment.

4. **Vertical Scrolling:** UI is designed for vertical scrolling only - no horizontal overflow.

## Data Directory

The application creates a `data/` directory at runtime to store:
- Project master lists
- Voice aliases
- Live count autosaves
- Daily count records

This directory is NOT included in the backup. Back it up separately if needed.
