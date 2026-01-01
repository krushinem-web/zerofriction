# Inventory-Hash-Based Invalidation: Pseudocode & Architecture

## High-Level Pseudocode

### Core Functions

```pseudocode
// ============================================================================
// FUNCTION: Generate Inventory Hash
// ============================================================================
FUNCTION generateInventoryHash(inventory_list):
    INPUT: inventory_list (Array of strings)
    OUTPUT: hash_string (16-character hex string)
    
    // Sort for consistency (order shouldn't matter)
    sorted_inventory = SORT(inventory_list)
    
    // Convert to canonical JSON string
    json_string = JSON.stringify(sorted_inventory)
    
    // Generate SHA-256 hash
    hash = SHA256(json_string)
    
    // Return first 16 characters (sufficient for collision avoidance)
    RETURN hash.substring(0, 16)


// ============================================================================
// FUNCTION: Generate Cache Key with Inventory Hash
// ============================================================================
FUNCTION generateCacheKey(image_files, inventory_hash):
    INPUT: 
        - image_files (Array of file buffers)
        - inventory_hash (String, 16 chars)
    OUTPUT: cache_key (String)
    
    // Hash the image files
    file_hash = SHA256()
    FOR EACH file IN image_files:
        file_hash.update(file.buffer)
    
    file_hash_hex = file_hash.digest('hex')
    
    // Composite key: file hash + inventory hash
    cache_key = "ocr_" + file_hash_hex + "_inv_" + inventory_hash
    
    RETURN cache_key


// ============================================================================
// FUNCTION: Get Cached Result with Validation
// ============================================================================
FUNCTION getCachedWithValidation(cache_key, current_inventory_hash):
    INPUT:
        - cache_key (String)
        - current_inventory_hash (String)
    OUTPUT: cached_data (Object) OR null
    
    // Retrieve from cache
    cache_entry = CACHE.get(cache_key)
    
    IF cache_entry IS null:
        LOG("Cache MISS: key not found")
        RETURN null
    
    // Validate inventory hash
    IF cache_entry.inventory_hash != current_inventory_hash:
        LOG("Cache INVALIDATED: inventory changed")
        LOG("  Old hash: " + cache_entry.inventory_hash)
        LOG("  New hash: " + current_inventory_hash)
        
        // Remove stale entry
        CACHE.delete(cache_key)
        
        // Record invalidation for metrics
        METRICS.increment("cache_invalidations")
        
        RETURN null
    
    // Cache hit with valid inventory
    LOG("Cache HIT: valid inventory hash")
    METRICS.increment("cache_hits")
    
    RETURN cache_entry.data


// ============================================================================
// FUNCTION: Set Cached Result with Inventory Hash
// ============================================================================
FUNCTION setCachedWithHash(cache_key, result_data, inventory_hash, ttl):
    INPUT:
        - cache_key (String)
        - result_data (Object)
        - inventory_hash (String)
        - ttl (Integer, seconds)
    OUTPUT: success (Boolean)
    
    // Create cache entry with metadata
    cache_entry = {
        data: result_data,
        inventory_hash: inventory_hash,
        cached_at: CURRENT_TIMESTAMP(),
        ttl: ttl
    }
    
    // Store in cache with TTL
    success = CACHE.set(cache_key, cache_entry, ttl)
    
    IF success:
        LOG("Cached with inventory hash: " + inventory_hash)
        LOG("TTL: " + ttl + " seconds")
        METRICS.increment("cache_sets")
    
    RETURN success


// ============================================================================
// MAIN ENDPOINT: /parse with Inventory-Hash Caching
// ============================================================================
FUNCTION handleParseRequest(request, response):
    INPUT: 
        - request.files (Array of uploaded images)
        - request.body.inventory (Optional JSON string)
    OUTPUT: HTTP response with OCR results
    
    request_id = GENERATE_UUID()
    
    // Validate input
    IF request.files IS empty:
        RETURN ERROR_RESPONSE(400, "No images provided")
    
    // Check if inventory list provided
    IF request.body.inventory EXISTS:
        inventory_list = JSON.parse(request.body.inventory)
        use_inventory_hash = true
    ELSE:
        inventory_list = null
        use_inventory_hash = false
    
    // ========================================================================
    // CACHE LOOKUP with Inventory Validation
    // ========================================================================
    
    IF use_inventory_hash:
        // Generate current inventory hash
        current_inv_hash = generateInventoryHash(inventory_list)
        
        // Generate cache key with inventory hash
        cache_key = generateCacheKey(request.files, current_inv_hash)
        
        // Try to get cached result with validation
        cached_result = getCachedWithValidation(cache_key, current_inv_hash)
    ELSE:
        // Fallback to simple caching (no inventory awareness)
        cache_key = generateSimpleCacheKey(request.files)
        cached_result = CACHE.get(cache_key)
    
    // Return cached result if valid
    IF cached_result IS NOT null:
        RETURN JSON_RESPONSE({
            request_id: request_id,
            ...cached_result,
            cached: true,
            cache_age_seconds: CURRENT_TIMESTAMP() - cached_result.cached_at
        })
    
    // ========================================================================
    // CACHE MISS: Process Request
    // ========================================================================
    
    LOG("Cache MISS for request: " + request_id)
    
    // Initialize Google Vision client
    vision_client = AWAIT getVisionClient()
    
    // Process all images through OCR
    ocr_results = []
    FOR EACH file IN request.files:
        preprocessed = AWAIT preprocessForOcr(file.buffer)
        ocr_text = AWAIT ocrBuffer(vision_client, preprocessed)
        ocr_results.append(ocr_text)
    
    // Combine OCR text
    combined_text = ""
    FOR i FROM 0 TO ocr_results.length:
        combined_text += "--- IMAGE " + (i+1) + " ---\n"
        combined_text += ocr_results[i] + "\n\n"
    
    // Build prompt for LLM
    prompt = buildPrompt(combined_text, request.files.length)
    
    // Call Anthropic Claude API
    llm_response = AWAIT callAnthropicAPI(prompt)
    
    // Parse JSON from LLM response
    parsed_result = extractJson(llm_response.text)
    
    // Prepare result
    result = {
        success: true,
        extracted: parsed_result.extracted,
        unmapped: parsed_result.unmapped
    }
    
    // ========================================================================
    // CACHE STORAGE with Inventory Hash
    // ========================================================================
    
    IF use_inventory_hash:
        // Cache with inventory hash
        ttl = calculateAdaptiveTTL()  // Dynamic TTL
        setCachedWithHash(cache_key, result, current_inv_hash, ttl)
    ELSE:
        // Simple caching
        CACHE.set(cache_key, result, DEFAULT_TTL)
    
    // Return fresh result
    RETURN JSON_RESPONSE({
        request_id: request_id,
        ...result,
        cached: false
    })


// ============================================================================
// HELPER: Calculate Adaptive TTL
// ============================================================================
FUNCTION calculateAdaptiveTTL():
    OUTPUT: ttl_seconds (Integer)
    
    // Get inventory update history
    update_history = GET_UPDATE_HISTORY()
    
    IF update_history.length < 2:
        // Not enough data, use time-of-day TTL
        RETURN getTimeOfDayTTL()
    
    // Calculate average interval between updates
    intervals = []
    FOR i FROM 1 TO update_history.length:
        interval = update_history[i] - update_history[i-1]
        intervals.append(interval)
    
    avg_interval = SUM(intervals) / intervals.length
    
    // Set TTL to 50% of average interval (safety margin)
    adaptive_ttl = FLOOR(avg_interval / 2)
    
    // Clamp between 1 hour and 48 hours
    ttl = MAX(3600, MIN(172800, adaptive_ttl))
    
    RETURN ttl


// ============================================================================
// HELPER: Time-of-Day TTL
// ============================================================================
FUNCTION getTimeOfDayTTL():
    OUTPUT: ttl_seconds (Integer)
    
    current_hour = CURRENT_TIME().hour
    current_day = CURRENT_TIME().day_of_week  // 0=Sunday, 1=Monday
    
    // Monday: Common inventory refresh day
    IF current_day == 1:
        RETURN 7200  // 2 hours
    
    // Business hours (8 AM - 6 PM)
    IF current_hour >= 8 AND current_hour < 18:
        RETURN 14400  // 4 hours
    
    // Off-hours (6 PM - 8 AM)
    RETURN 43200  // 12 hours


// ============================================================================
// UTILITY: Record Inventory Update
// ============================================================================
FUNCTION recordInventoryUpdate(inventory_list):
    INPUT: inventory_list (Array of strings)
    OUTPUT: None
    
    current_hash = generateInventoryHash(inventory_list)
    previous_hash = GET_LAST_INVENTORY_HASH()
    
    IF current_hash != previous_hash:
        LOG("Inventory changed detected")
        LOG("  Previous hash: " + previous_hash)
        LOG("  New hash: " + current_hash)
        
        // Record timestamp
        UPDATE_HISTORY.append(CURRENT_TIMESTAMP())
        
        // Store current hash
        SET_LAST_INVENTORY_HASH(current_hash)
        
        // Invalidate all cache entries with old hash
        invalidateCacheByInventoryHash(previous_hash)
        
        METRICS.increment("inventory_updates")


// ============================================================================
// UTILITY: Invalidate Cache by Inventory Hash
// ============================================================================
FUNCTION invalidateCacheByInventoryHash(old_inventory_hash):
    INPUT: old_inventory_hash (String)
    OUTPUT: invalidated_count (Integer)
    
    invalidated_count = 0
    
    // Iterate through all cache keys
    FOR EACH key IN CACHE.keys():
        entry = CACHE.get(key)
        
        IF entry.inventory_hash == old_inventory_hash:
            CACHE.delete(key)
            invalidated_count++
    
    LOG("Invalidated " + invalidated_count + " cache entries")
    
    RETURN invalidated_count
```

