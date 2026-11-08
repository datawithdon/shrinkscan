import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import vm from "node:vm";

// Run js/worker-guard.js against a fake worker global and check what gets through.
async function guarded() {
  const seen = [];
  class XHR { open(m, u) { seen.push(`xhr ${u}`); } }
  const self = {
    location: new URL("https://datawithdon.github.io/shrinkscan/js/tesseract-worker.js"),
    fetch: async (u) => { seen.push(`fetch ${u}`); return "ok"; },
    importScripts: (...u) => { seen.push(`import ${u.join(",")}`); },
    XMLHttpRequest: XHR,
    WebSocket: class {},
  };
  self.self = self;
  vm.runInNewContext(await readFile(new URL("../js/worker-guard.js", import.meta.url), "utf8"), { self, URL, TypeError, String });
  return { self, seen };
}

test("worker guard: same-origin passes, off-site is blocked", async () => {
  const { self, seen } = await guarded();
  assert.equal(await self.fetch("../vendor/tesseract/lang/eng.traineddata.gz"), "ok");
  await assert.rejects(self.fetch("https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz"), /Blocked/);
  await assert.rejects(self.fetch({ url: "https://evil.example/x" }), /Blocked/);
  self.importScripts("../vendor/tesseract/core/tesseract-core-simd-lstm.wasm.js");
  assert.throws(() => self.importScripts("https://cdn.jsdelivr.net/npm/tesseract.js-core@v7/x.js"), /Blocked/);
  new self.XMLHttpRequest().open("GET", "./ok.json");
  assert.throws(() => new self.XMLHttpRequest().open("GET", "https://evil.example/"), /Blocked/);
  assert.throws(() => new self.WebSocket("wss://evil.example"), /disabled/);
  assert.equal(seen.length, 3);
  assert.ok(seen.every((s) => !s.includes("jsdelivr") && !s.includes("evil")));
});
