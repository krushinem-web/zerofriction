# Daily Count "Last Command" Fixes

## Issues Found

### 1. HTML Entity Encoding Bug
**Location:** `index.html` lines 2645, 2668  
**Problem:** Using `&#10003;` (HTML entity for checkmark) in `textContent`  
**Impact:** Displays as literal `&#10003;` instead of ✓  
**Fix:** Use plain Unicode "✓" character or boolean flag

### 2. Missing Structured Data
**Location:** `/interpret-multi-count` endpoint in `server.js`  
**Problem:** Returns generic array format, not single-item structured response  
**Current format:**
```json
{
  "items": [{"item": "...", "count": 12}],
  "unmapped": [...]
}
```
**Needed format** (for single-item last command):
```json
{
  "raw_phrase": "ribeyes twelve",
  "mapped_item": "RIBEYE 12OZ",
  "count": 12,
  "updated": true
}
```

### 3. Non-Clickable Last Command
**Location:** `index.html` lines 2695-2700  
**Problem:** `showLastCommand()` just sets `textContent`, no clickable tokens  
**Fix:** Create clickable chips for raw_phrase, mapped_item, count

### 4. No Remap Persistence
**Location:** Missing functionality  
**Problem:** No way to correct wrong mappings  
**Fix:** Add remap modal + alias persistence to localStorage

## Implementation Plan

### Phase 1: Fix Entity Encoding
- Replace `&#10003;` with plain "✓" in lines 2645, 2668
- Use boolean `updated` flag from API

### Phase 2: Update API Response
- Keep `/interpret-multi-count` as-is (handles multi-item)
- Extract first item for "Last command" display
- Add fields: `raw_phrase`, `mapped_item`, `count`

### Phase 3: Clickable Tokens UI
- Modify `showLastCommand()` to render 3 clickable chips
- Token A: raw_phrase (click = open remap)
- Token B: mapped_item (click = open remap)
- Token C: count (click = edit count)

### Phase 4: Remap Modal
- Create modal overlay (similar to download dialog)
- Search/filter master items
- Confirm button persists to `dailyAliases` + localStorage

### Phase 5: Count Edit Modal
- Simple numeric input
- Update `inventoryCounts[item]`
- Re-render list
