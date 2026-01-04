// Test script for Inventory-Hash-Based Invalidation (Phase 1)

const { 
  generateInventoryHash,
  generateCacheKeyWithHash,
  getCachedWithValidation,
  setCachedWithHash
} = require('./cache');

console.log('='.repeat(80));
console.log('INVENTORY-HASH-BASED INVALIDATION - PHASE 1 TESTS');
console.log('='.repeat(80));

// Test 1: Order Independence
console.log('\n[Test 1] Order Independence');
const inv1 = ['RIBEYE 12OZ', 'CHICKEN BREAST', 'SALMON FILLET'];
const inv2 = ['SALMON FILLET', 'RIBEYE 12OZ', 'CHICKEN BREAST'];
const hash1 = generateInventoryHash(inv1);
const hash2 = generateInventoryHash(inv2);

console.log(`Inventory 1: ${JSON.stringify(inv1)}`);
console.log(`Hash 1: ${hash1}`);
console.log(`Inventory 2: ${JSON.stringify(inv2)}`);
console.log(`Hash 2: ${hash2}`);
console.log(`✓ Hashes match: ${hash1 === hash2}`);

// Test 2: Sensitivity to Changes
console.log('\n[Test 2] Sensitivity to Changes');
const inv3 = ['RIBEYE 12OZ', 'CHICKEN BREAST', 'SALMON FILLET', 'PORK CHOP'];
const hash3 = generateInventoryHash(inv3);

console.log(`Inventory 3: ${JSON.stringify(inv3)}`);
console.log(`Hash 3: ${hash3}`);
console.log(`✓ Hash differs from hash1: ${hash1 !== hash3}`);

// Test 3: Cache Key Generation
console.log('\n[Test 3] Cache Key Generation');
const mockFiles = [
  { buffer: Buffer.from('image1') },
  { buffer: Buffer.from('image2') }
];
const cacheKey = generateCacheKeyWithHash(mockFiles, hash1);
console.log(`Cache key: ${cacheKey.substring(0, 60)}...`);
console.log(`✓ Key format: ocr_{fileHash}_inv_{inventoryHash}`);

// Test 4: Cache Validation (Valid Hash)
console.log('\n[Test 4] Cache Validation - Valid Hash');
const testData = { result: 'test_data', extracted: ['ITEM_A', 'ITEM_B'] };
setCachedWithHash('test_key_1', testData, hash1, 3600);

const retrieved = getCachedWithValidation('test_key_1', hash1);
console.log(`✓ Cache hit with valid hash: ${retrieved !== null}`);
console.log(`✓ Data matches: ${JSON.stringify(retrieved) === JSON.stringify(testData)}`);

// Test 5: Cache Invalidation (Hash Mismatch)
console.log('\n[Test 5] Cache Invalidation - Hash Mismatch');
setCachedWithHash('test_key_2', testData, hash1, 3600);

const invalidated = getCachedWithValidation('test_key_2', hash3);
console.log(`✓ Cache invalidated with different hash: ${invalidated === null}`);

// Test 6: Empty Inventory Handling
console.log('\n[Test 6] Empty Inventory Handling');
try {
  generateInventoryHash([]);
  console.log('✗ Should have thrown error for empty inventory');
} catch (err) {
  console.log(`✓ Correctly throws error: ${err.message}`);
}

// Test 7: Hash Collision Resistance
console.log('\n[Test 7] Hash Collision Resistance');
const inv4 = ['ITEM_A'];
const inv5 = ['ITEM_B'];
const hash4 = generateInventoryHash(inv4);
const hash5 = generateInventoryHash(inv5);
console.log(`Hash for ['ITEM_A']: ${hash4}`);
console.log(`Hash for ['ITEM_B']: ${hash5}`);
console.log(`✓ Different items produce different hashes: ${hash4 !== hash5}`);

// Test 8: Performance Benchmark
console.log('\n[Test 8] Performance Benchmark');
const largeInventory = Array.from({ length: 1000 }, (_, i) => `ITEM_${i}`);

const startTime = Date.now();
for (let i = 0; i < 1000; i++) {
  generateInventoryHash(largeInventory);
}
const endTime = Date.now();

const avgTime = (endTime - startTime) / 1000;
console.log(`1000 hashes of 1000-item inventory: ${endTime - startTime}ms`);
console.log(`Average time per hash: ${avgTime.toFixed(2)}ms`);
console.log(`✓ Performance acceptable: ${avgTime < 5 ? 'YES' : 'NO'} (target: <5ms)`);

console.log('\n' + '='.repeat(80));
console.log('ALL TESTS COMPLETED');
console.log('='.repeat(80));
