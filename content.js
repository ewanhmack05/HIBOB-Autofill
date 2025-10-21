function norm(s) {
	return s?.replace(/\s+/g, " ").trim().toLowerCase();
}

// --- Tunables ---
const SLOW_DELAY = 340; // pause after typing before committing
const PANEL_WAIT = 24; // loops waiting for panel/input
const SETTLE_AFTER_MODAL_MS = 250; // wait after modal mounts
const TYPE_TO_COMMIT_RETRIES = 5; // open+type+enter retries if value didn't stick
const BETWEEN_RETRIES_MS = 180; // pause between retries

// --- Toggle + observer state (NEW) ---
let autofillEnabled = false; // controls ONLY automatic modal watching
let mo = null; // MutationObserver instance (so we can disconnect)

// --- Finders ---
function findControlByLabel(labelText, root = document) {
	const want = norm(labelText);
	for (const lab of root.querySelectorAll("label")) {
		if (norm(lab.textContent) === want) {
			const forId = lab.getAttribute("for");
			if (forId) {
				const byId = root.getElementById ? root.getElementById(forId) : document.getElementById(forId);
				if (byId) return byId;
			}
			const within = lab.querySelector('select,[role="combobox"],[aria-haspopup="listbox"]');
			if (within) return within;
			const wrap = lab.closest("div,section,form,fieldset") || root;
			const near = wrap.querySelector('select,[role="combobox"],[aria-haspopup="listbox"]');
			if (near) return near;
		}
	}
	const aria = root.querySelector(`select[aria-label="${labelText}"], [role="combobox"][aria-label="${labelText}"], [aria-haspopup="listbox"][aria-label="${labelText}"]`);
	if (aria) return aria;
	const ph = root.querySelector(`select[placeholder="${labelText}"], [role="combobox"][placeholder="${labelText}"]`);
	if (ph) return ph;
	return null;
}

function setNativeSelectByText(select, text) {
	if (!select) return false;
	const want = text.trim().toLowerCase();
	const idx = Array.from(select.options).findIndex((o) => o.text.trim().toLowerCase() === want);
	if (idx === -1) return false;
	select.value = select.options[idx].value;
	select.dispatchEvent(new Event("input", { bubbles: true }));
	select.dispatchEvent(new Event("change", { bubbles: true }));
	return true;
}

function sendKey(target, key) {
	target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
	target.dispatchEvent(new KeyboardEvent("keyup", { key, bubbles: true }));
}

function getListboxFor(control) {
	const id = control.getAttribute && control.getAttribute("aria-controls");
	if (id) {
		const lb = document.getElementById(id);
		if (lb) return lb;
	}
	return document.querySelector('[role="listbox"], .MuiAutocomplete-popper, .ant-select-dropdown, .select__menu');
}

function findDropdownSearchInput(control) {
	const listbox = getListboxFor(control) || document;
	const selectors = ['input[role="searchbox"]', "input[aria-autocomplete]", 'input[type="text"]'];
	for (const sel of selectors) {
		const el = listbox.querySelector(sel) || control.querySelector(sel);
		if (el) return el;
	}
	if (document.activeElement && document.activeElement.tagName === "INPUT") return document.activeElement;
	return null;
}

function setInputValue(input, text) {
	input.focus();
	input.value = text;
	input.dispatchEvent(new Event("input", { bubbles: true }));
}

function visibleOptions(root) {
	const scope = root || document;
	const all = Array.from(scope.querySelectorAll('[role="option"], li[role="option"], [data-value]'));
	return all.filter((el) => {
		const r = el.getBoundingClientRect();
		return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
	});
}

function chooseOptionByText(text, root) {
	const want = norm(text);
	const opts = visibleOptions(root);
	let match = opts.find((el) => norm(el.textContent) === want);
	if (!match) match = opts.find((el) => norm(el.textContent).includes(want));
	if (!match) return false;
	match.click();
	return true;
}

function controlDisplayText(control) {
	return (control.textContent || "").trim();
}

async function openTypeCommit(control, text) {
	control.scrollIntoView({ block: "center", inline: "center" });
	control.click();

	const listbox = getListboxFor(control);
	for (let i = 0; i < PANEL_WAIT; i++) {
		const input = findDropdownSearchInput(control);
		if (input) {
			setInputValue(input, text);
			await new Promise((r) => setTimeout(r, SLOW_DELAY));
			chooseOptionByText(text, listbox);
			sendKey(input, "ArrowDown");
			sendKey(input, "Enter");
			control.dispatchEvent(new Event("input", { bubbles: true }));
			control.dispatchEvent(new Event("change", { bubbles: true }));
			return true;
		}
		await new Promise((r) => setTimeout(r, 30));
	}
	// fallback plain list
	const ok = chooseOptionByText(text, listbox);
	control.dispatchEvent(new Event("input", { bubbles: true }));
	control.dispatchEvent(new Event("change", { bubbles: true }));
	return ok;
}

