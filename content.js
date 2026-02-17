function norm(text) {
	return (text || "").replace(/\s+/g, " ").trim().toLowerCase();
}

function sleep(durationMs) {
	return new Promise((resolve) => setTimeout(resolve, durationMs));
}

function setNativeValue(inputElement, nextValue) {
	const prototypeDescriptor = Object.getOwnPropertyDescriptor(inputElement.__proto__, "value");
	const valueSetter = prototypeDescriptor && prototypeDescriptor.set ? prototypeDescriptor.set : null;

	if (valueSetter) {
		valueSetter.call(inputElement, nextValue);
		return;
	}

	inputElement.value = nextValue;
}

function dispatchInputEvents(inputElement) {
	inputElement.dispatchEvent(new Event("input", { bubbles: true }));
	inputElement.dispatchEvent(new Event("change", { bubbles: true }));
}

async function waitForElement(getElement, timeoutMs, debugLabel = "") {
	const startTime = performance.now();

	while (performance.now() - startTime < timeoutMs) {
		const found = getElement();
		if (found) {
			if (debugLabel) {
				console.log("[HiBob Autofill] waitForElement found:", debugLabel, found);
			}
			return found;
		}
		await sleep(60);
	}

	if (debugLabel) {
		console.log("[HiBob Autofill] waitForElement timed out:", debugLabel);
	}
	return null;
}

const SLOW_DELAY = 340;
const PANEL_WAIT = 24;
const SETTLE_AFTER_MODAL_MS = 250;
const TYPE_TO_COMMIT_RETRIES = 5;
const BETWEEN_RETRIES_MS = 180;

let autofillEnabled = false;
let observerInstance = null;

function isElementVisible(element) {
	if (!element) {
		return false;
	}

	if ("disabled" in element && element.disabled) {
		return false;
	}

	const computed = getComputedStyle(element);
	if (computed.display === "none" || computed.visibility === "hidden" || computed.opacity === "0") {
		return false;
	}

	const rect = element.getBoundingClientRect();
	if (rect.width <= 0 || rect.height <= 0) {
		return false;
	}

	return true;
}

function findControlByLabel(labelText, root = document) {
	const wanted = norm(labelText);

	for (const labelElement of root.querySelectorAll("label")) {
		if (norm(labelElement.textContent) === wanted) {
			const forId = labelElement.getAttribute("for");
			if (forId) {
				const byId = root.getElementById ? root.getElementById(forId) : document.getElementById(forId);
				if (byId) {
					console.log("[HiBob Autofill] findControlByLabel found by for/id:", labelText, byId);
					return byId;
				}
			}

			const withinLabel = labelElement.querySelector('select,[role="combobox"],[aria-haspopup="listbox"]');
			if (withinLabel) {
				console.log("[HiBob Autofill] findControlByLabel found within label:", labelText, withinLabel);
				return withinLabel;
			}

			const wrapper = labelElement.closest("div,section,form,fieldset") || root;
			const near = wrapper.querySelector('select,[role="combobox"],[aria-haspopup="listbox"]');
			if (near) {
				console.log("[HiBob Autofill] findControlByLabel found near label:", labelText, near);
				return near;
			}
		}
	}

	const aria = root.querySelector(
		`select[aria-label="${labelText}"], [role="combobox"][aria-label="${labelText}"], [aria-haspopup="listbox"][aria-label="${labelText}"]`,
	);
	if (aria) {
		console.log("[HiBob Autofill] findControlByLabel found aria-label:", labelText, aria);
		return aria;
	}

	const placeholder = root.querySelector(`select[placeholder="${labelText}"], [role="combobox"][placeholder="${labelText}"]`);
	if (placeholder) {
		console.log("[HiBob Autofill] findControlByLabel found placeholder:", labelText, placeholder);
		return placeholder;
	}

	console.log("[HiBob Autofill] findControlByLabel not found:", labelText);
	return null;
}

