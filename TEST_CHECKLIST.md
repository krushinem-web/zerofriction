# KrushFlow Test Checklist

Use this checklist to verify all changes are working correctly.

---

## Pre-Testing Setup

- [ ] Server is running (`npm start`)
- [ ] Browser is open to http://localhost:3000
- [ ] Browser console is open (F12)
- [ ] Test images ready for upload

---

## Test 1: New Project - Item Name Editing

### Steps:
1. [ ] Click "New Setup" mode
2. [ ] Upload 2-3 test images
3. [ ] Click "Parse Inventory"
4. [ ] Wait for parsing to complete
5. [ ] Verify items appear in scrollable list
6. [ ] Verify each item has an "Edit" button
7. [ ] Click "Edit" on first item
8. [ ] Change name to "TEST ITEM 1"
9. [ ] Verify name updates in list
10. [ ] Try to edit with empty name
11. [ ] Verify error message appears
12. [ ] Try to edit with "  Extra   Spaces  "
13. [ ] Verify spaces are trimmed and collapsed

### Expected Results:
- ✓ Edit buttons visible on all items
- ✓ Name changes immediately after edit
- ✓ Empty names rejected
- ✓ Whitespace normalized
- ✓ No auto-navigation to Voice Mapping

---

## Test 2: New Project - Server-Side Save

### Steps:
1. [ ] After parsing, locate "Project Name" input field
2. [ ] Try clicking "Save List (Server)" without entering name
3. [ ] Verify error message appears
4. [ ] Enter project name: "Test Project 2026"
5. [ ] Click "Save List (Server)"
6. [ ] Wait for save to complete
7. [ ] Verify success message appears
8. [ ] Verify "Continue to Voice Mapping" button is enabled
9. [ ] Verify Edit buttons are now hidden/disabled
10. [ ] Verify project name input is disabled
11. [ ] Try to edit an item name
12. [ ] Verify "List is locked" message appears

### Expected Results:
- ✓ Save requires project name
- ✓ Success message shows
- ✓ Edit buttons disappear after save
- ✓ Continue button enabled
- ✓ List locked (no more edits)

---

## Test 3: New Project - Download Still Works

### Steps:
1. [ ] After saving, click "Download CSV"
2. [ ] Verify CSV file downloads
3. [ ] Open CSV and verify items are correct
4. [ ] Click "Download JSON"
5. [ ] Verify JSON file downloads
6. [ ] Open JSON and verify structure

### Expected Results:
- ✓ CSV downloads with correct items
- ✓ JSON downloads with correct structure
- ✓ Downloads work before AND after save

---

## Test 4: Voice Mapping - Navigation

### Steps:
1. [ ] From New Project (after save), click "Continue to Voice Mapping"
2. [ ] Verify Voice Mapping screen opens
3. [ ] Verify items from saved list appear
4. [ ] Verify NO Edit buttons on items
5. [ ] Go back to home
6. [ ] Click "Voice Mapping" directly
7. [ ] Verify saved list loads automatically

### Expected Results:
- ✓ Navigation only via button (no auto-jump)
- ✓ Items display without edit buttons
- ✓ Saved list persists across navigation

---

## Test 5: Voice Mapping - Recording Display

### Steps:
1. [ ] In Voice Mapping, select first item
2. [ ] Verify "Current item: [item name]" appears
3. [ ] Verify NO recording text yet
4. [ ] Click "Record Voice Alias"
5. [ ] Speak clearly: "test phrase one"
6. [ ] Stop recording
7. [ ] Wait for processing
8. [ ] Verify "Recording: test phrase one" appears in status box
9. [ ] Select second item
10. [ ] Verify recording text clears
11. [ ] Record another alias: "test phrase two"
12. [ ] Verify "Recording: test phrase two" appears

### Expected Results:
- ✓ Recording text shows after each recording
- ✓ Exact phrase displayed (not paraphrased)
- ✓ Recording text clears when changing items
- ✓ Recording text visible in "Current item" status box

---

## Test 6: Voice Mapping - Alias List

### Steps:
1. [ ] After recording aliases, scroll to alias list
2. [ ] Verify recorded aliases appear in list
3. [ ] Verify list uses existing format (not redesigned)
4. [ ] Record multiple aliases for same item
5. [ ] Verify all aliases show in list

### Expected Results:
- ✓ Alias list unchanged (same format as before)
- ✓ All recorded aliases visible
- ✓ No design changes to alias list

---

## Test 7: GitHub Push Script

### Steps:
1. [ ] Open terminal in project root
2. [ ] Make a small test change (e.g., add comment to server.js)
3. [ ] Run: `npm run git:push`
4. [ ] Verify script shows current branch
5. [ ] Verify script shows git status
6. [ ] Verify script commits changes
7. [ ] Verify script pushes to GitHub
8. [ ] Check GitHub repository
9. [ ] Verify commit appears

### Expected Results:
- ✓ Script runs without errors
- ✓ Changes committed
- ✓ Changes pushed to GitHub
- ✓ Commit visible on GitHub

---

## Test 8: Server Endpoints (Optional - Advanced)

### Steps:
1. [ ] Open terminal
2. [ ] Run save endpoint test:
   ```bash
   curl -X POST http://localhost:3000/projects/save-master-list \
     -H "Content-Type: application/json" \
     -d '{"projectName":"API Test","items":["Item A","Item B","Item C"]}'
   ```
3. [ ] Verify response: `{"success":true,"projectName":"API Test","itemCount":3}`
4. [ ] Run retrieve endpoint test:
   ```bash
   curl http://localhost:3000/projects/API_Test/master-list
   ```
5. [ ] Verify response includes items array
6. [ ] Check file system:
   ```bash
   cat data/projects/API_Test/master_list.json
   ```
7. [ ] Verify JSON file exists and is valid

### Expected Results:
- ✓ Save endpoint returns success
- ✓ Retrieve endpoint returns saved data
- ✓ File created in correct location
- ✓ JSON structure correct

---

## Test 9: Error Handling

### Steps:
1. [ ] Try saving with invalid project name: "Test/Project"
2. [ ] Verify error message
3. [ ] Try saving empty items array
4. [ ] Verify error message
5. [ ] Try retrieving non-existent project
6. [ ] Verify 404 error

### Expected Results:
- ✓ Invalid characters rejected
- ✓ Empty arrays rejected
- ✓ Missing projects return 404
- ✓ Clear error messages shown

---

## Test 10: Regression Testing

### Steps:
1. [ ] Test existing Daily Count mode
2. [ ] Verify it still works
3. [ ] Test existing Voice Mapping (without New Project)
4. [ ] Upload master alias CSV
5. [ ] Verify it still works
6. [ ] Test all existing buttons and features

### Expected Results:
- ✓ No existing features broken
- ✓ All modes still functional
- ✓ No unexpected behavior

---

## Issue Reporting Template

If you find a bug, report it with this format:

```
**Test:** [Test number and name]
**Step:** [Which step failed]
**Expected:** [What should happen]
**Actual:** [What actually happened]
**Browser Console:** [Any errors shown]
**Server Logs:** [Any errors shown]
```

---

## Success Criteria

All checkboxes above should be checked (✓) for full acceptance.

**Minimum for deployment:**
- Tests 1-6 must pass (core functionality)
- Test 7 should pass (developer workflow)
- Tests 8-10 optional but recommended

---

## Notes

- Test in Chrome/Edge first (primary browsers)
- Test on mobile if possible (responsive design)
- Keep browser console open to catch errors
- Check server logs for backend issues

---

**Testing Complete?** Push to production and notify users of new features!