## Data Structures

### Cache Entry Structure

```pseudocode
CacheEntry {
    data: {
        success: Boolean,
        extracted: Array<Object>,
        unmapped: Array<Object>
    },
    inventory_hash: String (16 chars),
    cached_at: Timestamp (Unix milliseconds),
    ttl: Integer (seconds)
}
```

### Inventory Update History

```pseudocode
InventoryUpdateHistory {
    updates: Array<{
        timestamp: Timestamp,
        inventory_hash: String,
        trigger: String  // "manual", "api", "scheduled"
    }>,
    max_size: 100  // Keep last 100 updates
}
```

### Cache Metrics

```pseudocode
CacheMetrics {
    hits: Integer,
    misses: Integer,
    invalidations: Integer,
    sets: Integer,
    inventory_updates: Integer,
    avg_ttl: Float,
    hit_rate: Float  // Calculated: hits / (hits + misses)
}
```

## Edge Cases & Error Handling

### Edge Case 1: Inventory Not Provided

```pseudocode
IF inventory_list IS null:
    // Fallback to simple caching without hash validation
    cache_key = generateSimpleCacheKey(files)
    cached_result = CACHE.get(cache_key)
    // No inventory validation
```

### Edge Case 2: Hash Collision (Extremely Rare)

```pseudocode
// Probability: ~1 in 10^19 with 16-char hex (64 bits)
// Mitigation: Use full SHA-256 if collision concerns exist

IF PARANOID_MODE:
    inventory_hash = SHA256(inventory).full_hex()  // 64 chars
ELSE:
    inventory_hash = SHA256(inventory).substring(0, 16)  // 16 chars
```

