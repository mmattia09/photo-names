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
  band: null,
  hint: null,
  pending: null,
  pickerSeen: false,
  frame: 0,
};

function toggleTip() {
  return quick.on
    ? "Quick add is on — Esc to leave"
    : "Quick add: click two corners to tag a face";
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

function placeBand(fromEvent) {
  if (!quick.first || !quick.band) return;
  const start = toScreenBox({ ...quick.first, width: 0, height: 0 });
  if (!start) return;
  const left = Math.min(start.left, fromEvent.clientX);
  const top = Math.min(start.top, fromEvent.clientY);
  quick.band.style.left = `${left}px`;
  quick.band.style.top = `${top}px`;
  quick.band.style.width = `${Math.abs(fromEvent.clientX - start.left)}px`;
  quick.band.style.height = `${Math.abs(fromEvent.clientY - start.top)}px`;
}

/** The confirmed box is redrawn every frame, because opening Immich's picker
    resets the zoom and moves the image out from under it. */
function trackPending() {
  cancelAnimationFrame(quick.frame);
  if (!quick.pending || !quick.band) return;
  const screen = toScreenBox(quick.pending);
  if (screen) {
    quick.band.style.left = `${screen.left}px`;
    quick.band.style.top = `${screen.top}px`;
    quick.band.style.width = `${screen.width}px`;
    quick.band.style.height = `${screen.height}px`;
  }
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
  quick.pending = null;
  quick.pickerSeen = false;
  delete document.documentElement.dataset.photoNamesRect;
  document.documentElement.classList.remove("photo-names-tagging");
}

function setQuick(on) {
  quick.on = on;
  clearDrawing();
  document.documentElement.classList.toggle("photo-names-quick", on);
  setHint(on ? "Click two opposite corners of a face · Esc to cancel" : null);
  for (const button of document.querySelectorAll(`.${TOGGLE_CLASS}`)) {
    button.dataset.active = String(on);
    button.dataset.tip = toggleTip();
    button.setAttribute("aria-pressed", String(on));
  }
}

function beginBox(event) {
  quick.first = toImagePoint(event);
  if (!quick.first) return;
  quick.band = overlay("photo-names-band");
  placeBand(event);
  setHint("Now click the opposite corner · Esc to cancel");
}

/**
 * Hands the box to the page script and lets Immich take over: its picker is
 * opened for real, so searching and creating people stay Immich's job.
 */
function finishBox(event) {
  const second = toImagePoint(event);
  const first = quick.first;
  if (!first || !second) return clearDrawing();

  const box = {
    x: Math.round(Math.min(first.x, second.x)),
    y: Math.round(Math.min(first.y, second.y)),
    width: Math.round(Math.abs(second.x - first.x)),
    height: Math.round(Math.abs(second.y - first.y)),
    imageWidth: first.imageWidth,
    imageHeight: first.imageHeight,
  };

  if (box.width < MIN_BOX || box.height < MIN_BOX) {
    clearDrawing();
    setHint("Too small — click two opposite corners of a face · Esc to cancel");
    return;
  }

  const button = tagButton();
  if (!button) {
    clearDrawing();
    setHint("Immich's tag button is not on screen · Esc to cancel");
    return;
  }

  quick.first = null;
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

  event.preventDefault();
  event.stopPropagation();

  if (quick.first) finishBox(event);
  else beginBox(event);
}

function onQuickMove(event) {
  if (quick.on && quick.first) placeBand(event);
}

function onQuickKey(event) {
  if (event.key !== "Escape" || !quick.on) return;

  if (quick.pending) {
    // Let Immich see it too, so its picker closes with our box.
    clearDrawing();
    setHint("Click two opposite corners of a face · Esc to cancel");
    return;
  }

  if (quick.first) {
    event.preventDefault();
    event.stopPropagation();
    clearDrawing();
    setHint("Click two opposite corners of a face · Esc to cancel");
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  setQuick(false);
}

/** Immich's tagging canvas going away means the picker closed, either way. */
function watchPicker() {
  if (!quick.pending) return;
  const open = !!document.querySelector(".canvas-container");
  if (open) {
    quick.pickerSeen = true;
  } else if (quick.pickerSeen) {
    clearDrawing();
    setHint("Click two opposite corners of a face · Esc to cancel");
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
document.addEventListener("keydown", onQuickKey, true);

new MutationObserver(schedule).observe(document.documentElement, {
  childList: true,
  subtree: true,
});
schedule();
