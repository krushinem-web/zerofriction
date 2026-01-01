// cache.js - Response caching module
const NodeCache = require('node-cache');
const crypto = require('crypto');

// Initialize cache with 8 hour TTL (optimized for restaurant shift patterns)
// Check expired keys every 10 minutes
const cache = new NodeCache({ 
  stdTTL: 28800,  // 8 hours (28,800 seconds) - covers full business day
  checkperiod: 600,
  useClones: false // Better performance for large objects
});

/**
 * Generate cache key from file buffers
 * @param {Array} files - Array of file objects with buffer property
 * @returns {string} Cache key
 */
function generateCacheKey(files) {
  const hash = crypto.createHash('sha256');
  files.forEach(file => {
    hash.update(file.buffer);
  });
  return `ocr_${hash.digest('hex')}`;
}

/**
 * Get cached response
 * @param {string} key - Cache key
 * @returns {*} Cached value or undefined
 */
function getCached(key) {
  return cache.get(key);
}

/**
 * Set cached response
 * @param {string} key - Cache key
 * @param {*} value - Value to cache
 * @param {number} ttl - Time to live in seconds (default: 28800 = 8 hours)
 * @returns {boolean} Success status
 */
function setCached(key, value, ttl = 28800) {
  return cache.set(key, value, ttl);
}

/**
 * Get cache statistics
 * @returns {object} Cache statistics
 */
function getStats() {
  return cache.getStats();
}

// ============================================================================
// INVENTORY-HASH-BASED INVALIDATION (Phase 1)
// ============================================================================

/**
 * Generate inventory hash (order-independent)
 * @param {Array<string>} inventory - Array of inventory item names
 * @returns {string} 16-character hex hash
 */
function generateInventoryHash(inventory) {
  if (!inventory || !Array.isArray(inventory) || inventory.length === 0) {
    throw new Error('Inventory must be a non-empty array');
  }

  // Sort for order independence
  const sortedInventory = [...inventory].sort();

  // Generate SHA-256 hash
  const hash = crypto
    .createHash('sha256')
    .update(JSON.stringify(sortedInventory))
    .digest('hex');

  // Return first 16 characters (64 bits, sufficient for collision avoidance)
  return hash.substring(0, 16);
}

/**
 * Generate cache key with inventory hash
 * @param {Array} files - Array of file objects with buffer property
 * @param {string} inventoryHash - 16-character inventory hash
 * @returns {string} Composite cache key
 */
function generateCacheKeyWithHash(files, inventoryHash) {
  const fileHash = crypto.createHash('sha256');

  // Hash all file buffers
  files.forEach(file => {
    fileHash.update(file.buffer);
  });

  const fileHashHex = fileHash.digest('hex');

  // Composite key: ocr_{fileHash}_inv_{inventoryHash}
  return `ocr_${fileHashHex}_inv_${inventoryHash}`;
}

/**
 * Get cached result with inventory validation
 * @param {string} cacheKey - Cache key
 * @param {string} currentInventoryHash - Current inventory hash
 * @returns {Object|null} Cached data or null if invalid/missing
 */
function getCachedWithValidation(cacheKey, currentInventoryHash) {
  const cacheEntry = cache.get(cacheKey);

  if (!cacheEntry) {
    return null;
  }

  // Validate inventory hash
  if (cacheEntry.inventoryHash !== currentInventoryHash) {
    console.warn(
      `Cache INVALIDATED: inventory changed\n` +
      `  Key: ${cacheKey.substring(0, 40)}...\n` +
      `  Old hash: ${cacheEntry.inventoryHash}\n` +
      `  New hash: ${currentInventoryHash}`
    );

    // Remove stale entry
    cache.del(cacheKey);

    return null;
  }

  // Valid cache hit
  const ageSeconds = Math.floor((Date.now() - cacheEntry.cachedAt) / 1000);
  console.log(
    `Cache HIT with valid inventory hash\n` +
    `  Age: ${ageSeconds}s\n` +
    `  Inventory hash: ${currentInventoryHash}`
  );

  return cacheEntry.data;
}

/**
 * Set cached result with inventory hash
 * @param {string} cacheKey - Cache key
 * @param {Object} resultData - Data to cache
 * @param {string} inventoryHash - Inventory hash
 * @param {number} ttl - Time to live in seconds
 * @returns {boolean} Success status
 */
function setCachedWithHash(cacheKey, resultData, inventoryHash, ttl) {
  const cacheEntry = {
    data: resultData,
    inventoryHash: inventoryHash,
    cachedAt: Date.now(),
    ttl: ttl
  };

  const success = cache.set(cacheKey, cacheEntry, ttl);

  if (success) {
    const hours = Math.floor(ttl / 3600);
    const minutes = Math.floor((ttl % 3600) / 60);
    console.log(
      `Cached with inventory hash: ${inventoryHash}\n` +
      `  TTL: ${ttl}s (${hours}h ${minutes}m)`
    );
  }

  return success;
}

module.exports = {
  // Original exports
  generateCacheKey,
  getCached,
  setCached,
  getStats,
  // New inventory-hash exports
  generateInventoryHash,
  generateCacheKeyWithHash,
  getCachedWithValidation,
  setCachedWithHash
};
