/**
 * Two things in Immich's asset viewer:
 *
 * 1. A button beside the description field that fills it with the names of the
 *    people on the photo, joined with "+" and closed by a trailing "_":
 *
 *        mario-rossi+anna-verdi+luca-bianchi_
 *
 *    The field is only filled in, never saved — Immich sends the PUT itself when
 *    the textarea loses focus, so there is always a chance to look before it
 *    sticks.
 *
 * 2. A quick add toggle beside Immich's own tag buttons. With it on, two clicks
 *    on the photo mark the opposite corners of a face, and Immich's person
 *    picker opens on the box just drawn. Escape backs out.
 */

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const ASSET_IN_URL = new RegExp(`/api/assets/(${UUID})/`, "i");
const UUID_ANYWHERE = new RegExp(UUID, "gi");

const DESCRIPTION_SELECTOR = '#detail-panel textarea[data-testid="autogrow-textarea"]';
/** Immich swaps the <img> from size=preview to size=fullsize the moment you
    zoom in, so the source is matched by asset rather than by which rendition. */
const MEDIA_SELECTOR = '#immich-asset-viewer img[src*="/api/assets/"]';
const BUTTON_CLASS = "photo-names-button";
const TOGGLE_CLASS = "photo-names-quick-toggle";

/** Immich's "tag people" button, found by its icon so the locale cannot matter. */
const PLUS_PATH = "M19,13H13V19H11V13H5V11H11V5H13V11H19V13Z";

/** Below this, in preview pixels, a box is a stray click rather than a face. */
const MIN_BOX = 12;

/** Immich's delete button, matched by its icon so the locale cannot matter. */
const TRASH_PATH =
  "M6,19A2,2 0 0,0 8,21H16A2,2 0 0,0 18,19V7H6V19M8,9H16V19H8V9M15.5,4L14.5,3H9.5L8.5,4H5V6H19V4H15.5Z";

/** Where Immich stacks its notifications. */
const TOAST_STACK = "div.fixed.z-60.top-16";

/**
 * Immich's own tooltip classes and timing, so the hint over these buttons is the
 * one the rest of the toolbar shows. bits-ui drives the real ones from Svelte
 * and cannot be asked to take another trigger, but the look is just these
 * classes, and `data-state` is what plays the fade-in.
 */
const TOOLTIP_CLASS =
  "tooltip-content bg-light-800 text-light z-90 rounded-lg px-3.5 py-2 text-xs shadow-lg";
const TOOLTIP_DELAY = 700;

let apiBase = null;

/** The origin the user configured, port included — the match pattern lost it. */
async function resolveApiBase() {
  const { immichUrl } = await browser.storage.local.get("immichUrl");
  if (!immichUrl) return null;
  let url;
  try {
    url = new URL(immichUrl);
  } catch {
    return null;
  }
  if (url.origin !== location.origin) return null;
  return url.href.replace(/\/+$/, "");
}

/**
 * The rendition on screen, whichever it is. Stepping between photos can leave
 * two of these in the DOM for a frame, so the biggest one wins — that is the one
 * being looked at. Its naturalWidth/Height is the coordinate space Immich itself
 * reports as imageWidth/imageHeight, so the two always agree.
 */
function previewImage() {
  let best = null;
  for (const image of document.querySelectorAll(MEDIA_SELECTOR)) {
    if (!image.naturalWidth) continue;
    const rect = image.getBoundingClientRect();
    const area = rect.width * rect.height;
    if (!best || area > best.area) best = { image, area };
  }
  return best ? best.image : null;
}

/**
 * The route shape differs between the timeline, an album and a shared link, so
 * the viewer's own preview image is the more dependable source: its URL always
 * carries the id of the asset actually on screen. The address bar is the
 * fallback for the layouts that render no <img> (videos still loading, mainly).
 */
function currentAssetId() {
  const viewer = document.getElementById("immich-asset-viewer");
  if (viewer) {
    const media =
      previewImage() ||
      viewer.querySelector('video[src*="/api/assets/"], source[src*="/api/assets/"]');
    const match = media && (media.getAttribute("src") || "").match(ASSET_IN_URL);
    if (match) return match[1];
  }

  const fromQuery = new URLSearchParams(location.search).get("assetId");
  if (fromQuery && new RegExp(`^${UUID}$`, "i").test(fromQuery)) return fromQuery;

  const inPath = location.pathname.match(UUID_ANYWHERE);
  return inPath ? inPath[inPath.length - 1] : null;
}

