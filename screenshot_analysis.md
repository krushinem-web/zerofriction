# Screenshot Analysis - Response Format Issue

## Current Behavior (From Screenshot)

**Last command:**
"real house chicken breast at 92 6 oz chicken at 45 spicy bites at 22 T-Bones at 15"

**Current response format:**
```
CHICKEN PRESEASONED (LB)    0
CHIC POUNDED (PO)           92
```

## Problem Identified

The response is showing:
1. Multiple items being interpreted
2. Item names from inventory list
3. Counts

But the user wants a **simpler format** for the "Last command" section:
- Just the raw text that was interpreted
- The matched inventory item
- The count

## Required Changes

### Current Response Structure (Complex)
```json
{
  "items": [
    {"item": "EXACT_INVENTORY_NAME", "count": 6, "confidence": "high"},
    {"item": "EXACT_INVENTORY_NAME", "count": 12, "confidence": "medium"}
  ],
  "unmapped": [...]
}
```

### Desired Response Structure (Simple)
```json
{
  "raw_text": "ribeyes twelve",
  "matched_item": "RIBEYE 12OZ",
  "count": 12
}
```

## Additional Request

Remove any prompts that are attached to API calls (simplify the LLM prompts).
