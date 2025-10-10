# HiBob Project Filler

A Chrome (MV3) extension that remembers your **Project**, **Project task**, and **Reason**, and auto-fills the HiBob Attendance modal. It supports **autosuggest** as you type, a fixed **Reason** dropdown, and ⭐ **Favourites** you can one-click to instantly fill the modal.

---

## Features

- ⚡ **Fill Now** button + optional **auto-fill when the modal opens**
- 🧠 **Autosuggest** for Project/Task (from a local `static-projects.json`)
- 🗂️ **Favourites**: save current Project/Task/Reason as chips; click a chip to **auto-fill immediately**
- ✅ **Reason** is a dropdown with 3 options:
  - Manual Entry
  - Forgot to clock in
  - Other, see notes
- 🎨 Custom toolbar icon (teal **H**, `rgb(70,136,136)`)

---

## Folder structure

```
hibob-project-filler/
├─ manifest.json
├─ background.js
├─ content.js
├─ popup.html
├─ popup.js
├─ static-projects.json
└─ icons/
   ├─ icon16.png
   ├─ icon32.png
   ├─ icon48.png
   └─ icon128.png
```

---

## Install (Load Unpacked)

1. Go to `chrome://extensions/`
2. Enable **Developer mode**
3. Click **Load unpacked** and select the project folder
4. (Optional) Pin the extension to the toolbar

> After editing files, click **Reload** on the extension card.

---

## Usage

1. Click the extension icon to open the popup.
2. Type to select a **Project** and **Project task** (autosuggest helps).
3. Choose a **Reason** from the dropdown.
4. (Optional) Toggle **Enable auto-fill** (fills automatically when the HiBob modal opens).
5. Click **Save Settings** or hit **Fill Now** to apply to the current HiBob page.

### Favourites (fast switching)

- Click **⭐ Save current as favourite** to add a chip.
- Click a **chip** to:
  1) load its Project/Task/Reason,  
  2) save them,  
  3) **auto-fill the modal**, and  
  4) close the popup.
- Click **×** on a chip to remove it.

---

## Data source: `static-projects.json`

Autosuggest uses a local file so no network tapping is required. The expected shape:

```json
{
  "results": [
    {
      "name": "Project A",
      "tasks": [
        { "name": "Task 1" },
        { "name": "Task 2" }
      ]
    },
    {
      "name": "Project B",
      "tasks": []
    }
  ]
}
```

> Keep **only** `name` fields (projects and tasks). Archived/IDs/billable/etc. are not needed.

---

## Icon

Place teal **H** icons here:

```
icons/icon16.png
icons/icon32.png
icons/icon48.png
icons/icon128.png
```

Update `manifest.json`:

```json
{
  "action": {
    "default_title": "HiBob Project Filler",
    "default_popup": "popup.html",
    "default_icon": {
      "16": "icons/icon16.png",
      "32": "icons/icon32.png"
    }
  },
  "icons": {
    "16": "icons/icon16.png",
    "32": "icons/icon32.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  }
}
```

---

## Permissions (why they’re needed)

- `storage` — save your selections, favourites, and cached data
- `scripting` — inject the content script if needed (fallback)
- `activeTab` — send a message to the current tab to trigger fill
- `tabs` — query the active tab for Fill Now
- `contextMenus` — right-click **Fill HiBob Project** menu

> You can remove `webRequest` if you’re not doing any network interception.

---

## How the autofill works

`content.js` finds the **Project**, **Project task**, and **Reason** controls, types your values, then commits selection with a reliable **ArrowDown → Enter** pattern (plus change/input events). It retries with small delays to survive UI animations.

**Tuning:** if your tenant’s UI is especially slow, bump the delays in `content.js`:

```js
// content.js (examples)
const SLOW_DELAY = 340;              // pause after typing before commit
const TYPE_TO_COMMIT_RETRIES = 5;    // retries if value didn't stick
const BETWEEN_RETRIES_MS = 180;      // pause between retries
```

---

## Privacy

- No data leaves your machine.
- With the static projects file, no request listening is required.
- Data lives in Chrome extension storage (`sync` for small values, `local` for caches).

---

## Troubleshooting

- **Modal doesn’t fill**: open the modal first; if still stuck, click **Fill Now**.
- **Suggestions not showing**: check `static-projects.json` format (see example above).
- **Slow dropdowns**: increase `SLOW_DELAY` and retry counts in `content.js`.
- **Favourite clicked but nothing happens**: ensure the HiBob timesheet page is the active tab when you click the chip.

---
