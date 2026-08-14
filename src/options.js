const form = document.getElementById("settings");
const input = document.getElementById("url");
const status = document.getElementById("status");

const LOCAL_HOST =
  /^(localhost|[0-9.]+|\[[0-9a-f:]+\]|.+\.(local|lan|home|internal))$/i;

function say(message, tone) {
  status.textContent = message;
  status.dataset.tone = tone;
}

/**
 * A hostname on its own is ambiguous, and guessing https for a LAN address is
 * the guess that fails: self-hosted instances on a private network are
 * overwhelmingly plain http, everything reachable from outside is not.
 */
function normalise(raw) {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const withScheme = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `${LOCAL_HOST.test(trimmed.split(/[:/]/)[0]) ? "http" : "https"}://${trimmed}`;

  let url;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (!url.hostname) return null;

  return {
    href: url.origin + url.pathname.replace(/\/+$/, ""),
    // Match patterns carry no port, so the whole host is covered either way.
    pattern: `${url.protocol}//${url.hostname}/*`,
  };
}

async function report(saved) {
  if (!saved) {
    say("Not configured yet.", "muted");
    return;
  }
  const granted = await browser.permissions.contains({ origins: [saved.pattern] });
  if (granted) {
    say(`Active on ${saved.href}`, "ok");
  } else {
    say("Saved, but access to that host was not granted — save again to ask for it.", "bad");
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();

  const saved = normalise(input.value);
  if (!saved) {
    say("That does not look like an address.", "bad");
    return;
  }

  // Firefox only honours a permission request made straight out of the click,
  // so this cannot wait behind an await.
  browser.permissions
    .request({ origins: [saved.pattern] })
    .then(async (granted) => {
      if (!granted) {
        say("Access to that host was refused, so the button cannot appear on it.", "bad");
        return;
      }
      await browser.storage.local.set({ immichUrl: saved.href });
      input.value = saved.href;
      say(`Active on ${saved.href}`, "ok");
    })
    .catch((error) => say(error.message, "bad"));
});

(async () => {
  const { immichUrl } = await browser.storage.local.get("immichUrl");
  if (immichUrl) input.value = immichUrl;
  await report(normalise(immichUrl || ""));
})();
