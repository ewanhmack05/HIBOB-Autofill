# HiBob Project Filler

A Chrome (MV3) extension that remembers your **Project**, **Project task**, and **Reason**, and auto-fills the HiBob Attendance modal. It supports **autosuggest**, a fixed **Reason** dropdown, and ⭐ **Favourites** for instant reuse.

---

## Features

- Fill Now button + optional auto-fill when the modal opens
- Autosuggest for Project/Task (from `static-projects.json`)
- Favourites: click to auto-fill a saved Project/Task/Reason combo
- Reason is a dropdown with 3 options:

  - Manual Entry
  - Forgot to clock in
  - Other, see notes

- Custom toolbar icon (teal H, `rgb(70,136,136)`)

---

## Install (Chrome)

1. Go to `chrome://extensions/`
2. Enable **Developer mode**
3. Click **Load unpacked** and select the project folder
4. (Optional) Pin the extension to the toolbar

> After editing files, click **Reload** on the extension card.

---

## Usage

1. Click the extension icon
2. Type/select a **Project** and **Project task** (autosuggest enabled)
3. Choose a **Reason** from the dropdown
4. (Optional) Enable **auto-fill** when the modal opens
5. Click **Save Settings** or **Fill Now**

### Favourites

- Click ⭐ to save current combo
- Click a chip to auto-fill and close popup
- Remove a chip by clicking ×

---

## Data source: `static-projects.json`

Local-only data source for autosuggestions. Shape:

```json
{
	"results": [
		{ "name": "Project A", "tasks": [{ "name": "Task 1" }, { "name": "Task 2" }] },
		{ "name": "Project B", "tasks": [] }
	]
}
```

> Keep only the `name` fields.

---

## Permissions explained

- `storage` — store settings and favourites
- `scripting` — inject autofill logic if needed
- `activeTab` — target the current HiBob tab
- `tabs` — used to trigger script execution
- `contextMenus` — adds right-click autofill

---

## Autofill logic (inside `content.js`)

Finds and types into:

- **Project**
- **Project task**
- **Reason**

Uses retries, settle delays, and simulated keyboard interaction:

```js
const SLOW_DELAY = 340; // pause before commit
const TYPE_TO_COMMIT_RETRIES = 5; // retries if not accepted
const BETWEEN_RETRIES_MS = 180; // delay between retries
```

---

## Privacy

- No data leaves your machine
- No remote logging or API calls
- Only local extension storage used

---

## Troubleshooting

- ❌ Modal doesn’t fill: click **Fill Now** or reload the HiBob page first
- ❌ Suggestions missing: check `static-projects.json` format
- ❌ Slow inputs: increase `SLOW_DELAY` in `content.js`
- ❌ Favourite doesn’t apply: make sure HiBob is the **active tab**

---
