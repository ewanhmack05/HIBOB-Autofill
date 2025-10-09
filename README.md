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


https://github.com/user-attachments/assets/2de3ee26-8b9a-48d2-8e5f-d3cdfbadfd25


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

### Context Menu

- Right-click on a HiBob page → **Fill HiBob Project**

---

## How the Autofill Works

`content.js` types your saved values, waits briefly, then sends **ArrowDown → Enter** to commit the dropdowns (matches manual selection). It retries a few times with short delays to handle UI animation.

If your page is slower, increase the delay:

```js
// content.js
const SLOW_DELAY = 160; // try 220–300 if needed
```

Reload the extension after changing this value.

https://github.com/user-attachments/assets/625f5939-0b9a-4168-a798-e3f7a042ae67




---

## Privacy

- No data leaves your machine.
- The extension only reads network info while you’re on `app.hibob.com`.
- Data is stored in Chrome’s extension storage (`sync` for small values, `local` for cached lists).

---

## Development Tips
- If dropdowns are flaky, tune `SLOW_DELAY` (and related constants) in `content.js`.
