import assert from "node:assert/strict";
import { test } from "node:test";
import { createClient } from "../js/off.js";
import { addPrice, addShrunk, cleanProduct, load, replaceAll, sanitize, save, state, STORAGE_KEY } from "../js/store.js";

class Mem {
  constructor() { this.m = new Map(); }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { this.m.set(k, String(v)); }
  removeItem(k) { this.m.delete(k); }
}

test("store: sanitize drops junk and keeps good records", () => {
  const s = sanitize({
    products: [{ code: "0068100084245", product_name: "PB\u0000<b>", rev: 3, image: "javascript:alert(1)" }, { code: "nope" }],
    prices: [{ code: "0068100084245", date: "2026-11-01", price: 4.99, size: { amount: 1000, base: "g" } }, { code: "0068100084245", date: "bad", price: 1 }, { code: "0068100084245", date: "2026-11-01", price: -2 }],
    shrunk: [{ code: "0068100084245" }, { code: "0068100084245" }, { code: "x" }],
    settings: { depth: "warp" },
  });
  assert.deepEqual(Object.keys(s.products), ["0068100084245"]);
  assert.equal(s.products["0068100084245"].product_name, "PB <b>");
  assert.equal(s.products["0068100084245"].image, undefined);
  assert.equal(s.prices.length, 1);
  assert.equal(s.shrunk.length, 1);
  assert.equal(s.settings.depth, "normal");
  assert.equal(sanitize("garbage").prices.length, 0);
});

test("store: product records never keep remote image URLs", () => {
  const p = cleanProduct({ code: "0068100084245", image: "https://images.openfoodfacts.org/x.jpg", image_front_small_url: "https://images.openfoodfacts.org/y.jpg" });
  assert.equal(JSON.stringify(p).includes("http"), false);
});

test("store: round trip through storage", () => {
  const mem = new Mem();
  replaceAll(null);
  addPrice({ code: "0068100084245", date: "2026-11-01", price: 4.99 });
  addShrunk({ code: "0068100084245", reason: "test" });
  save(mem);
  replaceAll(null);
  load(mem);
  assert.equal(state.prices.length, 1);
  assert.equal(state.shrunk[0].reason, "test");
  assert.equal(state.settings.lastStore, "");
  mem.setItem(STORAGE_KEY, "{not json");
  load(mem);
  assert.equal(state.prices.length, 0);
});

function fakeFetch(routes) {
  const calls = [];
  const fn = async (url) => {
    calls.push(url);
    const r = routes.shift();
    if (r instanceof Error) throw r;
    return { status: r.status ?? 200, ok: (r.status ?? 200) < 400, json: async () => r.body };
  };
  return { fn, calls };
}

test("off: product fetch is cleaned and cached", async () => {
  const { fn, calls } = fakeFetch([{ body: { status: 1, product: { product_name: "PB", quantity: "1kg", rev: 286, image_front_small_url: "https://images.openfoodfacts.org/images/products/006/810/008/4245/front_en.3.200.jpg" } } }]);
  const c = createClient({ fetchFn: fn, storage: new Mem(), sleep: async () => {} });
  const p = await c.product("0068100084245");
  assert.equal(p.rev, 286);
  assert.equal(p.image, undefined);
  assert.doesNotMatch(calls[0], /image/);
  await c.product("0068100084245");
  assert.equal(calls.length, 1);
  assert.match(calls[0], /^https:\/\/world\.openfoodfacts\.org\/api\/v2\/product\/0068100084245\.json\?fields=/);
});

test("off: 503 is retried, unknown barcode is null, revisions cache forever", async () => {
  const { fn, calls } = fakeFetch([
    { status: 503 }, { body: { status: 0 } },
    { body: { status: 1, product: { quantity: "400 g", last_modified_t: 1700000000 } } },
  ]);
  const waits = [];
  const c = createClient({ fetchFn: fn, storage: new Mem(), sleep: async (ms) => { waits.push(ms); } });
  assert.equal(await c.product("0068100084245"), null);
  assert.ok(waits.includes(3000));
  const snap = await c.revision("0068100084245", 5);
  assert.deepEqual(snap, { rev: 5, t: 1700000000, size: { amount: 400, base: "g" } });
  assert.deepEqual(await c.revision("0068100084245", 5), snap);
  assert.equal(calls.length, 3);
  assert.equal(c.knownRevisions("0068100084245").length, 1);
});

test("off: search keeps going after a busy answer and gives a clear error", async () => {
  const { fn } = fakeFetch([{ status: 503 }, { status: 503 }, { status: 503 }]);
  const c = createClient({ fetchFn: fn, storage: new Mem(), sleep: async () => {} });
  await assert.rejects(c.search({ brands_tags: "kraft" }), /busy/);
});

test("off: requests are paced per lane", async () => {
  let t = 0;
  const waits = [];
  const { fn } = fakeFetch([{ body: { status: 1, product: {} } }, { body: { status: 1, product: {} } }]);
  const c = createClient({ fetchFn: fn, storage: new Mem(), now: () => t, sleep: async (ms) => { waits.push(ms); t += ms; } });
  await Promise.all([c.revision("0068100084245", 1), c.revision("0068100084245", 2)]);
  assert.deepEqual(waits, [650]);
});

test("off: cleanProduct ignores hostile fields", () => {
  const p = cleanProduct({ code: "0068100084245", categories_tags: ["en:peanut-butters", "<script>"], brands_tags: [{}, "Kraft"] });
  assert.deepEqual(p.categories_tags, ["en:peanut-butters"]);
  assert.deepEqual(p.brands_tags, ["Kraft"]);
});
