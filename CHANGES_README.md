# KrushFlow Changes - January 2026

## Quick Summary

This update adds **item name editing**, **server-side project save**, **voice recording display**, and **GitHub push automation** to KrushFlow with minimal code changes.

---

## What Changed

### For Users

1. **Edit Item Names Before Saving**
   - After parsing inventory, you can now click "Edit" next to any item to change its name
   - Names are validated (no empty names, whitespace trimmed)
   - Editing is disabled after you save the list

2. **Save Projects to Server**
   - Enter a project name
   - Click "Save List (Server)" to persist your inventory
   - List becomes locked after saving
   - Continue to Voice Mapping when ready

3. **See What You Said**
   - In Voice Mapping, after recording an alias, you'll see:
     - "Recording: [your exact words]"
   - This confirms what the system heard

4. **No More Auto-Jump**
   - After parsing, you stay on the New Project screen
   - You choose when to go to Voice Mapping

### For Developers

1. **GitHub Push Script**
   ```bash
   npm run git:push
   ```
   - Automatically stages, commits, and pushes changes
   - Safe and simple

2. **New API Endpoints**
   - `POST /projects/save-master-list` - Save project
   - `GET /projects/:projectName/master-list` - Retrieve project

---

## Files Changed

- **index.html** - +149 lines (UI + client logic)
- **server.js** - +91 lines (new endpoints)
- **package.json** - +1 line (npm script)
- **scripts/push_to_github.sh** - NEW (54 lines)

**Total:** ~240 lines added, 11 lines removed

---

## How to Use

### 1. Pull Latest Changes

```bash
git pull origin main
```

### 2. Install Dependencies (if needed)

```bash
npm install
```

### 3. Start Server

```bash
npm start
```

### 4. Test the New Flow

**New Project:**
1. Upload inventory images
2. Parse
3. Edit item names as needed
4. Enter project name
5. Save to server
6. Download CSV/JSON (optional)
7. Continue to Voice Mapping

**Voice Mapping:**
1. Select an item
2. Record alias
3. See "Recording: [phrase]" appear
4. Repeat for all items

### 5. Push Your Changes

```bash
npm run git:push
```

Or with custom message:

```bash
npm run git:push "My custom commit message"
```

---

## Data Storage

Projects are saved to:
```
/home/ubuntu/zerofriction/data/projects/<ProjectName>/master_list.json
```

Example:
```json
{
  "projectName": "Main Kitchen Inventory",
  "items": ["CHICKEN BREAST", "SALMON FILLET", "BEEF TENDERLOIN"],
  "createdAt": "2026-01-06T12:00:00.000Z",
  "itemCount": 3
}
```

---

## Security Notes

- Project names are validated (letters, numbers, dash, underscore, spaces only)
- Path traversal attacks prevented
- No arbitrary file paths accepted from client
- All writes restricted to data directory

---

## Troubleshooting

### Save button not working?
- Check browser console for errors
- Verify project name is valid (no special characters)
- Check server logs

### Recording not showing?
- Check if `/process-voice` endpoint is working
- Verify microphone permissions
- Check browser console

### Git push failing?
- Ensure you're in the project root
- Check git credentials are configured
- Verify you have push access to the repository

---

## Rollback

If you need to undo these changes:

```bash
git log --oneline  # Find the commit before these changes
git revert <commit-hash>
git push origin main
```

---

## Documentation

- **AUDIT_FINDINGS.md** - Detailed audit of changes needed
- **IMPLEMENTATION_SUMMARY.md** - Complete technical documentation
- **CHANGES_README.md** - This file (user-friendly overview)

---

## Questions?

Review the implementation summary for technical details or check the audit findings for the reasoning behind each change.

**All changes follow the "minimal diff" principle - no rewrites, no refactors, just targeted improvements.**