/* ---------------------------------------------------------------- tooltip -- */

const tip = { element: null, owner: null, timer: 0, hold: 0 };

function hideTip() {
  clearTimeout(tip.timer);
  tip.timer = 0;
  tip.element?.remove();
  tip.element = null;
  tip.owner = null;
}

function showTip(owner) {
  if (!owner.isConnected || !owner.dataset.tip) return;

  if (!tip.element) {
    tip.element = document.createElement("div");
    tip.element.className = `${TOOLTIP_CLASS} photo-names-tip`;
    tip.element.setAttribute("role", "tooltip");
    tip.element.dataset.state = "delayed-open";
    tip.element.dataset.side = "top";
    document.body.appendChild(tip.element);
  }

  tip.element.textContent = owner.dataset.tip;
  tip.owner = owner;

  const anchor = owner.getBoundingClientRect();
  const box = tip.element.getBoundingClientRect();
  const above = anchor.top - box.height - 6;
  tip.element.style.left = `${clamp(anchor.left + anchor.width / 2 - box.width / 2, 8, window.innerWidth - box.width - 8)}px`;
  tip.element.style.top = `${above < 8 ? anchor.bottom + 6 : above}px`;
}

function attachTooltip(element) {
  element.addEventListener("mouseenter", () => {
    clearTimeout(tip.timer);
    tip.timer = setTimeout(() => showTip(element), TOOLTIP_DELAY);
  });
  element.addEventListener("mouseleave", () => {
    if (!tip.hold) hideTip();
  });
  element.addEventListener("focus", () => showTip(element));
  element.addEventListener("blur", hideTip);
  element.addEventListener("click", hideTip);
}

/** What went wrong is worth reading without having to go looking for it. */
function announce(owner, text) {
  clearTimeout(tip.hold);
  owner.dataset.tip = text;
  showTip(owner);
  tip.hold = setTimeout(() => {
    tip.hold = 0;
    if (tip.owner === owner) hideTip();
  }, 2500);
}

/* ------------------------------------------------------------------ names -- */

function toSlug(name) {
  return name.trim().toLowerCase().replace(/\s+/g, "-");
}

/** Unnamed and hidden people are skipped; the order Immich returns is kept. */
function formatPeople(people) {
  const names = (people || [])
    .filter((person) => !person.isHidden && person.name && person.name.trim())
    .map((person) => toSlug(person.name));
  return names.length > 0 ? `${names.join("+")}_` : "";
}

