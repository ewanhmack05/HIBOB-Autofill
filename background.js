// === background.js (minimal, textbox mode) ===

// Keys we might read if a content script caches project data (safe even if empty)
const CACHE_KEYS = ["hibobProjectsCache", "hibobProjects"]; // new then legacy

// Small helpers
const getLocal = (keys) => chrome.storage.local.get(keys);

// Messages from popup/content
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
	(async () => {
		try {
			// Provide projects for datalists if available (no fetching here)
			if (msg && msg.type === "GET_HIBOB_PROJECTS") {
				const store = await getLocal(CACHE_KEYS);
				// Prefer new cache shape { data, ts }, fall back to legacy array
				const cache = store.hibobProjectsCache;

				let projects = [];
				if (Array.isArray(cache?.data)) {
					projects = cache.data;
				} else if (Array.isArray(cache?.data?.projects)) {
					projects = cache.data.projects;
				} else if (Array.isArray(cache?.data?.items)) {
					projects = cache.data.items;
				} else if (Array.isArray(store.hibobProjects)) {
					projects = store.hibobProjects;
				}

				sendResponse({
					ok: true,
					projects,
					ts: cache?.ts || null,
					sourceUrl: cache?.url || null,
				});
				return;
			}

			// We don't fetch/refresh from the SW in textbox mode
			if (msg && msg.type === "REFRESH_HIBOB_PROJECTS") {
				sendResponse({
					ok: false,
					error: "Background cannot refresh. Open the HiBob page so the content script (if present) can capture.",
				});
				return;
			}
		} catch (e) {
			sendResponse({ ok: false, error: String(e?.message || e) });
		}
	})();
	return true; // keep port open for async responses
});

// ---- Context menu + hotkey to trigger autofill -----------------------------

const menus = chrome.menus || chrome.contextMenus; // broader compat

chrome.runtime.onInstalled.addListener(() => {
	try {
		if (menus && menus.create) {
			menus.create({
				id: "fill-hibob",
				title: "Fill HiBob Project",
				contexts: ["all"],
				documentUrlPatterns: ["https://*.hibob.com/*", "https://hibob.com/*"],
			});
		}
	} catch (_) {
		/* ignore */
	}
});

if (menus && menus.onClicked && menus.onClicked.addListener) {
	menus.onClicked.addListener(async (info, tab) => {
		if (info.menuItemId === "fill-hibob" && tab?.id) {
			chrome.tabs.sendMessage(tab.id, { type: "FILL_HIBOB" }, async () => {
				const err = chrome.runtime.lastError?.message || "";
				if (err.includes("Receiving end does not exist")) {
					try {
						await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
						chrome.tabs.sendMessage(tab.id, { type: "FILL_HIBOB" });
					} catch (_) {}
				}
			});
		}
	});
}

if (chrome.commands?.onCommand) {
	chrome.commands.onCommand.addListener(async (command) => {
		if (command === "fill-hibob") {
			const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
			if (tab?.id) {
				chrome.tabs.sendMessage(tab.id, { type: "FILL_HIBOB" }, async () => {
					const err = chrome.runtime.lastError?.message || "";
					if (err.includes("Receiving end does not exist")) {
						try {
							await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
							chrome.tabs.sendMessage(tab.id, { type: "FILL_HIBOB" });
						} catch (_) {}
					}
				});
			}
		}
	});
}
