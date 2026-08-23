// src/content.js — quick add, its keys and its geometry
//
// No browser and no dependencies: the file is run in a vm with just enough DOM
// stubbed to drive its own listeners, and the assertions are on what it would
// have sent or drawn. Run from the repo root with `npm test`.

import fs from "node:fs";
import vm from "node:vm";

const frames = [];
const clicked = [];
const blurred = [];

function el(props = {}) {
  const node = {
    className: "", dataset: {}, style: {}, tagName: "DIV", textContent: "",
    isConnected: true, offsetParent: {}, _on: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    setAttribute() {}, getAttribute: () => null,
    addEventListener(type, fn) { (this._on[type] ||= []).push(fn); },
    remove() {}, appendChild() {}, insertBefore() {}, append() {},
    focus() {}, blur() { blurred.push(props.name || "?"); }, setSelectionRange() {},
    querySelector: () => null, querySelectorAll: () => [], closest: () => null,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0 }),
    click() { clicked.push(props.name || "?"); },
  };
  return Object.assign(node, props);
}

// Photo 1920x1440 drawn at 480x360 from (100,50): a zoomed, panned frame.
const image = el({
  naturalWidth: 1920, naturalHeight: 1440,
  getBoundingClientRect: () => ({ left: 100, top: 50, width: 480, height: 360 }),
  getAttribute: (a) => (a === "src" ? "/api/assets/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee/thumbnail?size=fullsize" : null),
});

const plusPath = el({ getAttribute: (a) => (a === "d" ? "M19,13H13V19H11V13H5V11H11V5H13V11H19V13Z" : null) });
let toggleButton = null;
const plusButton = el({
  name: "immich-plus",
  querySelector: (s) => (s === "svg path" ? plusPath : null),
});
plusButton.parentElement = el({ querySelector: () => null, insertBefore: (n) => { toggleButton = n; } });

const trashBtn = el({ name: "trash", querySelector: (s) => (s === "svg path" ? el({ getAttribute: (a) => (a === "d" ? "M6,19A2,2 0 0,0 8,21H16A2,2 0 0,0 18,19V7H6V19M8,9H16V19H8V9M15.5,4L14.5,3H9.5L8.5,4H5V6H19V4H15.5Z" : null) }) : null) });
let descriptionFocused = false;
const descriptionField = el({ name: "description", value: "abc", focus: () => { descriptionFocused = true; } });
const fillBtn = el({ name: "fill" });
const toastClose = el({ name: "toast-close" });
const toastCard = el({ querySelector: () => toastClose });
const toastStack = el({ children: [toastCard] });
const state = { canvas: false, confirmBtn: null, personBtn: null, description: true, toasts: true };
const documentElement = { dataset: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false } };
const docOn = {};

const document = {
  documentElement, body: { appendChild() {}, dataset: {} }, activeElement: null,
  addEventListener: (t, fn) => { (docOn[t] ||= []).push(fn); },
  removeEventListener() {}, createElement: () => el(),
  getElementById: (id) =>
    id === "immich-asset-viewer"
      ? el({ querySelector: () => null, querySelectorAll: () => [trashBtn] })
      : null,
  querySelector: (sel) => {
    if (sel.includes("canvas-container")) return state.canvas ? el() : null;
    if (sel.includes('role="dialog"')) return state.confirmBtn ? el({ querySelectorAll: () => [state.confirmBtn] }) : null;
    if (sel.includes("autogrow-textarea")) return state.description ? descriptionField : null;
    if (sel.includes("photo-names-button")) return fillBtn;
    if (sel.includes("z-60")) return state.toasts ? toastStack : null;
    return null;
  },
  querySelectorAll: (sel) => {
    if (sel.includes("img[src*=")) return [image];
    if (sel === "#detail-panel button") return [plusButton];
    if (sel === "button") return state.personBtn ? [state.personBtn] : [];
    if (sel.includes("photo-names-quick-toggle")) return toggleButton ? [toggleButton] : [];
    return [];
  },
};

const sandbox = {
  document, JSON, Math, console, RegExp, Object, Array, String, Number, Error,
  URL, URLSearchParams,
  location: { origin: "http://x", search: "", pathname: "/photos/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee" },
  requestAnimationFrame: (cb) => { frames.push(cb); return frames.length; },
  cancelAnimationFrame: () => {},
  setTimeout: () => 0, clearTimeout: () => {},
  MutationObserver: class { observe() {} },
  browser: { storage: { local: { get: async () => ({}) } } },
  fetch: async () => ({ ok: true, json: async () => ({}) }),
  Event: class {},
};
sandbox.window = sandbox;
sandbox.window.addEventListener = () => {};
sandbox.window.innerWidth = 1200;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync("src/content.js", "utf8"), sandbox);

