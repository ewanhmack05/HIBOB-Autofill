// === popup.js (autosuggest + reasons select + favourites with auto-fill) ===

const byNorm = (s) => (s || "").trim().toLowerCase();
let PROJECTS_CACHE = []; // [{ name, tasks: [{ name, isArchived? }] }]

// Elements
const elProject = document.getElementById("project");
const elTask = document.getElementById("task");
const elReason = document.getElementById("reason");
const elToggle = document.getElementById("autoFillCheckbox");
const elSave = document.getElementById("save");
const elFill = document.getElementById("fill");
const elStatus = document.getElementById("status");
const sugProject = document.getElementById("projectSuggest");
const sugTask = document.getElementById("taskSuggest");
const elFavSave = document.getElementById("favSave");
const elFavChips = document.getElementById("favChips");

// ---------- Settings ----------
async function loadSettings() {
  const data = await chrome.storage.sync.get(["project", "task", "reason", "autofillModal", "autoFillEnabled"]);
  const toggle = typeof data.autofillModal === "boolean" ? data.autofillModal : !!data.autoFillEnabled;
  elProject.value = data.project || "";
  elTask.value = data.task || "";
  elReason.value = data.reason || "";
  elToggle.checked = toggle;
}
async function saveSettings() {
  const project = elProject.value.trim();
  const task = elTask.value.trim();
  const reason = elReason.value;
  const toggle = elToggle.checked;
  await chrome.storage.sync.set({ project, task, reason, autofillModal: toggle, autoFillEnabled: toggle });
}

// ---------- Fill ----------
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

// ---------- Hardcoded projects ----------
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

// ---------- Autosuggest ----------
function makeAutosuggest(inputEl, panelEl, provider, onChoose) {
  let items = [];
  let active = -1;
  const MAX = 20;

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

// Providers
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

// ---------- FAVOURITES (with auto-fill on click) ----------
const FAV_KEY = "favorites"; // [{ id, label, project, task, reason, createdAt }]

async function readFavourites() {
  const { [FAV_KEY]: favs } = await chrome.storage.sync.get(FAV_KEY);
  return Array.isArray(favs) ? favs : [];
}
async function writeFavourites(favs) {
  await chrome.storage.sync.set({ [FAV_KEY]: favs });
}

function makeLabel(project, task) {
  if (project && task) return `${project} — ${task}`;
  return project || task || "Favourite";
}

async function saveFavouriteFromCurrent() {
  const project = elProject.value.trim();
  const task = elTask.value.trim();
  const reason = elReason.value;

  if (!project) {
    elStatus.textContent = "Select a project before saving a favourite.";
    return;
  }

  const favs = await readFavourites();
  const exists = favs.find((f) => f.project === project && f.task === task && f.reason === reason);
  if (exists) {
    elStatus.textContent = "Already in favourites.";
    return;
  }

  const fav = {
    id: String(Date.now()),
    label: makeLabel(project, task),
    project,
    task,
    reason,
    createdAt: Date.now(),
  };

  const next = [fav, ...favs].slice(0, 12);
  await writeFavourites(next);
  renderFavourites(next);
  elStatus.textContent = "Saved to favourites.";
}

// NEW: click favourite => load, save, fill, close
async function applyFavouriteAndFill(f) {
  // 1) Load into fields
  elProject.value = f.project || "";
  elTask.value = f.task || "";
  elReason.value = f.reason || "";

  // 2) Persist selection so your content.js reads it
  await chrome.storage.sync.set({
    project: elProject.value.trim(),
    task: elTask.value.trim(),
    reason: elReason.value,
  });

  // 3) Trigger the fill in the active tab
  await triggerFill();

  // 4) Close popup
  window.close();
}

async function deleteFavourite(id) {
  const favs = await readFavourites();
  const next = favs.filter((f) => f.id !== id);
  await writeFavourites(next);
  renderFavourites(next);
}

function renderFavourites(favs) {
  elFavChips.innerHTML = "";
  if (!Array.isArray(favs) || !favs.length) return;

  favs.forEach((f) => {
    const chip = document.createElement("div");
    chip.className = "chip";
    chip.title = `${f.project}${f.task ? " — " + f.task : ""}${f.reason ? " • " + f.reason : ""}`;
    chip.textContent = f.label;

    // Click chip => auto-fill
    chip.addEventListener("click", (e) => {
      e.preventDefault();
      applyFavouriteAndFill(f);
    });

    // Remove button (does not fill)
    const kill = document.createElement("span");
    kill.className = "kill";
    kill.textContent = "×";
    kill.title = "Remove";
    kill.addEventListener("click", async (e) => {
      e.stopPropagation();
      await deleteFavourite(f.id);
    });

    chip.appendChild(kill);
    elFavChips.appendChild(chip);
  });
}

// ---------- Wire up ----------
document.addEventListener("DOMContentLoaded", async () => {
  await loadSettings();
  await loadHardcodedProjects();

  // Autosuggest
  makeAutosuggest(elProject, sugProject, projectProvider, () => {
    elTask.value = "";
  });
  makeAutosuggest(
    elTask,
    sugTask,
    taskProviderFactory(() => elProject.value),
    () => {}
  );

  // Favourites
  elFavSave.addEventListener("click", saveFavouriteFromCurrent);
  renderFavourites(await readFavourites());

  // Save/Fill buttons
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