function setNativeSelectByText(selectElement, text) {
	if (!selectElement) {
		return false;
	}

	const wanted = String(text || "")
		.trim()
		.toLowerCase();
	const optionIndex = Array.from(selectElement.options).findIndex((optionElement) => {
		return optionElement.text.trim().toLowerCase() === wanted;
	});

	if (optionIndex === -1) {
		console.log("[HiBob Autofill] setNativeSelectByText option not found:", text);
		return false;
	}

	selectElement.value = selectElement.options[optionIndex].value;
	selectElement.dispatchEvent(new Event("input", { bubbles: true }));
	selectElement.dispatchEvent(new Event("change", { bubbles: true }));

	console.log("[HiBob Autofill] setNativeSelectByText set:", text);
	return true;
}

function sendKey(target, key) {
	target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
	target.dispatchEvent(new KeyboardEvent("keyup", { key, bubbles: true }));
}

function getListboxFor(control) {
	const id = control.getAttribute && control.getAttribute("aria-controls");
	if (id) {
		const listboxElement = document.getElementById(id);
		if (listboxElement) {
			console.log("[HiBob Autofill] getListboxFor via aria-controls:", id, listboxElement);
			return listboxElement;
		}
	}

	const fallback = document.querySelector('[role="listbox"], .MuiAutocomplete-popper, .ant-select-dropdown, .select__menu');
	if (fallback) {
		console.log("[HiBob Autofill] getListboxFor fallback:", fallback);
	}
	return fallback;
}

function findDropdownSearchInput(control) {
	const listboxElement = getListboxFor(control) || document;
	const selectors = ['input[role="searchbox"]', "input[aria-autocomplete]", 'input[type="text"]'];

	for (const selector of selectors) {
		const found = listboxElement.querySelector(selector) || control.querySelector(selector);
		if (found) {
			console.log("[HiBob Autofill] findDropdownSearchInput found:", selector, found);
			return found;
		}
	}

	if (document.activeElement && document.activeElement.tagName === "INPUT") {
		console.log("[HiBob Autofill] findDropdownSearchInput using activeElement:", document.activeElement);
		return document.activeElement;
	}

	console.log("[HiBob Autofill] findDropdownSearchInput not found");
	return null;
}

function setInputValue(inputElement, text) {
	inputElement.focus();
	setNativeValue(inputElement, text);
	inputElement.dispatchEvent(new Event("input", { bubbles: true }));
}

function visibleOptions(root) {
	const scope = root || document;
	const candidates = Array.from(scope.querySelectorAll('[role="option"], li[role="option"], [data-value]'));

	return candidates.filter((element) => {
		const rect = element.getBoundingClientRect();
		return rect.width > 0 && rect.height > 0 && getComputedStyle(element).visibility !== "hidden";
	});
}

function chooseOptionByText(text, root) {
	const wanted = norm(text);
	const options = visibleOptions(root);

	let match = options.find((element) => norm(element.textContent) === wanted);
	if (!match) {
		match = options.find((element) => norm(element.textContent).includes(wanted));
	}

	if (!match) {
		console.log("[HiBob Autofill] chooseOptionByText no match:", text, "options:", options.length);
		return false;
	}

	console.log("[HiBob Autofill] chooseOptionByText click:", text, match);
	match.click();
	return true;
}

function controlDisplayText(control) {
	return (control.textContent || "").trim();
}

async function openTypeCommit(control, text) {
	control.scrollIntoView({ block: "center", inline: "center" });
	control.click();

	console.log("[HiBob Autofill] openTypeCommit opened control:", control, "text:", text);

	const listboxElement = getListboxFor(control);

	for (let attemptIndex = 0; attemptIndex < PANEL_WAIT; attemptIndex++) {
		const searchInput = findDropdownSearchInput(control);
		if (searchInput) {
			setInputValue(searchInput, text);
			await sleep(SLOW_DELAY);

			const clicked = chooseOptionByText(text, listboxElement);
			console.log("[HiBob Autofill] openTypeCommit chooseOptionByText result:", clicked);

			sendKey(searchInput, "ArrowDown");
			sendKey(searchInput, "Enter");

			control.dispatchEvent(new Event("input", { bubbles: true }));
			control.dispatchEvent(new Event("change", { bubbles: true }));

			console.log("[HiBob Autofill] openTypeCommit committed");
			return true;
		}
		await sleep(30);
	}

	const ok = chooseOptionByText(text, listboxElement);

	control.dispatchEvent(new Event("input", { bubbles: true }));
	control.dispatchEvent(new Event("change", { bubbles: true }));

	console.log("[HiBob Autofill] openTypeCommit fallback ok:", ok);
	return ok;
}

