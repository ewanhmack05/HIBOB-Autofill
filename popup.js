// === popup.js (hardcoded projects + custom autosuggest + reason select) ===

const byNorm = (s) => (s || "").trim().toLowerCase();

let PROJECTS_CACHE = [];

const elProject = document.getElementById("project");
const elTask = document.getElementById("task");
const elReason = document.getElementById("reason");
const elToggle = document.getElementById("autoFillCheckbox");
const elSave = document.getElementById("save");
const elFill = document.getElementById("fill");
const elStatus = document.getElementById("status");
const sugProject = document.getElementById("projectSuggest");
const sugTask = document.getElementById("taskSuggest");

// ---------------- Settings ----------------
async function loadSettings() {
  const data = await chrome.storage.sync.get(["project", "task", "reason", "autofillModal", "autoFillEnabled"]);
  const toggle = typeof data.autofillModal === "boolean" ? data.autofillModal : !!data.autoFillEnabled;
  elProject.value = data.project || "";
  elTask.value = data.task || "";
  elReason.value = data.reason || ""; // select will default if empty
  elToggle.checked = toggle;
}
async function saveSettings() {
  const project = elProject.value.trim();
  const task = elTask.value.trim();
  const reason = elReason.value; // from select
  const toggle = elToggle.checked;
  await chrome.storage.sync.set({ project, task, reason, autofillModal: toggle, autoFillEnabled: toggle });
}

// ---------------- Trigger Fill ----------------
async function triggerFill() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  chrome.tabs.sendMessage(tab.id, { type: "FILL_HIBOB" }, async () => {
    if (chrome.runtime.lastError?.message?.includes("Receiving end does not exist")) {
      try {
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
        chrome.tabs.sendMessage(tab.id, { type: "FILL_HIBOB" });
      } catch {}
    }
  });
}

// ---------------- Load hardcoded projects ----------------
async function loadHardcodedProjects() {
  try {
    const url = chrome.runtime.getURL("static-projects.json");
    const res = await fetch(url);
    const json = await res.json();
    const array = Array.isArray(json) ? json : Array.isArray(json.results) ? json.results : [];
    PROJECTS_CACHE = array
      .map((p) => ({
        name: p?.name || "",
        tasks: Array.isArray(p?.tasks)
          ? p.tasks.map((t) => ({
              name: t?.name || "",
              isArchived: !!t?.isArchived,
            }))
          : [],
      }))
      .filter((p) => p.name);
    elStatus.textContent = `Loaded ${PROJECTS_CACHE.length} projects.`;
  } catch (e) {
    PROJECTS_CACHE = [];
    elStatus.textContent = "Could not load static-projects.json";
    console.warn("[HiBob Autofill] Failed to load static-projects.json", e);
  }
}

// ---------------- Autosuggest engine ----------------
function makeAutosuggest(inputEl, panelEl, provider, onChoose) {
  let items = [];
  let active = -1;
  const MAX = 8;

  function close() {
    panelEl.classList.remove("open");
    panelEl.innerHTML = "";
    active = -1;
  }
  function open() {
    panelEl.classList.add("open");
  }
  function render(list) {
    panelEl.innerHTML = "";
    list.slice(0, MAX).forEach((text, idx) => {
      const div = document.createElement("div");
      div.className = "option";
      div.textContent = text;
      div.setAttribute("role", "option");
      if (idx === active) div.classList.add("active");
      div.addEventListener("mousedown", (e) => {
        e.preventDefault();
        choose(idx);
      });
      panelEl.appendChild(div);
    });
  }
  function choose(index) {
    if (index < 0 || index >= items.length) return;
    const value = items[index];
    inputEl.value = value;
    onChoose?.(value);
    close();
  }
  function recompute() {
    const q = inputEl.value;
    const list = provider(q) || [];
    items = list;
    active = -1;
    if (!list.length) {
      close();
      return;
    }
    render(items);
    open();
  }

  inputEl.addEventListener("input", recompute);
  inputEl.addEventListener("focus", recompute);
  inputEl.addEventListener("blur", () => setTimeout(close, 120));
  inputEl.addEventListener("keydown", (e) => {
    const opened = panelEl.classList.contains("open");
    if (!opened && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      recompute();
      return;
    }
    if (!opened) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      active = Math.min(active + 1, Math.min(items.length, MAX) - 1);
      render(items);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      active = Math.max(active - 1, 0);
      render(items);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (active >= 0) choose(active);
      else if (items.length) choose(0);
    } else if (e.key === "Escape") {
      close();
    }
  });

  return { close, recompute };
}

// ---------------- Providers ----------------
function projectProvider(query) {
  const q = byNorm(query);
  const names = PROJECTS_CACHE.map((p) => p.name);
  if (!q) return names.slice(0, 20);
  const starts = names.filter((n) => byNorm(n).startsWith(q));
  const includes = names.filter((n) => !byNorm(n).startsWith(q) && byNorm(n).includes(q));
  return [...starts, ...includes];
}
function taskProviderFactory(getProjectName) {
  return function taskProvider(query) {
    const proj = PROJECTS_CACHE.find((p) => byNorm(p.name) === byNorm(getProjectName()));
    const taskNames = (proj?.tasks || []).filter((t) => !t.isArchived).map((t) => t.name);
    const q = byNorm(query);
    if (!q) return taskNames.slice(0, 20);
    const starts = taskNames.filter((n) => byNorm(n).startsWith(q));
    const includes = taskNames.filter((n) => !byNorm(n).startsWith(q) && byNorm(n).includes(q));
    return [...starts, ...includes];
  };
}

// ---------------- Wire up ----------------
document.addEventListener("DOMContentLoaded", async () => {
  await loadSettings();
  await loadHardcodedProjects();

  // Project autosuggest
  makeAutosuggest(
    elProject,
    sugProject,
    projectProvider,
    () => {
      elTask.value = "";
    } // reset task when project changes
  );

  // Task autosuggest depends on selected project
  makeAutosuggest(
    elTask,
    sugTask,
    taskProviderFactory(() => elProject.value),
    () => {}
  );

  elSave.addEventListener("click", async () => {
    await saveSettings();
    window.close();
  });
  elFill.addEventListener("click", async () => {
    await saveSettings();
    await triggerFill();
    window.close();
  });
});