### Edge Case 3: Inventory Order Differs

```pseudocode
// ALWAYS sort inventory before hashing
FUNCTION generateInventoryHash(inventory_list):
    sorted_inventory = SORT(inventory_list)  // Alphabetical
    // This ensures ["A", "B"] and ["B", "A"] produce same hash
```

### Edge Case 4: Cache Stampede (Multiple Requests During Miss)

```pseudocode
// Use cache locking to prevent multiple simultaneous processing

FUNCTION getCachedWithLock(cache_key, inventory_hash):
    cached = getCachedWithValidation(cache_key, inventory_hash)
    
    IF cached IS null:
        // Check if another request is processing
        IF LOCK_EXISTS(cache_key):
            // Wait for other request to finish
            WAIT_FOR_LOCK_RELEASE(cache_key, timeout=5000)
            // Try cache again
            RETURN getCachedWithValidation(cache_key, inventory_hash)
        ELSE:
            // Acquire lock
            ACQUIRE_LOCK(cache_key)
            RETURN null  // Proceed with processing
    
    RETURN cached

// After processing, release lock
FUNCTION setCachedWithHashAndRelease(cache_key, result, inv_hash, ttl):
    setCachedWithHash(cache_key, result, inv_hash, ttl)
    RELEASE_LOCK(cache_key)
```

### Edge Case 5: TTL Expiration vs Hash Invalidation

```pseudocode
// Both mechanisms work independently:
// 1. TTL expiration: Cache entry removed after time limit
// 2. Hash invalidation: Cache entry removed when inventory changes

// Priority: Hash invalidation happens BEFORE TTL expiration check

FUNCTION getCachedWithValidation(cache_key, current_inv_hash):
    entry = CACHE.get(cache_key)  // Returns null if TTL expired
    
    IF entry IS null:
        RETURN null  // TTL expired
    
    IF entry.inventory_hash != current_inv_hash:
        CACHE.delete(cache_key)
        RETURN null  // Hash invalidated
    
    RETURN entry.data  // Valid cache hit
```

## Performance Considerations

### Hash Computation Overhead

```pseudocode
// Benchmark: SHA-256 hash of 1000-item inventory
// Time: ~1-2ms (negligible compared to OCR: 3-8 seconds)

FUNCTION benchmarkHashPerformance():
    inventory = GENERATE_INVENTORY(1000)  // 1000 items
    
    start = CURRENT_TIME_MS()
    FOR i FROM 0 TO 1000:
        hash = generateInventoryHash(inventory)
    end = CURRENT_TIME_MS()
    
    avg_time = (end - start) / 1000
    PRINT("Average hash time: " + avg_time + "ms")
    // Expected: 1-2ms per hash
```

