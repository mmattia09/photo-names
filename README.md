# Photo Names

[![CI](https://img.shields.io/github/actions/workflow/status/mmattia09/photo-names/ci.yml?branch=main&label=CI&style=for-the-badge)](https://github.com/mmattia09/photo-names/actions/workflows/ci.yml)
[![Firefox 128+](https://img.shields.io/badge/firefox-128%2B-ff7139?style=for-the-badge)](https://www.mozilla.org/firefox/)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue?style=for-the-badge)](LICENSE)

A Firefox extension for [Immich](https://immich.app): a button next to the
description field of a photo fills it with the names of the people Immich
recognised in that photo, formatted as one slug.

```
mario-rossi+anna-verdi+luca-bianchi_
```

Names are lowercased, spaces become hyphens, people are joined with `+`, and the
line ends with `_`. Written this way a description stays searchable by any one
name, and the trailing underscore marks it as finished — so a half-named photo is
easy to spot. Typing that out by hand for every photo is what this replaces.

## Features

- **One button, in the obvious place** — beside the description field in the
  asset viewer's info panel, in the same style as the panel around it.
- **Quick add** — a toggle next to Immich's own tag buttons, or the **X** key.
  With it on, two clicks mark the opposite corners of a face and Immich's picker
  opens on that box, so tagging a group photo is click, click, name — over and
  over, without dragging a rectangle each time.
- **Hold ⌥ to move the box** — when the size is right but it is sitting off the
  face, Option turns the second click into a move: same dimensions, new place.
  Let go and it resizes again.
- **The whole tag runs on the keyboard** — Immich leaves the picker's focus in
  the search box and its confirm dialog focused on the close button, so Enter
  does nothing at either step. Here it picks the top match, then confirms:
  draw, type, Enter, Enter.
- **Names come from Immich itself** — the people already recognised (and named)
  on the open photo, in the order Immich returns them.
- **Unnamed and hidden people are skipped** — a face Immich has not learnt a
  name for adds nothing to the description.
- **Nothing is saved behind your back** — the field is filled in and left
  focused with the caret at the end. Immich writes the description when the
  field loses focus, exactly as if you had typed it, so there is always a moment
  to look it over or keep typing.
- **Follows you through the library** — the button reattaches itself as you step
  from photo to photo, and works from the timeline, an album or a search result.
- **Your instance only** — the address is a setting, and the extension asks for
  access to that one host. It ships with no permission to read any site.
- **No account, no server, no telemetry** — the only network call it makes is a
  read of the open photo, to your own instance.

## Keyboard

| Key | |
|---|---|
| **X** | Turn quick add on or off |
| **C** | Put the caret in the description |
| **V** | Fill in the names, then put the caret at the end of them |
| **R** | Dismiss Immich's notifications |
| **Enter** | In Immich's tag picker, take the top match; on a confirm dialog, confirm |
| **Backspace** | Ask before moving the photo to the trash — **Enter** goes through with it |
| **⌥** *(held)* | While drawing, move the box instead of resizing it |
| **Esc** | Drop the box being drawn, then leave quick add — close the delete question — and step out of the description field without closing the viewer |

Single letters only fire in the viewer, and never while the caret is in a field.
Every one was checked against Immich's own bindings first: `a` is Immich's *next
photo* and is left alone, while `x`, `c`, `v` and `r` reach nothing of Immich's.

Enter is claimed in exactly two places: the tag flow, gated on Immich's tagging
canvas being mounted — it stays up for the whole flow, dialog included — and the
delete question this extension puts up itself. It is never taken from any other
confirm in the app.

**Backspace** exists because Immich's own **Delete** trashes the photo on the
spot, with nothing to confirm and this version offering no setting to change
that. Backspace asks first, in a dialog built from Immich's own classes, and on
Enter hands the job to Immich's own trash button — so the trashing, the move to
the next photo and the notification are all still Immich's.

## Installation

The extension is not on addons.mozilla.org, so load it yourself.

### Try it without installing

1. Clone the repository.
2. Open `about:debugging#/runtime/this-firefox` in Firefox.
3. **Load Temporary Add-on…** and pick `manifest.json`.

It stays until Firefox restarts — enough to see whether it earns a place.

### Keep it

Build a package and install that:

```bash
npm install && npm run build
```

The `.zip` lands in `web-ext-artifacts/`; rename it to `.xpi` to install it.
Firefox will not take it unsigned, and there are two ways past that.

**Turn signature checking off.** Only works where the build did not hardcode it
— Developer Edition, Nightly, ESR, and forks such as Zen and LibreWolf, which
ship `MOZ_REQUIRE_SIGNING` false but still set the pref to `true` by default.
Set `xpinstall.signatures.required` to `false` in `about:config`, then install
the `.xpi` from `about:addons`. Release builds ignore the pref.

**Or sign it.** Get a [Mozilla add-on API key](https://addons.mozilla.org/developers/addon/api/key/)
and:

```bash
export WEB_EXT_API_KEY=…       # the JWT issuer
export WEB_EXT_API_SECRET=…    # the JWT secret
npm run sign
```

That is `--channel=unlisted`: the package is uploaded to Mozilla for automated
review and signing, but gets no listing on addons.mozilla.org and stays out of
search. The signed `.xpi` comes back to `web-ext-artifacts/` and installs
anywhere, no pref needed.

Signing binds the add-on id in `manifest.json` to the account that first submits
it, permanently, and refuses a version number it has already seen — so bump
`version` before signing again.

## Settings

Open the extension's options (its toolbar button, or *Add-ons and themes →
Photo Names → Preferences*) and enter the address of your Immich instance:

```
https://photos.example.com
http://immich.local:2283
```

Saving asks Firefox for access to that host — the extension has none until you
grant it, and the button appears nowhere else. Include the port if it is not the
default one; Immich's own is `2283`. Without a scheme, an address that looks
local (an IP, `localhost`, `.local`, `.lan`, `.home`, `.internal`) is taken as
`http://` and anything else as `https://`.

Firefox match patterns cannot carry a port, so the permission covers the host on
every port. The extension checks the full origin, port included, before it does
anything on a page.

## How it works

Firefox is asked for the host permission at the moment you save the address, and
the content script is registered at runtime for that host alone — there is no
`content_scripts` block in the manifest, and no build-time list of sites.

On the page the script watches for `#detail-panel textarea` (the description) and
puts the button in beside it, reattaching whenever Immich rebuilds the panel. On
a click it works out which photo is open — from the preview image's own URL,
which always carries the asset id, falling back to the address bar — then reads
`GET /api/assets/{id}` with your existing session cookie and takes `people[].name`
from the answer.

The description is written into the textarea and an `input` event is dispatched,
which is what Immich's Svelte binding listens for. Saving is left to Immich: it
sends its own `PUT /api/assets/{id}` when the field loses focus.

### Quick add

Immich's tag dialog is the good part — it searches people and creates new ones —
but the box it sends is the one dragged on its canvas, and that canvas is a
Fabric.js surface sealed inside a Svelte component with no way in from outside.

So the box is taken from the other end. Two clicks are read against the
displayed image: `getBoundingClientRect()` already carries Immich's zoom and pan
transform, so a click becomes a pixel of the image at any magnification without
anyone parsing a matrix, and the image's own `naturalWidth`/`naturalHeight` is
the coordinate space Immich reports as `imageWidth`/`imageHeight` — the two
cannot drift apart. Immich swaps the `<img>` from `size=preview` to
`size=fullsize` on zoom, so the source is matched by asset rather than by
rendition.

That box is handed to [`src/page.js`](src/page.js) on a dataset attribute.
Immich's own tag button is then clicked for real, its default box hidden, and
when a person is chosen the outgoing `POST /api/faces` has its `x`, `y`, `width`
and `height` swapped for the drawn ones on the way out. Immich keeps its dialog
and does its own saving; only the four numbers change.

Immich's Delete has no confirmation and no preference to add one, so the
Backspace question is a dialog of this extension's own, assembled from Immich's
utility classes — the same card, borders and buttons — and it only ever calls
Immich's trash button. The extension never issues a delete itself.

Opening the picker is Immich's own button, and Immich resets the zoom when it
opens — the box is already captured by then, so nothing is lost, but the view
does return to fit.

Built against **Immich v3.1.0**.

## Changelog

Versions are tagged, and each tag carries a built `.xpi` on its
[release](https://github.com/mmattia09/photo-names/releases).

### 1.3.1

The changelog itself. No code changed.

### 1.3.0

- **X** turns quick add on and off, replacing **A**. `a` is Immich's own *next
  photo*: the check that had cleared it only watched for non-GET requests, and
  stepping between photos is a client-side route change that makes none. Every
  key is now checked against the address bar as well as the network.
- **C** puts the caret in the description, **V** fills the names in first, **R**
  dismisses Immich's notifications.
- **Backspace** asks before trashing. Immich's own Delete trashes on the spot and
  this version has no preference to add a confirmation, so the question is a
  dialog built from Immich's utility classes; Enter presses Immich's trash button,
  leaving the trashing, the step to the next photo and the notification to Immich.
- The two key handlers became one, so precedence is written down rather than
  implied: our dialog, then the tag flow, then Escape, then the letters.

### 1.2.0

- **Enter** runs the tag flow — top match, then confirm — where Immich left it
  doing nothing at either step. Claimed only while Immich's tagging canvas is
  mounted, so no other confirm in the app loses the key.
- Holding **⌥** while drawing moves the box at its current size instead of
  resizing it.
- [`test/`](test) arrives: both scripts run in a `vm` with enough DOM stubbed to
  drive their own listeners. CI runs it.

### 1.1.0

- **Quick add**: two clicks mark the corners of a face and Immich's picker opens
  on that box. The box is carried to `src/page.js` and swapped into the outgoing
  `POST /api/faces`, because Immich's own box lives on a Fabric.js canvas sealed
  inside a Svelte component.
- Fixed the media lookup for the zoomed rendition — Immich swaps the `<img>` from
  `size=preview` to `size=fullsize` on zoom, which the old selector missed.
- Both buttons carry Immich's own tooltip instead of a native `title`.

Built but never tagged; 1.2.0 is the first release that includes it.

### 1.0.0

The description button: fills the field with the people on the photo as
`mario-rossi+anna-verdi_`, leaves the caret at the end, and lets Immich do the
saving.

## Development

```bash
npm install
npm run lint    # web-ext lint
npm test        # the geometry and the key handling, in node, no browser
npm start       # a scratch Firefox profile with the extension loaded
npm run build   # package into web-ext-artifacts/
npm run sign    # same, signed by Mozilla (unlisted); needs WEB_EXT_API_* set
```

The extension is a handful of small files under [`src/`](src): a background
script that registers and unregisters the content scripts, the content script
itself, a page-world script holding the one `fetch` patch, and the options page.

[`test/`](test) runs the two scripts the way the page does — the real files in a
`vm` with just enough DOM stubbed to drive their own listeners — and asserts on
the box they would send and the buttons they would press. No browser, no
dependencies.

`src/page.js` is registered with `world: "MAIN"` — it has to be the page's own
`fetch` that gets replaced, which an isolated content script cannot reach. That
is also why the minimum is Firefox 128.

## License

[MIT](LICENSE)
