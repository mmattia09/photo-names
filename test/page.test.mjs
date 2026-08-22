// src/page.js — the fetch rewrite
//
// No browser and no dependencies: the file is run in a vm with just enough DOM
// stubbed to drive its own listeners, and the assertions are on what it would
// have sent or drawn. Run from the repo root with `npm test`.

import fs from "node:fs";
import vm from "node:vm";

const calls = [];
const dataset = {};
const sandbox = {
  document: { documentElement: { dataset } },
  Response: class {},
  JSON, console,
};
sandbox.window = sandbox;
sandbox.window.fetch = (input, init) => { calls.push({ input, init }); return "ORIGINAL_CALLED"; };

vm.createContext(sandbox);
vm.runInContext(fs.readFileSync("src/page.js", "utf8"), sandbox);

const immichBody = JSON.stringify({
  assetId: "a1", personId: "p1",
  imageWidth: 1920, imageHeight: 1440, x: 564, y: 564, width: 450, height: 450,
});

function run(label, url, init, rect) {
  calls.length = 0;
  if (rect === null) delete dataset.photoNamesRect;
  else dataset.photoNamesRect = rect;
  sandbox.window.fetch(url, init);
  const sent = calls[0] && calls[0].init && calls[0].init.body;
  return { label, sent: sent ? JSON.parse(sent) : sent, datasetAfter: dataset.photoNamesRect ?? null };
}

const rect = JSON.stringify({ x: 1276, y: 706, width: 83, height: 126, imageWidth: 1920, imageHeight: 1440 });

const results = [
  run("rewrites POST /api/faces", "/api/faces", { method: "POST", body: immichBody }, rect),
  run("leaves body alone with no pending rect", "/api/faces", { method: "POST", body: immichBody }, null),
  run("ignores other endpoints", "/api/assets/a1", { method: "PUT", body: '{"description":"x"}' }, rect),
  run("ignores GET /faces?id=", "/api/faces?id=a1", { method: "GET" }, rect),
];

let ok = true;
const r0 = results[0].sent;
const expect = (cond, msg) => { if (!cond) { ok = false; console.log("  FAIL:", msg); } };

expect(r0.x === 1276 && r0.y === 706 && r0.width === 83 && r0.height === 126, "coords swapped in");
expect(r0.assetId === "a1" && r0.personId === "p1", "assetId/personId preserved");
expect(r0.imageWidth === 1920 && r0.imageHeight === 1440, "image space carried over");
expect(results[0].datasetAfter === null, "rect consumed once");
expect(results[1].sent.x === 564, "untouched without a pending rect");
expect(results[2].sent.description === "x" && results[2].datasetAfter !== null, "description PUT untouched");
expect(results[3].datasetAfter !== null, "GET /faces untouched");

console.log(JSON.stringify(results, null, 1));
console.log(ok ? "\nALL PASS" : "\nFAILURES");
process.exit(ok ? 0 : 1);