async function setAriaDropdownSearchable(control, text) {
	for (let attempt = 1; attempt <= TYPE_TO_COMMIT_RETRIES; attempt++) {
		console.log("[HiBob Autofill] setAriaDropdownSearchable attempt:", attempt, "text:", text);
		await openTypeCommit(control, text);
		await sleep(160);

		const after = controlDisplayText(control);
		console.log("[HiBob Autofill] setAriaDropdownSearchable after:", after);

		if (after && norm(after).includes(norm(text))) {
			console.log("[HiBob Autofill] setAriaDropdownSearchable success:", text);
			return true;
		}

		await sleep(BETWEEN_RETRIES_MS);
	}

	console.log("[HiBob Autofill] setAriaDropdownSearchable failed:", text);
	return false;
}

function isNativeSelect(element) {
	return element && element.tagName === "SELECT";
}

async function waitForControl(labelText, root = document, timeoutMs = 8000) {
	const start = performance.now();
	let found = findControlByLabel(labelText, root);

	while (!found && performance.now() - start < timeoutMs) {
		await sleep(60);
		found = findControlByLabel(labelText, root);
	}

	if (found) {
		console.log("[HiBob Autofill] waitForControl found:", labelText, found);
	} else {
		console.log("[HiBob Autofill] waitForControl not found:", labelText);
	}

	return found;
}

async function setDropdown(labelText, valueText, root = document) {
	console.log("[HiBob Autofill] setDropdown:", labelText, "=>", valueText);

	const control = await waitForControl(labelText, root, 8000);
	if (!control) {
		return { label: labelText, ok: false, reason: "not found" };
	}

	const ok = isNativeSelect(control) ? setNativeSelectByText(control, valueText) : await setAriaDropdownSearchable(control, valueText);
	console.log("[HiBob Autofill] setDropdown result:", labelText, ok);

	return { label: labelText, ok };
}

function findSaveButton(root = document) {
	const scope = root || document;
	const primaryCandidates = Array.from(scope.querySelectorAll("button.primary.medium, button.primary"));
	const byText = primaryCandidates.find((buttonElement) => norm(buttonElement.textContent) === "save");
	if (byText) {
		console.log("[HiBob Autofill] findSaveButton found primary save:", byText);
		return byText;
	}

	const allButtons = Array.from(scope.querySelectorAll("button"));
	const anySave = allButtons.find((buttonElement) => norm(buttonElement.textContent) === "save") || null;

	console.log("[HiBob Autofill] findSaveButton found:", anySave);
	return anySave;
}

async function clickSaveIfEnabled(root, autoClockIn, results) {
	if (!autoClockIn) {
		console.log("[HiBob Autofill] clickSaveIfEnabled autoClockIn disabled");
		return;
	}

	const projectOk = results.find((resultItem) => norm(resultItem.label) === "project")?.ok;
	const taskOk = results.find((resultItem) => norm(resultItem.label) === "project task")?.ok;

	console.log("[HiBob Autofill] clickSaveIfEnabled checks:", { projectOk, taskOk });

	if (!projectOk || !taskOk) {
		console.log("[HiBob Autofill] clickSaveIfEnabled not clicking save due to missing selections");
		return;
	}

	const saveButton = findSaveButton(root);
	if (!saveButton) {
		console.log("[HiBob Autofill] clickSaveIfEnabled no save button");
		return;
	}

	await sleep(120);
	console.log("[HiBob Autofill] clickSaveIfEnabled clicking save");
	saveButton.click();
}

