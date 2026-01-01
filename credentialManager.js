// credentialManager.js - Async credential management with cleanup
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

let credentialPath = null;
let cleanupRegistered = false;

/**
 * Get or create Google Cloud credentials file asynchronously
 * @returns {Promise<string>} Path to credentials file
 */
async function getCredentialPath() {
  // Return cached path if already created
  if (credentialPath) {
    return credentialPath;
  }

  const json = process.env.GOOGLE_CREDS || process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  if (!json) {
    throw new Error('Missing Google Cloud credentials (GOOGLE_CREDS or GOOGLE_APPLICATION_CREDENTIALS_JSON)');
  }

  // Use consistent filename instead of process.pid for better caching
  const filename = `gcp-creds-${process.pid}.json`;
  const credsPath = path.join(os.tmpdir(), filename);

  try {
    // Check if file already exists
    await fs.access(credsPath);
    console.log(`Using existing credential file: ${credsPath}`);
  } catch (err) {
    // File doesn't exist, create it asynchronously
    console.log(`Creating credential file: ${credsPath}`);
    await fs.writeFile(credsPath, json, 'utf8');
  }

  credentialPath = credsPath;

  // Register cleanup handlers (only once)
  if (!cleanupRegistered) {
    registerCleanupHandlers(credsPath);
    cleanupRegistered = true;
  }

  return credsPath;
}

/**
 * Register cleanup handlers to remove credential file on exit
 * @param {string} filePath - Path to credential file
 */
function registerCleanupHandlers(filePath) {
  const cleanup = async () => {
    try {
      await fs.unlink(filePath);
      console.log(`Cleaned up credential file: ${filePath}`);
    } catch (err) {
      // Ignore errors during cleanup
    }
  };

  // Handle graceful shutdown
  process.on('exit', cleanup);
  process.on('SIGINT', async () => {
    await cleanup();
    process.exit(0);
  });
  process.on('SIGTERM', async () => {
    await cleanup();
    process.exit(0);
  });

  // Handle uncaught exceptions
  process.on('uncaughtException', async (err) => {
    console.error('Uncaught exception:', err);
    await cleanup();
    process.exit(1);
  });
}

module.exports = {
  getCredentialPath
};
