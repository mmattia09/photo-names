/**
 * Registers the content script on the configured Immich origin, and only there.
 *
 * The instance URL is not known at build time and is private to whoever installs
 * the extension, so the script cannot be declared in the manifest: it is
 * registered at runtime from the address saved in the options page, once the
 * matching host permission has been granted.
 */

const SCRIPT_ID = "photo-names-immich";
/** The fetch patch has to live in the page's own world to be seen by Immich. */
const PAGE_SCRIPT_ID = "photo-names-immich-page";
const SCRIPT_IDS = [SCRIPT_ID, PAGE_SCRIPT_ID];

/**
 * Match patterns cannot carry a port, so an instance on a non-standard port
 * (Immich's default is 2283) has to be matched by host alone. The content
 * script re-checks the full origin before it does anything.
 */
function matchPatternFor(url) {
  const { protocol, hostname } = new URL(url);
  return `${protocol}//${hostname}/*`;
}

async function currentPattern() {
  const { immichUrl } = await browser.storage.local.get("immichUrl");
  if (!immichUrl) return null;
  try {
    return matchPatternFor(immichUrl);
  } catch {
    return null;
  }
}

async function sync() {
  const registered = await browser.scripting
    .getRegisteredContentScripts({ ids: SCRIPT_IDS })
    .catch(() => []);
  if (registered.length > 0) {
    await browser.scripting.unregisterContentScripts({
      ids: registered.map((script) => script.id),
    });
  }

  const pattern = await currentPattern();
  if (!pattern) return;

  const granted = await browser.permissions.contains({ origins: [pattern] });
  if (!granted) return;

  await browser.scripting.registerContentScripts([
    {
      id: SCRIPT_ID,
      matches: [pattern],
      js: ["src/content.js"],
      css: ["src/content.css"],
      runAt: "document_idle",
      // Re-registered on every startup instead, so a stale pattern from an old
      // session can never outlive the setting it came from.
      persistAcrossSessions: false,
    },
    {
      id: PAGE_SCRIPT_ID,
      matches: [pattern],
      js: ["src/page.js"],
      // MAIN so it can replace the fetch Immich actually calls, and at
      // document_start so the patch is in place before Immich asks for anything.
      world: "MAIN",
      runAt: "document_start",
      persistAcrossSessions: false,
    },
  ]);
}

browser.runtime.onInstalled.addListener(sync);
browser.runtime.onStartup.addListener(sync);
browser.permissions.onAdded.addListener(sync);
browser.permissions.onRemoved.addListener(sync);
browser.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.immichUrl) sync();
});

browser.action.onClicked.addListener(() => browser.runtime.openOptionsPage());

sync();