function findPickerTrigger(rootDocument) {
	const candidates = Array.from(rootDocument.querySelectorAll('div.bfe-input[id^="bfe-"][tabindex="0"]'));
	if (!candidates.length) {
		console.log("[HiBob Autofill] findPickerTrigger no candidates");
		return null;
	}

	const visibleCandidates = candidates.filter((candidate) => isElementVisible(candidate));
	const toSearch = visibleCandidates.length ? visibleCandidates : candidates;

	const withText = toSearch.find((candidate) => {
		const textSpan = candidate.querySelector("span");
		const textValue = textSpan ? norm(textSpan.textContent) : "";
		return textValue.length > 0;
	});

	const chosen = withText || toSearch[0] || null;
	console.log("[HiBob Autofill] findPickerTrigger chosen:", chosen);
	return chosen;
}

function findSearchInput(rootDocument) {
	const scope = rootDocument || document;

	const candidates = [
		...Array.from(scope.querySelectorAll('input.bfe-input[type="search"][placeholder="Search"]')),
		...Array.from(scope.querySelectorAll('input.bfe-input[type="search"]')),
		...Array.from(scope.querySelectorAll('input[type="search"][id^="bsrch-"].bfe-input')),
	];

	for (const candidate of candidates) {
		if (isElementVisible(candidate)) {
			console.log("[HiBob Autofill] findSearchInput visible:", candidate);
			return candidate;
		}
	}

	if (candidates.length) {
		console.log("[HiBob Autofill] findSearchInput candidates exist but none visible:", candidates);
	} else {
		console.log("[HiBob Autofill] findSearchInput no candidates");
	}

	return null;
}

function findResultsList(rootDocument) {
	const scope = rootDocument || document;

	const candidates = [...Array.from(scope.querySelectorAll("ul.btl-list[data-type='single']")), ...Array.from(scope.querySelectorAll("ul.btl-list"))];

	for (const candidate of candidates) {
		if (isElementVisible(candidate)) {
			console.log("[HiBob Autofill] findResultsList visible:", candidate);
			return candidate;
		}
	}

	if (candidates.length) {
		console.log("[HiBob Autofill] findResultsList candidates exist but none visible:", candidates);
	} else {
		console.log("[HiBob Autofill] findResultsList no candidates");
	}

	return null;
}

function findTaskListItem(listRoot, taskName) {
	const wanted = norm(taskName);
	const listItems = Array.from(listRoot.querySelectorAll("li.btl-item.btl-item-option"));

	console.log("[HiBob Autofill] findTaskListItem list items:", listItems.length, "wanted:", wanted);

	for (const listItem of listItems) {
		const nameSpan = listItem.querySelector("span.btl-item-name");
		const candidate = nameSpan ? norm(nameSpan.textContent) : norm(listItem.textContent);

		if (!candidate) {
			continue;
		}

		if (candidate === wanted) {
			console.log("[HiBob Autofill] findTaskListItem exact match:", listItem);
			return listItem;
		}

		if (candidate.includes(wanted)) {
			console.log("[HiBob Autofill] findTaskListItem partial match:", listItem, "candidate:", candidate);
			return listItem;
		}
	}

	console.log("[HiBob Autofill] findTaskListItem no match for:", taskName);
	return null;
}

async function typeIntoSearch(inputElement, textToType) {
	console.log("[HiBob Autofill] typeIntoSearch typing:", textToType, "into:", inputElement);

	inputElement.focus();

	setNativeValue(inputElement, "");
	dispatchInputEvents(inputElement);
	await sleep(80);

	setNativeValue(inputElement, textToType);
	dispatchInputEvents(inputElement);

	inputElement.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));
	inputElement.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true }));
	inputElement.dispatchEvent(new KeyboardEvent("keypress", { bubbles: true }));
}
function clickLikeUser(element) {
	if (!element) {
		return;
	}

	const rect = element.getBoundingClientRect();
	const clientX = rect.left + Math.min(10, Math.max(1, rect.width / 2));
	const clientY = rect.top + Math.min(10, Math.max(1, rect.height / 2));

	console.log("[HiBob Autofill] clickLikeUser", element, { clientX, clientY });

	element.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX, clientY, pointerId: 1, pointerType: "mouse" }));
	element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX, clientY }));
	element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX, clientY }));
	element.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX, clientY, pointerId: 1, pointerType: "mouse" }));
	element.click();
}

