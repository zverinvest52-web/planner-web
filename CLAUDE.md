# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is the **Web App companion** for the Telegram Task Planner Bot. It's a Progressive Web App (PWA) built with vanilla JavaScript that integrates with Telegram Web App API and Firebase Realtime Database. The app provides a mobile-first interface for task management with support for photos, categories, and dark/light themes.

## File Structure

```
web-export/
├── index.html           # Main HTML with cache-busting version parameters
├── app.js              # All application logic (~1900 lines)
├── style.css           # All styles including responsive design
├── firebase-config.js  # Firebase configuration
├── manifest.json       # PWA manifest
├── sw.js              # Service Worker for offline support
└── icon.png           # App icon
```

## Version Management

The app uses cache-busting via version parameters. When updating the app, **all three places** must be updated:
1. `index.html`: Links (`?v=X.X`) and `CURRENT_VERSION` constant
2. `style.css`: Update comment (optional)
3. `app.js`: `console.log` version message

The version check in `index.html` unregisters service workers and forces reload when version changes.

## Key Architecture Patterns

### State Management
- Global variables in `app.js` (`tasks`, `categories`, `selectedDate`, `selectedCategory`, etc.)
- LocalStorage for persistence with `validateAndRepairData()` on load
- Firebase sync for real-time updates (optional, configured in `firebase-config.js`)

### Telegram Web App Integration
- Theme sync with Telegram's color scheme (`light`/`dark`)
- Haptic feedback via `hapticImpact()` function
- Back button handling for navigation
- Header customization

### Data Structure
```
Tasks: Array of { id, title, desc, date, time, category, completed, photos[] }
Categories: Array of strings (default: ['ОБЩИЕ', 'РАБОТА', 'ДОМ', 'ЛИЧНЫЕ'])
```

### Tab Navigation System
Tabs are managed via `currentTab` variable:
- `home`: Main task list by category
- `calendar`: Calendar view
- `stats`: Statistics view
- `settings`: Settings page

### Modal System
- `modal-add-task`: Wizard-style task creation (4 steps)
- `modal-view-task`: Task details viewing/editing
- Modal visibility controlled via `.hidden` class

### Responsive Design
- Mobile-first design with breakpoints at 768px, 1024px, and 1440px
- Desktop mode centers content with max-width constraints
- CSS variables for theming (`--bg-light`, `--card-white`, `--accent-red`, etc.)

## Important Development Notes

### Recently Removed Features (v56.0)
The following features were removed in v56.0 to simplify the codebase:
- **Draft autosave**: `saveDraft()`, `loadDraft()`, `clearDraft()` functions removed
- **Voice input**: `startVoiceInput()`, speech recognition, and microphone button removed

Do NOT re-add these without explicit user request.

### Desktop Display Fix (v56.0)
The responsive CSS was fixed to prevent empty screens on desktop:
- Removed problematic `display: flex` on body for tablet+
- Removed `height: 100vh` and `overflow: hidden` from `.app-container`

When modifying responsive CSS, ensure content remains visible on all screen sizes.

### Data Validation
The app uses `validateAndRepairData()` on startup to fix corrupted LocalStorage data. Always validate array types and filter out invalid objects.

### Category System
Categories are case-sensitive for display but normalized internally. The default categories are uppercase in Russian.

### Theme Switching
Themes use CSS classes on body:
- `light-theme`: Default (light background)
- `dark-theme`: Dark mode (synced with Telegram)

CSS transitions are applied for smooth theme switching.

### Service Worker
The service worker (`sw.js`) handles offline caching but is unregistered on version updates to force cache refresh.

## Common Tasks

### Adding a New Feature
1. Update UI in `index.html` if needed
2. Add logic to `app.js`
3. Add styles to `style.css`
4. Update version numbers in all three locations
5. Test on mobile and desktop

### Modifying Task Data Structure
1. Update the relevant sections in `app.js`
2. Ensure `validateAndRepairData()` handles the new structure
3. Update Firebase sync logic if applicable

### Styling Changes
- Use CSS custom properties for colors to maintain theme support
- Test both light and dark themes
- Verify responsive behavior at breakpoints (768px, 1024px, 1440px)

## Deployment

The app is deployed to GitHub and hosted via static hosting (likely GitHub Pages or similar). After committing changes:
1. Push to main branch
2. The version cache busting ensures users get the latest version
3. Service worker is automatically unregistered on version change

## Firebase Configuration

Firebase credentials are in `firebase-config.js`. For production, consider loading these from environment variables or a secure backend instead of hardcoding.
