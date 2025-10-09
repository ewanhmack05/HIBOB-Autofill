// === popup.js ===

// Normalizer
const byNorm = (s) => (s || "").trim().toLowerCase();

let PROJECTS_CACHE = [];

// ---- Load saved values ----
async function loadSettings() {
  const data = await chrome.storage.sync.get(["project", "task", "reason", "autofillModal", "autoFillEnabled"]);
  // support either toggle key
  const toggle = typeof data.autofillModal === "boolean" ? data.autofillModal : !!data.autoFillEnabled;

  document.getElementById("project").value = data.project || "";
  document.getElementById("task").value = data.task || "";
  document.getElementById("reason").value = data.reason || "";
  document.getElementById("autoFillCheckbox").checked = toggle;
}

// ---- Save ----
async function saveSettings() {
  const project = document.getElementById("project").value.trim();
  const task = document.getElementById("task").value.trim();
  const reason = document.getElementById("reason").value.trim();
  const toggle = document.getElementById("autoFillCheckbox").checked;

  // write both keys for compat with any content.js
  await chrome.storage.sync.set({
    project,
    task,
    reason,
    autofillModal: toggle,
    autoFillEnabled: toggle,
  });
}

// ---- Manual Fill ----
async function triggerFill() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  chrome.tabs.sendMessage(tab.id, { type: "FILL_HIBOB" }, async () => {
    if (chrome.runtime.lastError?.message?.includes("Receiving end does not exist")) {
      try {
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
        chrome.tabs.sendMessage(tab.id, { type: "FILL_HIBOB" });
      } catch (e) {
        // ignore
      }
    }
  });
}

// Buttons
document.getElementById("save").addEventListener("click", async () => {
  await saveSettings();
  window.close();
});
document.getElementById("fill").addEventListener("click", async () => {
  await saveSettings();
  await triggerFill();
  window.close();
});

// ---- Autocomplete lists (safe if empty) ----
function renderProjects() {
  const dl = document.getElementById("projectsList");
  dl.innerHTML = "";
  for (const p of PROJECTS_CACHE) {
    if (!p?.name) continue;
    const opt = document.createElement("option");
    opt.value = p.name;
    dl.appendChild(opt);
  }
}

function renderTasks(projectName) {
  const dl = document.getElementById("tasksList");
  dl.innerHTML = "";
  const proj = PROJECTS_CACHE.find((p) => byNorm(p.name) === byNorm(projectName));
  const tasks = proj?.tasks || [];
  for (const t of tasks) {
    if (!t?.name || t.isArchived) continue;
    const opt = document.createElement("option");
    opt.value = t.name;
    dl.appendChild(opt);
  }
}

document.getElementById("project").addEventListener("input", (e) => {
  renderTasks(e.target.value);
});

// Prefer asking background; fallback to local cache if SW isn’t running
async function fetchProjectsForPopup() {
  try {
    const res = await chrome.runtime.sendMessage({ type: "GET_HIBOB_PROJECTS" });
    if (res && res.ok && Array.isArray(res.projects)) return res.projects;
  } catch (_) {
    // "Unchecked runtime.lastError: No SW" -> background not running; fall back below
  }
  const { hibobProjects } = await chrome.storage.local.get("hibobProjects");
  if (Array.isArray(hibobProjects)) return hibobProjects;
  return [];
}

async function initDatalists() {
  PROJECTS_CACHE = await fetchProjectsForPopup();
  renderProjects();

  // If a project is already saved, pre-populate tasks for it
  const currentProject = document.getElementById("project").value;
  if (currentProject) renderTasks(currentProject);
}

// ---- Init ----
document.addEventListener("DOMContentLoaded", async () => {
  await loadSettings();
  await initDatalists();
});