async function ensurePickerOpen(rootElement) {
	const globalDocument = rootElement && rootElement.ownerDocument ? rootElement.ownerDocument : document;

	const beforeActive = globalDocument.activeElement;
	const beforeVisibleSearchInputs = Array.from(
		globalDocument.querySelectorAll('input[type="search"][id^="bsrch-"], input.bfe-input[type="search"]'),
	).filter((inputElement) => {
		const rect = inputElement.getBoundingClientRect();
		return rect.width > 0 && rect.height > 0 && getComputedStyle(inputElement).visibility !== "hidden";
	});

	console.log("[HiBob Autofill] ensurePickerOpen before:", {
		active: beforeActive,
		visibleSearchInputs: beforeVisibleSearchInputs.length,
	});

	const trigger = findPickerTrigger(rootElement);
	if (!trigger) {
		console.log("[HiBob Autofill] ensurePickerOpen trigger not found");
		return false;
	}

	trigger.scrollIntoView({ block: "center", inline: "center" });
	clickLikeUser(trigger);

	const searchInput = await waitForElement(
		() => {
			const candidates = Array.from(globalDocument.querySelectorAll('input[type="search"][id^="bsrch-"], input.bfe-input[type="search"]'));

			for (const candidate of candidates) {
				const rect = candidate.getBoundingClientRect();
				const visible = rect.width > 0 && rect.height > 0 && getComputedStyle(candidate).visibility !== "hidden";

				if (!visible) {
					continue;
				}

				if (globalDocument.activeElement === candidate) {
					console.log("[HiBob Autofill] ensurePickerOpen found focused search input:", candidate);
					return candidate;
				}
			}

			const visibleAfter = candidates.filter((inputElement) => {
				const rect = inputElement.getBoundingClientRect();
				return rect.width > 0 && rect.height > 0 && getComputedStyle(inputElement).visibility !== "hidden";
			});

			if (visibleAfter.length > beforeVisibleSearchInputs.length) {
				console.log("[HiBob Autofill] ensurePickerOpen visible count increased:", visibleAfter.length);
				return visibleAfter[visibleAfter.length - 1];
			}

			return null;
		},
		8000,
		"picker search input (focused or newly visible)",
	);

	const ok = Boolean(searchInput);
	console.log("[HiBob Autofill] ensurePickerOpen result:", ok, searchInput);
	return ok;
}

async function setProjectAndTaskViaCombinedPicker(root, projectName, taskName) {
	console.log("[HiBob Autofill] setProjectAndTaskViaCombinedPicker:", { projectName, taskName, root });

	if (!projectName || !taskName) {
		return { projectOk: false, taskOk: false };
	}

	const globalDocument = root && root.ownerDocument ? root.ownerDocument : document;

	const opened = await ensurePickerOpen(root);
	if (!opened) {
		return { projectOk: false, taskOk: false, reason: "picker not found" };
	}

	const searchInput = await waitForElement(
		() => {
			const found = findSearchInput(globalDocument);
			if (found && isElementVisible(found)) {
				return found;
			}
			return null;
		},
		10000,
		"visible picker search input",
	);

	if (!searchInput) {
		return { projectOk: false, taskOk: false, reason: "search not found" };
	}

	await typeIntoSearch(searchInput, projectName);

	const resultsList = await waitForElement(
		() => {
			const found = findResultsList(globalDocument);
			if (found && isElementVisible(found)) {
				return found;
			}
			return null;
		},
		10000,
		"visible results list",
	);

	if (!resultsList) {
		return { projectOk: false, taskOk: false, reason: "results not found" };
	}

	const taskItem = await waitForElement(() => findTaskListItem(resultsList, taskName), 10000, "task list item");
	if (!taskItem) {
		return { projectOk: true, taskOk: false, reason: "task not found" };
	}

	taskItem.scrollIntoView({ block: "center", inline: "center" });
	console.log("[HiBob Autofill] setProjectAndTaskViaCombinedPicker clicking item:", taskItem);
	taskItem.click();

	return { projectOk: true, taskOk: true };
}