const drain = (n = 1) => { for (let i = 0; i < n && frames.length; i++) frames.shift()(); };
const fire = (t, ev) => (docOn[t] || []).forEach((fn) => fn(ev));
const mouse = (x, y, alt = false) => ({ clientX: x, clientY: y, altKey: alt, target: { closest: () => null }, preventDefault() {}, stopPropagation() {} });
const kb = (k, extra = {}) => ({ key: k, preventDefault() {}, stopPropagation() {}, ...extra });
const cx = (ix) => 100 + (ix / 1920) * 480;
const cy = (iy) => 50 + (iy / 1440) * 360;
const rect = () => (documentElement.dataset.photoNamesRect ? JSON.parse(documentElement.dataset.photoNamesRect) : null);
const reset = () => { delete documentElement.dataset.photoNamesRect; clicked.length = 0; };

let ok = true;
const check = (cond, msg, got) => { console.log(`${cond ? "  ok  " : "  FAIL"}  ${msg}${cond ? "" : "  -> " + JSON.stringify(got)}`); if (!cond) ok = false; };

drain(3);
check(!!toggleButton, "toggle button attached beside Immich's");
toggleButton._on.click[0]({ preventDefault() {}, stopPropagation() {} });   // quick add ON

console.log("\n1. plain two-corner drag");
reset();
fire("click", mouse(cx(400), cy(300)));
fire("mousemove", mouse(cx(500), cy(400)));
fire("click", mouse(cx(500), cy(400)));
check(JSON.stringify(rect()) === JSON.stringify({ x: 400, y: 300, width: 100, height: 100, imageWidth: 1920, imageHeight: 1440 }), "box is the two corners", rect());
check(clicked.includes("immich-plus"), "Immich's tag button was pressed", clicked);

console.log("\n2. Option holds the size and moves the box");
reset();
fire("keydown", kb("Escape"));
fire("click", mouse(cx(400), cy(300)));
fire("mousemove", mouse(cx(500), cy(400)));            // 100x100 box at 400,300
fire("mousemove", mouse(cx(500), cy(400), true));      // Option down: grab it here
fire("mousemove", mouse(cx(700), cy(600), true));      // move by +200,+200
fire("click", mouse(cx(700), cy(600), true));
check(JSON.stringify(rect()) === JSON.stringify({ x: 600, y: 500, width: 100, height: 100, imageWidth: 1920, imageHeight: 1440 }), "same size, moved by the same delta", rect());

console.log("\n3. releasing Option resizes again from the far corner");
reset();
fire("keydown", kb("Escape"));
fire("click", mouse(cx(400), cy(300)));
fire("mousemove", mouse(cx(500), cy(400)));
fire("mousemove", mouse(cx(500), cy(400), true));
fire("mousemove", mouse(cx(600), cy(500), true));      // box now 500,400 100x100, pointer at its corner
fire("mousemove", mouse(cx(650), cy(550)));            // Option released, then dragged out
fire("click", mouse(cx(650), cy(550)));
const r3 = rect();
check(r3 && r3.x === 500 && r3.y === 400 && r3.width === 150 && r3.height === 150, "far corner stayed, pointer took the other", r3);

console.log("\n4. Option-drag cannot push the box off the photo");
reset();
fire("keydown", kb("Escape"));
fire("click", mouse(cx(100), cy(100)));
fire("mousemove", mouse(cx(200), cy(200)));
fire("mousemove", mouse(cx(200), cy(200), true));
fire("mousemove", mouse(cx(-500), cy(-500), true));
fire("click", mouse(cx(-500), cy(-500), true));
const r4 = rect();
check(r4 && r4.x >= 0 && r4.y >= 0 && r4.x + r4.width <= 1920 && r4.y + r4.height <= 1440, "stays on the photo", r4);

console.log("\n5. Enter, gated on the tagging flow");
reset();
state.canvas = false;
state.personBtn = el({ name: "person", querySelector: (s) => (s.includes("/api/people/") ? el() : null) });
fire("keydown", kb("Enter"));
check(clicked.length === 0, "does nothing while tagging is closed", clicked);