### Memory Usage

```pseudocode
// Cache entry size estimation:
// - data: ~5-10 KB (OCR + parsed JSON)
// - inventory_hash: 16 bytes
// - cached_at: 8 bytes
// - ttl: 4 bytes
// Total: ~5-10 KB per entry

// For 1000 cached entries: ~5-10 MB (negligible)
```

### Cache Invalidation Performance

```pseudocode
// Worst case: Invalidate all cache entries
// Time complexity: O(n) where n = number of cache entries
// For 1000 entries: ~10-20ms (acceptable)

FUNCTION benchmarkInvalidation():
    // Fill cache with 1000 entries
    FOR i FROM 0 TO 1000:
        CACHE.set("key_" + i, {inventory_hash: "old_hash", data: {}})
    
    start = CURRENT_TIME_MS()
    invalidateCacheByInventoryHash("old_hash")
    end = CURRENT_TIME_MS()
    
    PRINT("Invalidation time: " + (end - start) + "ms")
    // Expected: 10-20ms for 1000 entries
```

## Testing Scenarios

### Test 1: Basic Hash Validation

```pseudocode
TEST "Cache hit with matching inventory hash":
    inventory = ["ITEM_A", "ITEM_B", "ITEM_C"]
    inv_hash = generateInventoryHash(inventory)
    
    // Cache result
    setCachedWithHash("key1", {data: "result"}, inv_hash, 3600)
    
    // Retrieve with same inventory
    result = getCachedWithValidation("key1", inv_hash)
    
    ASSERT result IS NOT null
    ASSERT result.data == "result"
```

### Test 2: Hash Invalidation

```pseudocode
TEST "Cache invalidated when inventory changes":
    inventory_v1 = ["ITEM_A", "ITEM_B"]
    hash_v1 = generateInventoryHash(inventory_v1)
    
    // Cache result with v1
    setCachedWithHash("key1", {data: "result_v1"}, hash_v1, 3600)
    
    // Inventory changes
    inventory_v2 = ["ITEM_A", "ITEM_B", "ITEM_C"]
    hash_v2 = generateInventoryHash(inventory_v2)
    
    // Try to retrieve with v2 hash
    result = getCachedWithValidation("key1", hash_v2)
    
    ASSERT result IS null  // Cache invalidated
```

### Test 3: Order Independence

```pseudocode
TEST "Inventory order doesn't affect hash":
    inventory_1 = ["ITEM_C", "ITEM_A", "ITEM_B"]
    inventory_2 = ["ITEM_A", "ITEM_B", "ITEM_C"]
    
    hash_1 = generateInventoryHash(inventory_1)
    hash_2 = generateInventoryHash(inventory_2)
    
    ASSERT hash_1 == hash_2
```

### Test 4: Adaptive TTL Calculation

```pseudocode
TEST "Adaptive TTL based on update history":
    // Simulate updates every 12 hours
    UPDATE_HISTORY = [
        NOW() - 36*HOURS,
        NOW() - 24*HOURS,
        NOW() - 12*HOURS,
        NOW()
    ]
    
    ttl = calculateAdaptiveTTL()
    
    // Expected: 50% of 12 hours = 6 hours = 21600 seconds
    ASSERT ttl == 21600
```

## Monitoring & Observability

### Metrics to Track

```pseudocode
METRICS {
    // Cache performance
    cache_hits: Counter,
    cache_misses: Counter,
    cache_invalidations: Counter,
    cache_hit_rate: Gauge,  // hits / (hits + misses)
    
    // Inventory tracking
    inventory_updates: Counter,
    inventory_hash_changes: Counter,
    avg_update_interval: Gauge,  // seconds
    
    // TTL effectiveness
    avg_ttl: Gauge,  // seconds
    ttl_strategy: Label,  // "static", "time_based", "adaptive"
    
    // Performance
    hash_computation_time: Histogram,  // milliseconds
    cache_lookup_time: Histogram,  // milliseconds
    invalidation_time: Histogram  // milliseconds
}
```

### Logging Examples

```pseudocode
LOG_INFO("Cache HIT: key=ocr_abc123_inv_def456, age=1234s")
LOG_INFO("Cache MISS: key=ocr_abc123_inv_def456")
LOG_WARN("Cache INVALIDATED: inventory changed (def456 → ghi789)")
LOG_INFO("Adaptive TTL: 21600s (6h) based on 12h avg update interval")
LOG_INFO("Invalidated 15 cache entries due to inventory update")
```