function modalContainsLabels(modalRoot) {
	const result = !!(
		findControlByLabel("Project", modalRoot) ||
		findControlByLabel("Project task", modalRoot) ||
		findControlByLabel("Reason", modalRoot)
	);
	console.log("[HiBob Autofill] modalContainsLabels:", result);
	return result;
}

async function fillHiBob(root = document, overrides = {}) {
	console.log("[HiBob Autofill] fillHiBob start. root:", root);

	const stored = await chrome.storage.sync.get(["project", "task", "reason", "autoClockIn"]);
	const project = overrides.project ?? stored.project;
	const task = overrides.task ?? stored.task;
	const reason = overrides.reason ?? stored.reason;
	const autoClockIn = overrides.autoClockIn ?? stored.autoClockIn;

	console.log("[HiBob Autofill] fillHiBob values:", { project, task, reason, autoClockIn });

	const results = [];

	const hasSeparateProject = Boolean(findControlByLabel("Project", root));
	const hasSeparateTask = Boolean(findControlByLabel("Project task", root));

	console.log("[HiBob Autofill] fillHiBob separate controls:", { hasSeparateProject, hasSeparateTask });

	if (project && task && (!hasSeparateProject || !hasSeparateTask)) {
		const pickerTrigger = findPickerTrigger(root);
		if (pickerTrigger) {
			const pickerResult = await setProjectAndTaskViaCombinedPicker(root, project, task);
			results.push({ label: "Project", ok: !!pickerResult.projectOk, reason: pickerResult.reason });
			results.push({ label: "Project task", ok: !!pickerResult.taskOk, reason: pickerResult.reason });
		} else {
			if (project) {
				results.push(await setDropdown("Project", project, root));
			}
			if (task) {
				results.push(await setDropdown("Project task", task, root));
			}
		}
	} else {
		if (project) {
			results.push(await setDropdown("Project", project, root));
		}
		if (task) {
			results.push(await setDropdown("Project task", task, root));
		}
	}

	if (reason) {
		results.push(await setDropdown("Reason", reason, root));
	}

	console.log("[HiBob Autofill] fillHiBob results:", results);

	await clickSaveIfEnabled(root, !!autoClockIn, results);
	console.log("[HiBob Autofill] fillHiBob done");
	return results;
}

let lastHandledModal = null;

function isModal(node) {
	if (!node || !(node instanceof Element)) {
		return false;
	}
	const role = node.getAttribute("role") || "";
	if (role.toLowerCase() === "dialog") {
		return true;
	}
	if (node.hasAttribute("aria-modal")) {
		return true;
	}
	const cls = node.className || "";
	return /modal|dialog|popover|portal/i.test(cls) || (node.id && node.id.toLowerCase().includes("modal"));
}

async function handleModal(modalRoot) {
	if (!modalRoot) {
		return;
	}

	if (modalRoot === lastHandledModal) {
		console.log("[HiBob Autofill] handleModal skipping, already handled:", modalRoot);
		return;
	}

	console.log("[HiBob Autofill] handleModal candidate:", modalRoot);

	await sleep(SETTLE_AFTER_MODAL_MS);

	const start = performance.now();
	while (performance.now() - start < 6000) {
		const hasAnythingUseful =
			modalContainsLabels(modalRoot) || Boolean(findPickerTrigger(modalRoot)) || Boolean(findSearchInput(modalRoot.ownerDocument || document));
		if (hasAnythingUseful) {
			break;
		}
		await sleep(60);
	}

	const hasAnythingUseful =
		modalContainsLabels(modalRoot) || Boolean(findPickerTrigger(modalRoot)) || Boolean(findSearchInput(modalRoot.ownerDocument || document));
	if (!hasAnythingUseful) {
		console.log("[HiBob Autofill] handleModal no useful controls detected, aborting");
		return;
	}

	lastHandledModal = modalRoot;

	try {
		console.log("[HiBob Autofill] handleModal calling fillHiBob");
		await fillHiBob(modalRoot);
	} catch (e) {
		console.log("[HiBob Autofill] handleModal fillHiBob error:", e);
	}
}

