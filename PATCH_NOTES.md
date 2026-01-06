# KrushFlow UI/UX Patch Notes

## Overview
Minimal localized patches applied to fix UI/UX issues identified in audit.

## Changes Applied

### Phase 2: Page Separation and New Project Edit-Lock Flow
- [ ] Add view toggle functions (showNewProject, showVoiceMapping)
- [ ] Prevent scrolling from New Project into Voice Mapping
- [ ] Add click-to-edit for item names in New Project
- [ ] Add Save List (Server) functionality with lock
- [ ] Add "Go to Voice Mapping" button (enabled after save)
- [ ] Lock item name editing after save

### Phase 3: Voice Mapping List Loader
- [ ] Add "Load List" section in Voice Mapping
- [ ] Implement server-side list loading (dropdown + button)
- [ ] Implement client-side file loading (file input)
- [ ] Lock item names in Voice Mapping (display only)

### Phase 4: Show Last Recorded Phrase
- [ ] Add "Last recorded" label in Voice Mapping
- [ ] Update label when recording stops
- [ ] Show in "Current item" status box

### Phase 5: Button Resize
- [ ] Reduce Record Voice Alias button size
- [ ] Reduce Skip Item button size
- [ ] Maintain accessible tap targets (44px min)

### Phase 6: Recording Overlay Improvements
- [ ] Center microphone icon (flexbox)
- [ ] Add pulse/radiate animation
- [ ] Apply brand colors from logo.png or theme

### Phase 7: Server-Side Endpoints
- [ ] POST /projects/save-master-list
- [ ] GET /projects/:projectName/master-list
- [ ] Add path validation and security

### Phase 8: GitHub Push Script
- [ ] Create scripts/push_to_github.sh
- [ ] Add npm script "git:push"

## Testing Checklist
- [ ] Parse inventory -> items appear
- [ ] Click item -> edit name -> updates
- [ ] Save List -> locks editing
- [ ] Download still works
- [ ] Cannot scroll into Voice Mapping from New Project
- [ ] Voice Mapping is separate screen
- [ ] Load list from server works
- [ ] Load list from client works
- [ ] Last recorded phrase shows
- [ ] Buttons are smaller
- [ ] Recording overlay centered with pulse animation
