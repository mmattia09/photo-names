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
- **Quick add** — a toggle next to Immich's own tag buttons. With it on, two
  clicks mark the opposite corners of a face and Immich's picker opens on that
  box, so tagging a group photo is click, click, name — over and over, without
  dragging a rectangle each time. Escape backs out.
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

Opening the picker is Immich's own button, and Immich resets the zoom when it
opens — the box is already captured by then, so nothing is lost, but the view
does return to fit.

Built against **Immich v3.1.0**.

## Development

```bash
npm install
npm run lint    # web-ext lint
npm start       # a scratch Firefox profile with the extension loaded
npm run build   # package into web-ext-artifacts/
npm run sign    # same, signed by Mozilla (unlisted); needs WEB_EXT_API_* set
```

The extension is a handful of small files under [`src/`](src): a background
script that registers and unregisters the content scripts, the content script
itself, a page-world script holding the one `fetch` patch, and the options page.

`src/page.js` is registered with `world: "MAIN"` — it has to be the page's own
`fetch` that gets replaced, which an isolated content script cannot reach. That
is also why the minimum is Firefox 128.

## License

[MIT](LICENSE)
