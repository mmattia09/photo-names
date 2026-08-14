/**
 * Adds a button beside the description field of Immich's asset viewer. Pressing
 * it asks the API which people are on the photo and writes their names into the
 * field, joined with "+" and closed by a trailing "_":
 *
 *     mario-rossi+anna-verdi+luca-bianchi_
 *
 * The field is only filled in, never saved: Immich sends the PUT itself when the
 * textarea loses focus, so there is always a chance to look before it sticks.
 */

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const ASSET_IN_URL = new RegExp(`/api/assets/(${UUID})/`, "i");
const UUID_ANYWHERE = new RegExp(UUID, "gi");

const DESCRIPTION_SELECTOR = '#detail-panel textarea[data-testid="autogrow-textarea"]';
const BUTTON_CLASS = "photo-names-button";

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
 * The route shape differs between the timeline, an album and a shared link, so
 * the viewer's own preview image is the more dependable source: its URL always
 * carries the id of the asset actually on screen. The address bar is the
 * fallback for the layouts that render no <img> (videos still loading, mainly).
 */
function currentAssetId() {
  const viewer = document.getElementById("immich-asset-viewer");
  if (viewer) {
    const media = viewer.querySelector(
      'img[src*="/api/assets/"][src*="size=preview"], video[src*="/api/assets/"], source[src*="/api/assets/"]',
    );
    const match = media && (media.getAttribute("src") || "").match(ASSET_IN_URL);
    if (match) return match[1];
  }

  const fromQuery = new URLSearchParams(location.search).get("assetId");
  if (fromQuery && new RegExp(`^${UUID}$`, "i").test(fromQuery)) return fromQuery;

  const inPath = location.pathname.match(UUID_ANYWHERE);
  return inPath ? inPath[inPath.length - 1] : null;
}

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

function flash(button, state, title) {
  button.dataset.state = state;
  button.title = title;
  setTimeout(() => {
    if (button.dataset.state !== state) return;
    delete button.dataset.state;
    button.title = button.dataset.idleTitle;
  }, 2500);
}

async function onClick(button, textarea) {
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

function createButton(textarea) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = BUTTON_CLASS;
  button.dataset.idleTitle = "Fill the description with the people on this photo";
  button.title = button.dataset.idleTitle;
  button.setAttribute("aria-label", button.dataset.idleTitle);
  button.innerHTML = `
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
      <path fill="currentColor" d="M9 13c-2.7 0-8 1.3-8 4v2h16v-2c0-2.7-5.3-4-8-4Zm0-2a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm7.5 2.2c1.3.9 2.5 2.1 2.5 3.8v2h4v-2c0-2.3-4-3.6-6.5-3.8ZM16 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"/>
    </svg>`;
  button.addEventListener("click", (event) => {
    event.preventDefault();
    onClick(button, textarea);
  });
  return button;
}

/**
 * The detail panel is torn down and rebuilt as photos are stepped through, so
 * the button is re-attached whenever it goes missing rather than added once.
 */
function ensureButton() {
  const textarea = document.querySelector(DESCRIPTION_SELECTOR);
  if (!textarea) return;

  const holder = textarea.parentElement;
  if (!holder || holder.querySelector(`.${BUTTON_CLASS}`)) return;

  holder.classList.add("photo-names-holder");
  textarea.classList.add("photo-names-textarea");
  holder.appendChild(createButton(textarea));
}

let scheduled = false;
function schedule() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    ensureButton();
  });
}

new MutationObserver(schedule).observe(document.documentElement, {
  childList: true,
  subtree: true,
});
schedule();
