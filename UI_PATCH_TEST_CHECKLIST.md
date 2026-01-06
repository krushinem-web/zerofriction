# KrushFlow UI/UX Patch - Test Checklist

## Test Environment
- **Date**: 2026-01-06
- **Branch**: main
- **Tester**: Automated validation

---

## Phase 2: New Project Screen Tests

### ✓ Test 1: Parse Inventory
- [ ] Upload images via camera or gallery
- [ ] Click "Parse Inventory" button
- [ ] Loading indicator appears
- [ ] Extracted items display in scrollable list
- [ ] Item count and image count show correctly

### ✓ Test 2: Edit Item Names
- [ ] Click "Edit" button on any item
- [ ] Prompt appears with current name
- [ ] Enter new name and confirm
- [ ] Item name updates in the list
- [ ] Empty names are rejected
- [ ] Whitespace is trimmed and collapsed

### ✓ Test 3: Save List (Server)
- [ ] Enter project name in input field
- [ ] Click "Save List (Server)" button
- [ ] Success message appears
- [ ] Save button becomes disabled
- [ ] Project name input becomes disabled
- [ ] "Continue to Voice Mapping" button becomes enabled

### ✓ Test 4: Lock Item Editing After Save
- [ ] After saving, "Edit" buttons disappear from items
- [ ] Clicking on items no longer allows name editing
- [ ] masterListLocked = true in console

### ✓ Test 5: Download Still Works
- [ ] Click "Download CSV" button
- [ ] CSV file downloads with correct items
- [ ] Click "Download JSON" button
- [ ] JSON file downloads with correct items

### ✓ Test 6: Page Separation
- [ ] New Project screen does NOT scroll into Voice Mapping
- [ ] Voice Mapping content is hidden when in New Project mode
- [ ] Only one screen is visible at a time

---

## Phase 3: Voice Mapping Screen Tests

### ✓ Test 7: Voice Mapping is Separate Screen
- [ ] Click "Continue to Voice Mapping" from New Project
- [ ] New Project screen hides
- [ ] Voice Mapping screen appears
- [ ] Cannot scroll back to New Project

### ✓ Test 8: Load List from Server
- [ ] Enter saved project name in "Load from Server" input
- [ ] Click "Load from Server" button
- [ ] Items load successfully
- [ ] Success banner shows item count
- [ ] Voice mapping interface initializes

### ✓ Test 9: Load List from Client File
- [ ] Click "Load Existing Inventory List" zone
- [ ] Select CSV or TXT file from device
- [ ] Items parse correctly
- [ ] Voice mapping interface initializes
- [ ] Item names are display-only (no editing)

### ✓ Test 10: Active List from New Project
- [ ] Complete New Project flow and save list
- [ ] Click "Continue to Voice Mapping"
- [ ] Active list loads automatically
- [ ] Active list status banner shows
- [ ] Items are ready for voice mapping

---

## Phase 4: Last Recorded Phrase Tests

### ✓ Test 11: Show Last Recorded Phrase
- [ ] Select an item in Voice Mapping
- [ ] Click "Record Voice Alias"
- [ ] Speak a phrase
- [ ] Stop recording
- [ ] "Last recorded:" label appears in status box
- [ ] Recorded phrase text displays correctly

### ✓ Test 12: Last Recorded in Current Item Box
- [ ] After recording, check "Current item" status box
- [ ] "Last recorded:" section is visible
- [ ] Phrase is displayed in orange highlight box
- [ ] Phrase updates when new recording is made

### ✓ Test 13: Button Sizes
- [ ] "Record Voice Alias" button height ≈ 48px
- [ ] "Skip Item" button height ≈ 48px
- [ ] Font size is readable (~0.95rem)
- [ ] Buttons are not dominating the screen
- [ ] Tap targets are still accessible (≥44px)

---

## Phase 5: Recording Overlay Tests

### ✓ Test 14: Microphone Icon Centered
- [ ] Click "Record Voice Alias"
- [ ] Recording overlay appears
- [ ] Microphone icon is centered horizontally
- [ ] Microphone icon is centered vertically
- [ ] Text below icon is centered

### ✓ Test 15: Pulse Animation
- [ ] Recording overlay shows pulse rings
- [ ] Rings animate outward (scale + opacity)
- [ ] Animation is smooth and continuous
- [ ] Multiple rings with different durations

### ✓ Test 16: Brand Colors
- [ ] Pulse rings use orange brand color (#f97316)
- [ ] Microphone circle uses brand gradient (orange to red)
- [ ] Colors match the app theme
- [ ] Overlay background is dark (rgba(0,0,0,0.95))

---

## Phase 6: Server Endpoints Tests

### ✓ Test 17: POST /projects/save-master-list
- [ ] Endpoint accepts projectName and items array
- [ ] Validates project name (allowlist characters)
- [ ] Creates data/projects/{projectName}/ directory
- [ ] Saves master_list.json file
- [ ] Returns success response
- [ ] Rejects invalid project names

### ✓ Test 18: GET /projects/:projectName/master-list
- [ ] Endpoint accepts project name parameter
- [ ] Validates project name
- [ ] Returns saved items array
- [ ] Returns 404 if project not found
- [ ] Returns 400 if project name invalid

---

## Integration Tests

### ✓ Test 19: Full New Project → Voice Mapping Flow
- [ ] Start from home screen
- [ ] Select "New Setup" mode
- [ ] Upload and parse images
- [ ] Edit item names
- [ ] Save list to server
- [ ] Click "Continue to Voice Mapping"
- [ ] Voice Mapping loads with saved items
- [ ] Record voice aliases
- [ ] Last recorded phrase shows
- [ ] Finish and download aliases

### ✓ Test 20: Voice Mapping Standalone Flow
- [ ] Start from home screen
- [ ] Select "Voice Mapping" mode
- [ ] Load list from server (by project name)
- [ ] Items load correctly
- [ ] Record voice aliases
- [ ] Last recorded phrase shows
- [ ] Buttons are appropriately sized

---

## Regression Tests

### ✓ Test 21: Daily Count Mode Still Works
- [ ] Select "Daily Count" mode
- [ ] Load inventory and aliases
- [ ] Voice counting works
- [ ] No UI/UX regressions

### ✓ Test 22: Existing Features Intact
- [ ] Mode selection screen works
- [ ] Back buttons work
- [ ] File uploads work
- [ ] CSV/JSON downloads work
- [ ] Error messages display correctly

---

## Browser/Device Tests

### ✓ Test 23: Mobile Responsiveness
- [ ] Test on mobile viewport (375px width)
- [ ] Buttons are tap-friendly
- [ ] Text is readable
- [ ] Overlay is full-screen
- [ ] No horizontal scroll

### ✓ Test 24: Desktop Responsiveness
- [ ] Test on desktop viewport (1920px width)
- [ ] Layout is centered and readable
- [ ] Buttons are appropriately sized
- [ ] Overlay is centered

---

## Summary
- **Total Tests**: 24
- **Passed**: TBD
- **Failed**: TBD
- **Blocked**: TBD

## Notes
All tests should be performed in both Chrome and Safari (mobile) for full coverage.