function startWatching() {
	if (observerInstance) {
		console.log("[HiBob Autofill] startWatching already active");
		return;
	}

	console.log("[HiBob Autofill] startWatching enabled");

	const scanAndHandle = () => {
		const modalCandidate = document.querySelector('[role="dialog"],[aria-modal],.modal,.MuiDialog-root,.ant-modal');

		if (modalCandidate) {
			console.log("[HiBob Autofill] scanAndHandle found modal:", modalCandidate);
			handleModal(modalCandidate);
		}
	};

	observerInstance = new MutationObserver((mutations) => {
		for (const mutation of mutations) {
			if (mutation.type === "childList") {
				for (const addedNode of mutation.addedNodes) {
					if (
						isModal(addedNode) ||
						(addedNode.querySelector && addedNode.querySelector('[role="dialog"],[aria-modal],.modal,.MuiDialog-root,.ant-modal'))
					) {
						const modalRoot =
							(isModal(addedNode) && addedNode) ||
							(addedNode.querySelector && (addedNode.querySelector('[role="dialog"],[aria-modal],.modal,.MuiDialog-root,.ant-modal') || addedNode)) ||
							addedNode;

						console.log("[HiBob Autofill] MutationObserver modal detected:", modalRoot);
						handleModal(modalRoot);
					}
				}
			}

			if (mutation.type === "attributes") {
				const targetElement = mutation.target;

				if (isModal(targetElement)) {
					console.log("[HiBob Autofill] attributes changed on modal:", targetElement);
					handleModal(targetElement);
				} else {
					scanAndHandle();
				}
			}
		}
	});

	observerInstance.observe(document.documentElement, {
		childList: true,
		subtree: true,
		attributes: true,
		attributeFilter: ["class", "style", "aria-hidden", "aria-modal", "role"],
	});

	scanAndHandle();
}

function stopWatching() {
	if (observerInstance) {
		console.log("[HiBob Autofill] stopWatching disconnecting observer");
		observerInstance.disconnect();
		observerInstance = null;
	}
}

chrome.storage.sync.get(["autofillModal"]).then(({ autofillModal }) => {
	autofillEnabled = !!autofillModal;
	console.log("[HiBob Autofill] initial autofillModal:", autofillEnabled);

	if (autofillEnabled) {
		startWatching();
	}
});

chrome.storage.onChanged.addListener((changes, area) => {
	if (area === "sync" && "autofillModal" in changes) {
		autofillEnabled = !!changes.autofillModal.newValue;
		console.log("[HiBob Autofill] autofillModal changed:", autofillEnabled);

		if (autofillEnabled) {
			startWatching();
		} else {
			stopWatching();
		}
	}
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
	if (msg?.type === "FILL_HIBOB") {
		console.log("[HiBob Autofill] onMessage FILL_HIBOB:", msg);

		const { project, task, reason, autoClockIn } = msg;
		fillHiBob(document, { project, task, reason, autoClockIn }).then(sendResponse);
		return true;
	}

	if (msg?.type === "TOGGLE_AUTOFILL") {
		console.log("[HiBob Autofill] onMessage TOGGLE_AUTOFILL:", msg);

		const enabled = !!msg.enabled;
		if (enabled) {
			startWatching();
		} else {
			stopWatching();
		}

		sendResponse?.({ ok: true });
		return true;
	}
});
