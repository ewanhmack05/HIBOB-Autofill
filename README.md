# HiBob Project Filler

A Chrome extension that saves your **Project**, **Project task**, and **Reason** in a popup and auto-fills the HiBob Attendance modal (uses the reliable “type → ArrowDown → Enter” commit flow, a.k.a. v7 behavior). Includes a checkbox to enable automatic filling when the modal opens, plus a **Fill Now** action and keyboard shortcut.

---

## Features

- 🔁 One-click **Fill Now** (or auto-fill when the modal appears)
- ⌨️ Robust dropdown commit: **ArrowDown → Enter** with retries/delays
- 📝 Remembers **Project**, **Project task**, **Reason**
- ✅ Optional live suggestions in the popup (when background has cached lists)
- ⚙️ Minimal, local-only storage; no external servers

---

## Folder Structure

```
hibob-project-filler/
├─ manifest.json
├─ background.js
├─ content.js
├─ popup.html
├─ popup.js
└─ icon128.png
```

> Use the matching files from this repo; they are designed to work together.

---

## Requirements

- Google Chrome (or Chromium-based browser) with **Manifest V3** support

---

## Installation (Load Unpacked)

1. Open Chrome and navigate to `chrome://extensions/`
2. Toggle **Developer mode** (top-right)
3. Click **Load unpacked**
4. Select the project folder (`hibob-project-filler/`)
5. The extension icon should appear in the toolbar (pin it if you like)

> After editing any file, click **Reload** on the extension card to apply changes.

---

## Usage

1. Click the extension icon to open the popup.
2. Fill in:
   - **Project** (textbox; shows suggestions if available)
   - **Project task** (suggestions filter after you enter a Project)
   - **Reason**
3. (Optional) Check **Enable auto-fill** to fill automatically when the HiBob modal opens.
4. Click **Save Settings**.
5. Click **Fill Now** to run it on the current HiBob page.

### Keyboard Shortcut

- **Windows / Linux:** `Ctrl + Shift + Y`  
- **macOS:** `⌘ + Shift + Y`

### Context Menu

- Right-click on a HiBob page → **Fill HiBob Project**

---

## How the Autofill Works (v7)

`content.js` types your saved values, waits briefly, then sends **ArrowDown → Enter** to commit the dropdowns (matches manual selection). It retries a few times with short delays to handle UI animation.

If your page is slower, increase the delay:

```js
// content.js
const SLOW_DELAY = 160; // try 220–300 if needed
```

Reload the extension after changing this value.

---

## Optional: Live Suggestions in the Popup

- When the background service worker has captured your employee ID (from a HiBob internal request) and fetched projects/tasks, the popup shows **autocomplete** suggestions for Project/Task.
- If suggestions aren’t available yet, the popup still works as plain text fields—no extra setup required.

---

## Permissions (What & Why)

- `"webRequest"` + **host permissions** for `https://app.hibob.com/*`  
  Used to **observe** a HiBob POST that includes your employee ID so we can fetch the Project/Task list *(optional quality-of-life; autofill still works without it)*.
- `"storage"`  
  Saves **project**, **task**, **reason**, and your toggle preference.
- `"scripting"`, `"activeTab"`, `"contextMenus"`  
  Allows the popup/hotkey/context menu to run the content script on the active HiBob tab.

All data stays local in your browser’s extension storage.

---

## Troubleshooting

**Project textbox won’t accept typing**  
- Ensure `popup.html` has **unique IDs** and correct `list` links:
  - Project → `id="project"` and `list="projectsList"`
  - Task → `id="task"` and `list="tasksList"`
- Confirm you’re using the **textbox + datalist** version of `popup.js` (not the `<select>` version)

**“Unchecked runtime.lastError: No SW” in the popup**  
- The background service worker is asleep (normal).  
- The popup falls back to local cache; everything still works.  
- If you want live suggestions, open HiBob first (wakes the SW), then reopen the popup.

**“Service worker registration failed… types: fetch”**  
- In `background.js`, do **not** use `"fetch"` in the `webRequest` filter `types`.  
  Use `types: ["xmlhttprequest"]` or omit `types` completely.

**“This request exceeds MAX_WRITE_OPERATIONS_PER_MINUTE”**  
- Large payloads are stored in `chrome.storage.local` and small writes are throttled.  
- Avoid writing to `chrome.storage.sync` in loops or for every network event.

**Auto-fill toggle doesn’t seem to work**  
- The checkbox controls **automatic** filling on modal open only.  
- Manual **Fill Now** always works.  
- `popup.js` writes both `autofillModal` and `autoFillEnabled` for compatibility; `content.js` reads `autofillModal`.

---

## Privacy

- No data leaves your machine.
- The extension only reads network info while you’re on `app.hibob.com`.
- Data is stored in Chrome’s extension storage (`sync` for small values, `local` for cached lists).

---

## Development Tips

- Use the **Service Worker** console from `chrome://extensions` (click the “service worker” link on the extension card).
- To test autofill, open a HiBob Attendance modal and click **Fill Now**.
- If dropdowns are flaky, tune `SLOW_DELAY` (and related constants) in `content.js`.
