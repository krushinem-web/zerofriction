# KrushFlow Audit Findings

## Date: 2026-01-06

## Current State Analysis

### File Structure
```
/home/ubuntu/zerofriction/
├── index.html (4671 lines - single-file app)
├── server.js (Node.js/Express backend)
├── package.json
├── cache.js
├── credentialManager.js
├── database.js
├── test_inventory_hash.js
└── utils.js
```

### Key Findings

#### 1. AUTO-NAVIGATION ISSUE (Line 1680-1685)
**Location:** index.html, lines 1680-1685
**Problem:** After parsing completes, app auto-navigates to Voice Mapping after 2 seconds
```javascript
setTimeout(() => {
    selectMode('voice-mapping');
    console.log('[Option A] Auto-navigation complete');
}, 2000);
```
**Fix Required:** Remove this auto-navigation; user should manually navigate after editing/saving

#### 2. NO ITEM NAME EDITING IN NEW PROJECT
**Location:** index.html, parse results display section
**Problem:** After parsing, items are displayed but cannot be edited
**Current Behavior:** Items saved directly to localStorage via `saveActiveList()`
**Fix Required:** Add editable list UI with click-to-edit functionality before save

#### 3. NO SERVER-SIDE MASTER LIST SAVE
**Location:** server.js
**Problem:** No endpoint exists to save finalized master list to server
**Current Behavior:** Only localStorage (client-side) save via `saveActiveList()`
**Fix Required:** Add POST /projects/save-master-list endpoint

#### 4. NO PROJECT NAME INPUT
**Location:** index.html, New Project screen
**Problem:** No project name field exists
**Fix Required:** Add project name input field before save

#### 5. VOICE MAPPING RECORDING DISPLAY
**Location:** index.html, Voice Mapping section
**Problem:** "Current item" status doesn't show the last recorded phrase
**Fix Required:** Update status box to display the recorded transcript after each recording

#### 6. NO GITHUB PUSH SCRIPT
**Location:** Root directory
**Problem:** No automated way to push changes back to GitHub
**Fix Required:** Add scripts/push_to_github.sh and npm command

### Existing Functionality (Keep Intact)

✓ Parse images via Claude Vision API (POST /parse)
✓ Active list storage in localStorage
✓ Voice mapping interface exists
✓ Download CSV/JSON functionality
✓ Mode switching (selectMode function)

## Implementation Plan

### Phase 1: Client-Side Changes (index.html)

#### A. Remove Auto-Navigation
- Line 1680-1685: Delete setTimeout auto-navigation code

#### B. Add Item Name Editing UI
- Add state flags: `masterListLocked`, `currentProjectName`, `listSaved`
- Make list items clickable for editing
- Add validation: trim, collapse whitespace, reject empty
- Disable editing after save

#### C. Add Project Save Controls
- Add project name input field
- Add "Save List (Server)" button
- Add "Continue to Voice Mapping" button (disabled until save)
- Wire up save to new server endpoint

#### D. Update Voice Mapping Recording Display
- Add `lastRecordedPhrase` variable
- Update "Current item" status box to show recording text

### Phase 2: Server-Side Changes (server.js)

#### A. Add Master List Save Endpoint
```javascript
POST /projects/save-master-list
Input: { projectName: string, items: string[] }
Output: { success: boolean }
Storage: /home/ubuntu/zerofriction/data/projects/<projectName>/master_list.json
```

#### B. Add Master List Retrieve Endpoint (Optional)
```javascript
GET /projects/:projectName/master-list
Output: { items: string[] } or 404
```

### Phase 3: GitHub Push Script

#### A. Create Script
- File: scripts/push_to_github.sh
- Functionality: git status, add, commit, push

#### B. Add npm Command
- package.json: "git:push": "bash scripts/push_to_github.sh"

## Critical Rules Compliance

✓ NO rewrite of entire project
✓ Preserve existing file structure
✓ Minimal localized diffs only
✓ index.html file naming rule (not applicable - already correct)
✓ Safe GitHub push (local script, not server endpoint)

## Next Steps

1. Implement client-side changes in index.html
2. Implement server-side endpoints in server.js
3. Create GitHub push script
4. Test all acceptance criteria
5. Push to GitHub repository