state.canvas = true;
fire("keydown", kb("Enter"));
check(clicked.includes("person"), "picks the first person in the picker", clicked);

reset();
state.confirmBtn = el({ name: "confirm", className: "bg-danger text-light", textContent: "Conferma" });
fire("keydown", kb("Enter"));
check(clicked.includes("confirm") && !clicked.includes("person"), "the confirm dialog wins over the list", clicked);

reset();
fire("keydown", kb("Enter", { metaKey: true }));
check(clicked.length === 0, "Cmd+Enter is left alone", clicked);


console.log("\n6. the X shortcut");
reset();
state.canvas = false; state.confirmBtn = null; state.personBtn = null;
const isOn = () => toggleButton.dataset.active === "true";
while (isOn()) fire("keydown", kb("x", { target: { closest: () => null } }));
check(!isOn(), "starts off for this check", toggleButton.dataset.active);
fire("keydown", kb("x", { target: { closest: () => null } }));
check(isOn(), "X turns it on", toggleButton.dataset.active);
fire("keydown", kb("x", { target: { closest: () => null } }));
check(!isOn(), "X turns it off again", toggleButton.dataset.active);

fire("keydown", kb("x", { target: { closest: () => ({ tagName: "INPUT" }) } }));
check(!isOn(), "typing an x in a field does not toggle", toggleButton.dataset.active);

fire("keydown", kb("x", { metaKey: true, target: { closest: () => null } }));
check(!isOn(), "Cmd+X is left alone", toggleButton.dataset.active);

// A is Immich's own "next photo" and must stay Immich's.
fire("keydown", kb("a", { target: { closest: () => null } }));
check(!isOn(), "A is left to Immich", toggleButton.dataset.active);

fire("keydown", kb("x", { target: { closest: () => null } }));
check(isOn(), "on again", toggleButton.dataset.active);
fire("keydown", kb("Escape", { target: { closest: () => null } }));
check(!isOn(), "Escape still leaves the mode", toggleButton.dataset.active);

console.log("\n7. Escape steps out of the description");
let descriptionBlurred = false;
document.activeElement = el({ matches: (sel) => sel.includes("autogrow-textarea"), blur: () => { descriptionBlurred = true; } });
let stopped = false;
fire("keydown", { key: "Escape", target: { closest: () => null }, preventDefault() {}, stopPropagation() { stopped = true; } });
check(descriptionBlurred, "the field is blurred", descriptionBlurred);
check(stopped, "and Immich never sees the key, so the viewer stays open", stopped);
document.activeElement = null;


console.log("\n8. C, V and R");
reset();
state.canvas = false; state.confirmBtn = null;
const noField = { target: { closest: () => null } };

descriptionFocused = false;
fire("keydown", kb("c", noField));
check(descriptionFocused, "C puts the caret in the description", descriptionFocused);

fire("keydown", kb("v", noField));
check(clicked.includes("fill"), "V runs the same fill the button does", clicked);

reset();
fire("keydown", kb("r", noField));
check(clicked.includes("toast-close"), "R closes the notification", clicked);

reset();
descriptionFocused = false;
fire("keydown", kb("c", { target: { closest: () => ({ tagName: "TEXTAREA" }) } }));
fire("keydown", kb("v", { target: { closest: () => ({ tagName: "TEXTAREA" }) } }));
fire("keydown", kb("r", { target: { closest: () => ({ tagName: "TEXTAREA" }) } }));
check(clicked.length === 0 && !descriptionFocused, "none of them fire while typing", { clicked, descriptionFocused });

console.log("\n9. Backspace asks first");
reset();
fire("keydown", kb("Backspace", noField));
check(!clicked.includes("trash"), "Backspace alone deletes nothing", clicked);

fire("keydown", kb("Enter", noField));
check(clicked.includes("trash"), "Enter on the dialog goes through to Immich's own delete", clicked);

reset();
fire("keydown", kb("Backspace", noField));
fire("keydown", kb("Escape", noField));
fire("keydown", kb("Enter", noField));
check(!clicked.includes("trash"), "Escape drops it, and Enter afterwards does nothing", clicked);

reset();
fire("keydown", kb("Backspace", { target: { closest: () => ({ tagName: "TEXTAREA" }) } }));
fire("keydown", kb("Enter", { target: { closest: () => null } }));
check(!clicked.includes("trash"), "Backspace while typing never opens it", clicked);

console.log(ok ? "\nALL PASS" : "\nFAILURES");
process.exit(ok ? 0 : 1);
