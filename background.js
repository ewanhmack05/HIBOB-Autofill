// === background.js ===

// ------------ Storage keys ------------
const LOCAL_EMPLOYEE_ID = "hibobEmployeeIdLocal"; // small, persistent
const LOCAL_EMPLOYEE_LAST = "hibobEmployeeIdLastWrite"; // throttle timestamp
const LOCAL_PROJECTS = "hibobProjects"; // big payload (array)
const LOCAL_CACHED_AT = "hibobProjectsCachedAt"; // timestamp ms

// ------------ Tunables ------------
const EMPLOYEE_WRITE_MIN_INTERVAL_MS = 60 * 1000; // at most 1 write/min
const PROJECTS_TTL_MS = 10 * 60 * 1000; // cache projects for 10 min

// ------------ Tiny helpers ------------
const setLocal = (obj) => chrome.storage.local.set(obj);
const getLocal = (keys) => chrome.storage.local.get(keys);

async function setBadge(text, color = "#2e7d32") {
  try {
    await chrome.action.setBadgeText({ text });
    await chrome.action.setBadgeBackgroundColor({ color });
  } catch (_) {
    /* ignore if action not available */
  }
}

// ------------ HiBob API helpers ------------
async function fetchProjects(employeeId, includeArchivedTasks = false) {
  const url = `https://app.hibob.com/api/attendance/employees/${employeeId}/projects?includeArchivedTasks=${includeArchivedTasks}`;
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error(`Projects fetch failed: ${res.status}`);
  return res.json();
}

async function getEmployeeIdAny() {
  const { [LOCAL_EMPLOYEE_ID]: id } = await getLocal([LOCAL_EMPLOYEE_ID]);
  return id || null;
}

async function ensureProjects(includeArchivedTasks = false) {
  const employeeId = await getEmployeeIdAny();
  if (!employeeId) throw new Error("No employeeId captured yet — open HiBob so we can see the manage request.");

  const { [LOCAL_PROJECTS]: cached, [LOCAL_CACHED_AT]: ts } = await getLocal([LOCAL_PROJECTS, LOCAL_CACHED_AT]);

  const fresh = cached && ts && Date.now() - ts < PROJECTS_TTL_MS;
  if (fresh) return cached;

  const data = await fetchProjects(employeeId, includeArchivedTasks);
  await setLocal({ [LOCAL_PROJECTS]: data, [LOCAL_CACHED_AT]: Date.now() });
  return data;
}

// ------------ Intercept: capture employeeId from MANAGE POST body ------------
chrome.webRequest.onBeforeRequest.addListener(
  async (details) => {
    try {
      // Be broad and verbose to avoid missing it
      if (details.method !== "POST") return;
      if (!details.url.includes("/api/permissions/employees/authorized/domains/shoutouts/resources/posts/actions/manage")) return;
      if (!details.requestBody) return;

      let employeeId = null;

      // JSON body (raw bytes)
      if (details.requestBody.raw && details.requestBody.raw[0]?.bytes) {
        const jsonStr = new TextDecoder("utf-8").decode(details.requestBody.raw[0].bytes);
        try {
          const body = JSON.parse(jsonStr);
          if (Array.isArray(body.employees) && body.employees.length > 0) {
            employeeId = String(body.employees[0]);
          }
        } catch (_) {
          /* ignore parse errors */
        }
      }

      // formData fallback
      if (!employeeId && details.requestBody.formData?.employees?.length) {
        employeeId = String(details.requestBody.formData.employees[0]);
      }

      if (!employeeId) return;

      // Throttle + dedupe (persist throttle so SW restarts don't spam writes)
      const { [LOCAL_EMPLOYEE_ID]: prevId, [LOCAL_EMPLOYEE_LAST]: lastWrite = 0 } = await getLocal([LOCAL_EMPLOYEE_ID, LOCAL_EMPLOYEE_LAST]);

      const now = Date.now();
      if (employeeId !== prevId && now - lastWrite > EMPLOYEE_WRITE_MIN_INTERVAL_MS) {
        await setLocal({ [LOCAL_EMPLOYEE_ID]: employeeId, [LOCAL_EMPLOYEE_LAST]: now });
        setBadge("ID");
      }
    } catch (err) {
      // Silent resilience
    }
  },
  // Broad URL filter; no 'types' filter so we don't miss 'ping' / sendBeacon etc.
  { urls: ["https://app.hibob.com/*"] },
  ["requestBody"] // needed to read POST bodies
);

// ------------ Message API (popup/content can call) ------------
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      if (msg?.type === "GET_HIBOB_EMPLOYEE_ID") {
        const id = await getEmployeeIdAny();
        sendResponse({ employeeId: id });
        return;
      }

      if (msg?.type === "GET_HIBOB_PROJECTS") {
        const data = await ensureProjects(!!msg.includeArchivedTasks);
        sendResponse({ ok: true, projects: data });
        return;
      }

      if (msg?.type === "REFRESH_HIBOB_PROJECTS") {
        const id = await getEmployeeIdAny();
        if (!id) throw new Error("No employeeId captured yet.");
        const data = await fetchProjects(id, !!msg.includeArchivedTasks);
        await setLocal({ [LOCAL_PROJECTS]: data, [LOCAL_CACHED_AT]: Date.now() });
        sendResponse({ ok: true, projects: data, refreshed: true });
        return;
      }
    } catch (e) {
      sendResponse({ ok: false, error: String(e?.message || e) });
    }
  })();
  return true; // keep port open for async
});

// ------------ Context menu + hotkey (triggers content autofill) ------------
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "fill-hibob",
    title: "Fill HiBob Project",
    contexts: ["all"],
    documentUrlPatterns: ["https://*.hibob.com/*", "https://hibob.com/*"],
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "fill-hibob" && tab?.id) {
    chrome.tabs.sendMessage(tab.id, { type: "FILL_HIBOB" }, async () => {
      const msg = chrome.runtime.lastError?.message || "";
      if (msg.includes("Receiving end does not exist")) {
        try {
          await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
          chrome.tabs.sendMessage(tab.id, { type: "FILL_HIBOB" });
        } catch (_) {}
      }
    });
  }
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command === "fill-hibob") {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      chrome.tabs.sendMessage(tab.id, { type: "FILL_HIBOB" }, async () => {
        const msg = chrome.runtime.lastError?.message || "";
        if (msg.includes("Receiving end does not exist")) {
          try {
            await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
            chrome.tabs.sendMessage(tab.id, { type: "FILL_HIBOB" });
          } catch (_) {}
        }
      });
    }
  }
});