async function fetchPeople(assetId) {
  const response = await fetch(`${apiBase}/api/assets/${assetId}`, {
    credentials: "include",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Immich answered ${response.status}`);
  const asset = await response.json();
  return asset.people;
}

/**
 * Svelte's binding reads the DOM on `input`, so assigning the value is not
 * enough on its own — the event is what makes the description stick and what
 * lets the textarea grow to fit.
 */
function fillField(textarea, value) {
  textarea.value = value;
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
  textarea.focus();
  textarea.setSelectionRange(value.length, value.length);
  textarea.scrollTop = textarea.scrollHeight;
}

function flash(button, state, message) {
  button.dataset.state = state;
  announce(button, message);
  setTimeout(() => {
    if (button.dataset.state !== state) return;
    delete button.dataset.state;
    button.dataset.tip = button.dataset.idleTip;
  }, 2500);
}

async function onFillClick(button, textarea) {
  if (button.dataset.state === "busy") return;
  button.dataset.state = "busy";

  try {
    if (!apiBase) apiBase = await resolveApiBase();
    if (!apiBase) throw new Error("Set the Immich address in the extension options");

    const assetId = currentAssetId();
    if (!assetId) throw new Error("Could not tell which photo is open");

    const description = formatPeople(await fetchPeople(assetId));
    if (!description) throw new Error("Nobody named on this photo");

    fillField(textarea, description);
    flash(button, "done", "Description filled in");
  } catch (error) {
    flash(button, "error", error.message);
  }
}

function createFillButton(textarea) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = BUTTON_CLASS;
  button.dataset.idleTip = "Fill the description with the people on this photo";
  button.dataset.tip = button.dataset.idleTip;
  button.setAttribute("aria-label", button.dataset.idleTip);
  button.innerHTML = `
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
      <path fill="currentColor" d="M9 13c-2.7 0-8 1.3-8 4v2h16v-2c0-2.7-5.3-4-8-4Zm0-2a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm7.5 2.2c1.3.9 2.5 2.1 2.5 3.8v2h4v-2c0-2.3-4-3.6-6.5-3.8ZM16 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"/>
    </svg>`;
  button.addEventListener("click", (event) => {
    event.preventDefault();
    onFillClick(button, textarea);
  });
  attachTooltip(button);
  return button;
}

function ensureFillButton() {
  const textarea = document.querySelector(DESCRIPTION_SELECTOR);
  if (!textarea) return;

  const holder = textarea.parentElement;
  if (!holder || holder.querySelector(`.${BUTTON_CLASS}`)) return;

  holder.classList.add("photo-names-holder");
  textarea.classList.add("photo-names-textarea");
  holder.appendChild(createFillButton(textarea));
}

/* -------------------------------------------------------------- quick add -- */

const quick = {
  on: false,
  first: null,
  cursor: null,
  /** Set while Option is down: the size to keep and where the pointer grabbed it. */
  drag: null,
  band: null,
  hint: null,
  pending: null,
  pickerSeen: false,
  frame: 0,
};

const DRAW_HINT = "Click two opposite corners of a face · Enter names · X or Esc to leave";
const SIZING_HINT = "Now the opposite corner · hold ⌥ to move the box · Esc to cancel";

/** Single-letter shortcuts have no business firing into a field. */
function isTyping(node) {
  return !!(
    node &&
    typeof node.closest === "function" &&
    node.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')
  );
}

function focusedDescription() {
  const active = document.activeElement;
  return active && typeof active.matches === "function" && active.matches(DESCRIPTION_SELECTOR)
    ? active
    : null;
}

function toggleTip() {
  return quick.on
    ? "Quick add is on — X or Esc to leave"
    : "Quick add (X): click two corners to tag a face";
}

function tagButton() {
  for (const button of document.querySelectorAll("#detail-panel button")) {
    const path = button.querySelector("svg path");
    if (path && path.getAttribute("d") === PLUS_PATH) return button;
  }
  return null;
}

function clamp(value, low, high) {
  return Math.min(high, Math.max(low, value));
}

/**
 * getBoundingClientRect already carries Immich's zoom transform, so a click maps
 * to the preview's own pixels at any magnification without reading the matrix.
 */
function toImagePoint(event) {
  const image = previewImage();
  if (!image || !image.naturalWidth) return null;

  const rect = image.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;

  return {
    x: clamp(((event.clientX - rect.left) / rect.width) * image.naturalWidth, 0, image.naturalWidth),
    y: clamp(((event.clientY - rect.top) / rect.height) * image.naturalHeight, 0, image.naturalHeight),
    imageWidth: image.naturalWidth,
    imageHeight: image.naturalHeight,
  };
}

/** Preview pixels back to where they now sit on screen, zoom and all. */
function toScreenBox(box) {
  const image = previewImage();
  if (!image || !image.naturalWidth) return null;

  const rect = image.getBoundingClientRect();
  const scaleX = rect.width / image.naturalWidth;
  const scaleY = rect.height / image.naturalHeight;
  return {
    left: rect.left + box.x * scaleX,
    top: rect.top + box.y * scaleY,
    width: box.width * scaleX,
    height: box.height * scaleY,
  };
}

function overlay(className) {
  const element = document.createElement("div");
  element.className = className;
  document.body.appendChild(element);
  return element;
}

/**
 * The box as it stands. Normally one corner is pinned where you first clicked
 * and the other follows the pointer; with Option held the whole rectangle
 * travels instead, at the size it already had — for when the size is right but
 * it is sitting slightly off the face.
 */
function liveBox(point) {
  if (quick.drag) {
    return {
      x: point.x - quick.drag.dx,
      y: point.y - quick.drag.dy,
      width: quick.drag.width,
      height: quick.drag.height,
    };
  }
  return {
    x: Math.min(quick.first.x, point.x),
    y: Math.min(quick.first.y, point.y),
    width: Math.abs(point.x - quick.first.x),
    height: Math.abs(point.y - quick.first.y),
  };
}

/** Option-dragging can carry the box off the edge; the API wants it on the photo. */
function clampBox(box, imageWidth, imageHeight) {
  const x = clamp(box.x, 0, Math.max(0, imageWidth - box.width));
  const y = clamp(box.y, 0, Math.max(0, imageHeight - box.height));
  return {
    x,
    y,
    width: clamp(box.width, 0, imageWidth - x),
    height: clamp(box.height, 0, imageHeight - y),
  };
}

function drawBand(box) {
  if (!quick.band) return;
  const screen = toScreenBox(box);
  if (!screen) return;
  quick.band.style.left = `${screen.left}px`;
  quick.band.style.top = `${screen.top}px`;
  quick.band.style.width = `${screen.width}px`;
  quick.band.style.height = `${screen.height}px`;
}

/** The confirmed box is redrawn every frame, because opening Immich's picker
    resets the zoom and moves the image out from under it. */
function trackPending() {
  cancelAnimationFrame(quick.frame);
  if (!quick.pending || !quick.band) return;
  drawBand(quick.pending);
  quick.frame = requestAnimationFrame(trackPending);
}

function setHint(text) {
  if (!text) {
    quick.hint?.remove();
    quick.hint = null;
    return;
  }
  if (!quick.hint) quick.hint = overlay("photo-names-hint");
  quick.hint.textContent = text;
}

function clearDrawing() {
  cancelAnimationFrame(quick.frame);
  quick.frame = 0;
  quick.band?.remove();
  quick.band = null;
  quick.first = null;
  quick.cursor = null;
  quick.drag = null;
  quick.pending = null;
  quick.pickerSeen = false;
  delete document.documentElement.dataset.photoNamesRect;
  document.documentElement.classList.remove("photo-names-tagging");
}

function setQuick(on) {
  quick.on = on;
  clearDrawing();
  document.documentElement.classList.toggle("photo-names-quick", on);
  setHint(on ? DRAW_HINT : null);
  for (const button of document.querySelectorAll(`.${TOGGLE_CLASS}`)) {
    button.dataset.active = String(on);
    button.dataset.tip = toggleTip();
    button.setAttribute("aria-pressed", String(on));
  }
}

function beginBox(point) {
  quick.first = point;
  quick.cursor = point;
  quick.drag = null;
  quick.band = overlay("photo-names-band");
  drawBand(liveBox(point));
  setHint(SIZING_HINT);
}

/**
 * Hands the box to the page script and lets Immich take over: its picker is
 * opened for real, so searching and creating people stay Immich's job.
 */
function finishBox(point) {
  const first = quick.first;
  if (!first) return clearDrawing();

  const drawn = clampBox(liveBox(point), first.imageWidth, first.imageHeight);
  const box = {
    x: Math.round(drawn.x),
    y: Math.round(drawn.y),
    width: Math.round(drawn.width),
    height: Math.round(drawn.height),
    imageWidth: first.imageWidth,
    imageHeight: first.imageHeight,
  };

  if (box.width < MIN_BOX || box.height < MIN_BOX) {
    clearDrawing();
    setHint(`Too small — ${DRAW_HINT}`);
    return;
  }

  const button = tagButton();
  if (!button) {
    clearDrawing();
    setHint("Immich's tag button is not on screen · Esc to cancel");
    return;
  }

  quick.first = null;
  quick.drag = null;
  quick.pending = box;
  document.documentElement.dataset.photoNamesRect = JSON.stringify(box);
  // Immich would otherwise draw its own default box over the photo.
  document.documentElement.classList.add("photo-names-tagging");
  setHint("Pick who this is · Esc to cancel");
  trackPending();
  button.click();
}

function onQuickClick(event) {
  if (!quick.on || quick.pending) return;
  // Every Immich control keeps working while the mode is on.
  if (event.target.closest("#detail-panel, button, a, input, textarea, [role='button']")) return;
  if (!previewImage()) return;

  const point = toImagePoint(event);
  if (!point) return;

  event.preventDefault();
  event.stopPropagation();

  if (quick.first) finishBox(point);
  else beginBox(point);
}

function onQuickMove(event) {
  if (!quick.on || !quick.first) return;
  const point = toImagePoint(event);
  if (!point) return;

  if (event.altKey && !quick.drag) {
    const box = liveBox(point);
    quick.drag = {
      dx: point.x - box.x,
      dy: point.y - box.y,
      width: box.width,
      height: box.height,
    };
  } else if (!event.altKey && quick.drag) {
    // Where the box was left, which is the last point seen while it was being
    // carried — reading the new one would translate it once more on the way out.
    const box = liveBox(quick.cursor || point);
    quick.drag = null;
    // Back to resizing under the same rule as the first drag: the corner the
    // pointer is furthest from stays put, and the pointer takes the other one.
    quick.first = {
      ...quick.first,
      x: point.x < box.x + box.width / 2 ? box.x + box.width : box.x,
      y: point.y < box.y + box.height / 2 ? box.y + box.height : box.y,
    };
  }

  quick.cursor = point;
  drawBand(liveBox(point));
}

/* ------------------------------------------------------- Immich's dialog -- */

/**
 * Immich's confirm dialog rebuilt from its own utility classes. It has to be
 * rebuilt rather than borrowed: Immich shows no confirmation for a delete at
 * all — the Delete key trashes the photo on the spot — so there is no dialog of
 * its own to reuse here.
 */
const DIALOG = {
  backdrop: "z-40 fixed start-0 top-0 flex h-dvh max-h-dvh w-screen bg-black/30 dark:bg-black/70",
  frame: "z-50 fixed inset-0 m-auto flex max-h-dvh grow sm:p-4 sm:h-min md:max-w-md",
  column: "flex w-full grow flex-col justify-center",
  card: "w-full overflow-hidden bg-light dark:bg-subtle border-subtle shadow-primary/20 flex rounded-none border shadow-sm sm:rounded-2xl dark:border-white/10 h-full sm:h-min md:max-w-md",
  inner: "flex w-full grow flex-col",
  header: "flex flex-col p-4 border-b border-gray-200 px-5 py-3 dark:border-white/10",
  headerRow: "flex items-center justify-between gap-2",
  title: "tracking-tight md:text-xl text-dark/90 grow text-lg font-semibold",
  body: "immich-scrollbar h-full w-full overflow-auto p-4 grow px-5",
  footer: "flex items-center p-4 border-t border-gray-200 dark:border-white/10",
  footerRow: "flex flex-row items-center w-full gap-2",
  close:
    "flex items-center justify-center gap-1 font-medium outline-offset-2 transition-colors focus-visible:outline-2 cursor-pointer rounded-full text-base h-10 w-10 outline-dark text-dark not-disabled:hover:bg-dark/10 -me-2",
  button:
    "flex items-center justify-center gap-1 font-medium outline-offset-2 transition-colors focus-visible:outline-2 cursor-pointer rounded-full w-full px-5 py-2 text-base",
  cancel: "outline-dark bg-dark text-light not-disabled:hover:bg-dark/80",
  danger: "outline-danger bg-danger text-light not-disabled:hover:bg-danger/80",
};

const CONFIRM_CLASS = "photo-names-confirm";
const confirmDialog = { root: null, run: null };

function closeConfirm() {
  confirmDialog.root?.remove();
  confirmDialog.root = null;
  confirmDialog.run = null;
}

function openConfirm({ title, message, confirmLabel, cancelLabel, onConfirm }) {
  closeConfirm();

  const root = document.createElement("div");
  root.className = CONFIRM_CLASS;

  const backdrop = document.createElement("div");
  backdrop.className = DIALOG.backdrop;
  backdrop.addEventListener("click", closeConfirm);

  const frame = document.createElement("div");
  frame.className = DIALOG.frame;
  frame.setAttribute("role", "dialog");
  frame.setAttribute("aria-modal", "true");

  const heading = document.createElement("p");
  heading.className = DIALOG.title;
  heading.textContent = title;

  const close = document.createElement("button");
  close.type = "button";
  close.className = DIALOG.close;
  close.setAttribute("aria-label", cancelLabel);
  close.innerHTML =
    '<svg width="60%" height="60%" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12L19,6.41Z"/></svg>';
  close.addEventListener("click", closeConfirm);

  const header = document.createElement("div");
  header.className = DIALOG.header;
  const headerRow = document.createElement("div");
  headerRow.className = DIALOG.headerRow;
  headerRow.append(heading, close);
  header.appendChild(headerRow);

  const body = document.createElement("div");
  body.className = DIALOG.body;
  const paragraph = document.createElement("p");
  paragraph.textContent = message;
  body.appendChild(paragraph);

  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = `${DIALOG.button} ${DIALOG.cancel}`;
  cancel.textContent = cancelLabel;
  cancel.addEventListener("click", closeConfirm);

  const confirm = document.createElement("button");
  confirm.type = "button";
  confirm.className = `${DIALOG.button} ${DIALOG.danger}`;
  confirm.textContent = confirmLabel;
  confirm.addEventListener("click", () => {
    const run = confirmDialog.run;
    closeConfirm();
    run?.();
  });

  const footerRow = document.createElement("div");
  footerRow.className = DIALOG.footerRow;
  footerRow.append(cancel, confirm);
  const footer = document.createElement("div");
  footer.className = DIALOG.footer;
  footer.appendChild(footerRow);

  const inner = document.createElement("div");
  inner.className = DIALOG.inner;
  inner.append(header, body, footer);
  const card = document.createElement("div");
  card.className = DIALOG.card;
  card.appendChild(inner);
  const column = document.createElement("div");
  column.className = DIALOG.column;
  column.appendChild(card);
  frame.appendChild(column);

  root.append(backdrop, frame);
  document.body.appendChild(root);

  confirmDialog.root = root;
  confirmDialog.run = onConfirm;
  confirm.focus();
}

/* ------------------------------------------------------------- tag keys -- */

/**
 * Immich leaves the picker's focus in the search box and its confirm dialog
 * focused on the close button, so Enter does nothing at either step. These two
 * shortcuts finish the job the keyboard already started.
 *
 * Everything here is gated on Immich's tagging canvas being mounted — it stays
 * up for the whole flow, dialog included — so Enter is never taken from any
 * other confirm in the app.
 */
function taggingOpen() {
  return !!document.querySelector(".canvas-container");
}

/** bg-danger marks the button that goes through with it; bg-dark cancels. */
function tagConfirmButton() {
  const dialog = document.querySelector(`[role="dialog"][aria-modal="true"]:not(.${CONFIRM_CLASS} *)`);
  if (!dialog) return null;
  return (
    [...dialog.querySelectorAll("button")].find(
      (button) => /bg-danger/.test(button.className) && button.textContent.trim(),
    ) || null
  );
}

/** The topmost row of the picker — the one the search has filtered to. */
function firstPerson() {
  for (const button of document.querySelectorAll("button")) {
    if (button.closest("#detail-panel")) continue;
    if (!button.offsetParent) continue;
    if (button.querySelector('img[src*="/api/people/"]')) return button;
  }
  return null;
}

/* -------------------------------------------------------------- the keys -- */

/** Immich's own trash button, so deleting stays Immich's: it trashes, moves to
    the next photo and reports, all the things reimplementing it would lose. */
function trashButton() {
  const viewer = document.getElementById("immich-asset-viewer");
  if (!viewer) return null;
  for (const button of viewer.querySelectorAll("button")) {
    if (button.closest("#detail-panel")) continue;
    const path = button.querySelector("svg path");
    if (path && path.getAttribute("d") === TRASH_PATH) return button;
  }
  return null;
}

function focusDescription() {
  const textarea = document.querySelector(DESCRIPTION_SELECTOR);
  if (!textarea) return;
  textarea.focus();
  textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  textarea.scrollTop = textarea.scrollHeight;
}

/** Immich stacks its notifications here; the one button on a card closes it. */
function dismissNotifications() {
  const stack = document.querySelector(TOAST_STACK);
  if (!stack) return;
  for (const card of [...stack.children]) card.querySelector("button")?.click();
}

function stop(event) {
  event.preventDefault();
  event.stopPropagation();
}

/**
 * One handler so the order is the order: our own dialog first, then Immich's
 * tagging flow, then Escape, and only then the single letters — which never
 * fire into a field.
 */
function onKey(event) {
  if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;

  if (confirmDialog.root) {
    if (event.key === "Enter") {
      stop(event);
      const run = confirmDialog.run;
      closeConfirm();
      run?.();
    } else if (event.key === "Escape") {
      stop(event);
      closeConfirm();
    }
    return;
  }

  if (event.key === "Enter" && !event.shiftKey && taggingOpen()) {
    // The dialog comes second in the flow, so it gets first refusal on the key.
    const target = tagConfirmButton() || firstPerson();
    if (target) {
      stop(event);
      target.click();
    }
    return;
  }

  if (event.key === "Escape") {
    // Escape in the description would close the whole viewer; stepping out of
    // the field is the more useful reading while the caret is sitting in it.
    const description = focusedDescription();
    if (description) {
      stop(event);
      description.blur();
      return;
    }

    if (!quick.on) return;

    if (quick.pending) {
      // Let Immich see it too, so its picker closes with our box.
      clearDrawing();
      setHint(DRAW_HINT);
      return;
    }

    stop(event);
    if (quick.first) {
      clearDrawing();
      setHint(DRAW_HINT);
      return;
    }
    setQuick(false);
    return;
  }

  if (isTyping(event.target)) return;
  if (!document.getElementById("immich-asset-viewer")) return;

  switch (event.key) {
    case "x":
    case "X":
      // Only where the mode can do anything: the viewer with its info panel
      // open, which is also where the toggle it mirrors lives.
      if (!tagButton()) return;
      stop(event);
      setQuick(!quick.on);
      return;

    case "c":
    case "C":
      if (!document.querySelector(DESCRIPTION_SELECTOR)) return;
      stop(event);
      focusDescription();
      return;

    case "v":
    case "V": {
      // The same path as the button: it fills the field and leaves the caret at
      // the end of it.
      const fill = document.querySelector(`.${BUTTON_CLASS}`);
      if (!fill) return;
      stop(event);
      fill.click();
      return;
    }

    case "r":
    case "R":
      stop(event);
      dismissNotifications();
      return;

    case "Backspace": {
      const trash = trashButton();
      if (!trash) return;
      stop(event);
      openConfirm({
        title: "Confirm",
        message: "Move this photo to the trash?",
        confirmLabel: "Confirm",
        cancelLabel: "Cancel",
        onConfirm: () => trash.click(),
      });
      return;
    }

    default:
      return;
  }
}

/** Immich's tagging canvas going away means the picker closed, either way. */
function watchPicker() {
  if (!quick.pending) return;
  const open = !!document.querySelector(".canvas-container");
  if (open) {
    quick.pickerSeen = true;
  } else if (quick.pickerSeen) {
    clearDrawing();
    setHint(DRAW_HINT);
  }
}

function createToggle(sibling) {
  const button = document.createElement("button");
  button.type = "button";
  // Immich's own classes, so it sits in the row as one of them.
  button.className = `${sibling.className} ${TOGGLE_CLASS}`;
  button.setAttribute("aria-label", "Quick add faces");
  button.setAttribute("aria-pressed", String(quick.on));
  button.dataset.active = String(quick.on);
  button.dataset.tip = toggleTip();
  button.innerHTML = `
    <svg width="60%" height="60%" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path fill="currentColor" d="M3,5V9H5V5H9V3H5A2,2 0 0,0 3,5M19,3H15V5H19V9H21V5A2,2 0 0,0 19,3M5,15H3V19A2,2 0 0,0 5,21H9V19H5V15M19,19H15V21H19A2,2 0 0,0 21,19V15H19V19Z"/>
    </svg>`;
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    setQuick(!quick.on);
  });
  attachTooltip(button);
  return button;
}

function ensureQuickToggle() {
  const sibling = tagButton();
  if (!sibling) return;

  const row = sibling.parentElement;
  if (!row || row.querySelector(`.${TOGGLE_CLASS}`)) return;

  row.insertBefore(createToggle(sibling), sibling);
}

/* ----------------------------------------------------------------- wiring -- */

/**
 * The detail panel is torn down and rebuilt as photos are stepped through, so
 * both buttons are re-attached whenever they go missing rather than added once.
 */
function ensureAll() {
  ensureFillButton();
  ensureQuickToggle();
  watchPicker();
}

let scheduled = false;
function schedule() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    ensureAll();
  });
}

window.addEventListener("scroll", hideTip, true);
window.addEventListener("resize", hideTip);

document.addEventListener("click", onQuickClick, true);
document.addEventListener("mousemove", onQuickMove, true);
document.addEventListener("keydown", onKey, true);

new MutationObserver(schedule).observe(document.documentElement, {
  childList: true,
  subtree: true,
});
schedule();