async function setAriaDropdownSearchable(control, text) {
	const before = controlDisplayText(control);
	for (let attempt = 1; attempt <= TYPE_TO_COMMIT_RETRIES; attempt++) {
		await openTypeCommit(control, text);
		await new Promise((r) => setTimeout(r, 160));
		const after = controlDisplayText(control);
		if (after && norm(after).includes(norm(text))) return true;
		await new Promise((r) => setTimeout(r, BETWEEN_RETRIES_MS));
	}
	return false;
}

function isNativeSelect(el) {
	return el && el.tagName === "SELECT";
}

async function waitForControl(labelText, root = document, timeoutMs = 8000) {
	const start = performance.now();
	let el = findControlByLabel(labelText, root);
	while (!el && performance.now() - start < timeoutMs) {
		await new Promise((r) => setTimeout(r, 60));
		el = findControlByLabel(labelText, root);
	}
	return el;
}

async function setDropdown(labelText, valueText, root = document) {
	const ctrl = await waitForControl(labelText, root, 8000);
	if (!ctrl) return { label: labelText, ok: false, reason: "not found" };
	const ok = isNativeSelect(ctrl) ? setNativeSelectByText(ctrl, valueText) : await setAriaDropdownSearchable(ctrl, valueText);
	return { label: labelText, ok };
}

async function fillHiBob(root = document, overrides = {}) {
	const stored = await chrome.storage.sync.get(["project", "task", "reason"]);
	const project = overrides.project ?? stored.project;
	const task = overrides.task ?? stored.task;
	const reason = overrides.reason ?? stored.reason;
	const results = [];
	if (project) results.push(await setDropdown("Project", project, root));
	if (task) results.push(await setDropdown("Project task", task, root));
	if (reason) results.push(await setDropdown("Reason", reason, root));
	return results;
}

// ---- Auto-fill when modal opens ----
let lastHandledModal = null;

function isModal(node) {
	if (!node || !(node instanceof Element)) return false;
	const role = node.getAttribute("role") || "";
	if (role.toLowerCase() === "dialog") return true;
	if (node.hasAttribute("aria-modal")) return true;
	const cls = node.className || "";
	return /modal|dialog|popover|portal/i.test(cls) || (node.id && node.id.toLowerCase().includes("modal"));
}

function modalContainsLabels(modalRoot) {
	return !!(findControlByLabel("Project", modalRoot) || findControlByLabel("Project task", modalRoot) || findControlByLabel("Reason", modalRoot));
}

async function handleModal(modalRoot) {
	if (!modalRoot || modalRoot === lastHandledModal) return;
	await new Promise((r) => setTimeout(r, SETTLE_AFTER_MODAL_MS)); // let animation/layout settle

	const start = performance.now();
	while (performance.now() - start < 6000 && !modalContainsLabels(modalRoot)) {
		await new Promise((r) => setTimeout(r, 60));
	}
	if (!modalContainsLabels(modalRoot)) return;

	lastHandledModal = modalRoot;
	try {
		await fillHiBob(modalRoot);
	} catch (e) {}
}

// --- Watcher control ---
function startWatching() {
	if (mo) return;
	mo = new MutationObserver((muts) => {
		for (const m of muts) {
			for (const n of m.addedNodes) {
				if (isModal(n) || (n.querySelector && n.querySelector('[role="dialog"],[aria-modal],.modal,.MuiDialog-root,.ant-modal,.select__menu'))) {
					const modalRoot = isModal(n) ? n : (n.querySelector && n.querySelector('[role="dialog"],[aria-modal],.modal,.MuiDialog-root,.ant-modal')) || n;
					handleModal(modalRoot);
				}
			}
		}
	});
	mo.observe(document.documentElement, { childList: true, subtree: true });

	// If a modal is already open, handle it once
	const initialModal = document.querySelector('[role="dialog"],[aria-modal],.modal,.MuiDialog-root,.ant-modal');
	if (initialModal) handleModal(initialModal);
}

function stopWatching() {
	if (mo) {
		mo.disconnect();
		mo = null;
	}
}

// --- Init: read toggle, start/stop watcher accordingly (NEW) ---
chrome.storage.sync.get(["autofillModal"]).then(({ autofillModal }) => {
	autofillEnabled = !!autofillModal;
	if (autofillEnabled) startWatching();
});

chrome.storage.onChanged.addListener((changes, area) => {
	if (area === "sync" && "autofillModal" in changes) {
		autofillEnabled = !!changes.autofillModal.newValue;
		if (autofillEnabled) startWatching();
		else stopWatching();
	}
});

// Manual trigger
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
	if (msg?.type === "FILL_HIBOB") {
		const { project, task, reason } = msg;
		fillHiBob(document, { project, task, reason }).then(sendResponse);
		return true;
	}
});
