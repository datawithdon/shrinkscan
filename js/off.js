// Open Food Facts client. OFF is a volunteer-run open database with published
// rate limits (100 product reads and 10 searches per minute per user), so all
// requests go through two paced queues, results are cached in localStorage,
// and "temporarily unavailable" (503/429) answers are retried with backoff.
// Every response is untrusted and passes through store.js cleaners.

import { cleanProduct, cleanSize } from "./store.js";
import { sizeOf } from "./units.js";

export const API = "https://world.openfoodfacts.org";
const CACHE_KEY = "shrinkscan.cache.v1";
const PRODUCT_FIELDS = "code,product_name,product_name_en,product_name_fr,brands,brands_tags,categories_tags,quantity,product_quantity,product_quantity_unit,rev,created_t,last_modified_t,countries_tags";
const REV_FIELDS = "quantity,product_quantity,product_quantity_unit,last_modified_t";
const SEARCH_FIELDS = "code,product_name,product_name_en,product_name_fr,brands,brands_tags,quantity,product_quantity,product_quantity_unit,created_t";

const HOUR = 3600e3;
const LIMITS = { product: 650, search: 6500 };     // ms between requests
const MAX_SNAPS = 4000, MAX_SEARCHES = 60, MAX_HIST = 500;

export class OffError extends Error {
  constructor(message, kind) { super(message); this.kind = kind; }
}

const sleepReal = (ms) => new Promise((r) => setTimeout(r, ms));

export function createClient({ fetchFn = globalThis.fetch?.bind(globalThis), storage = globalThis.localStorage, sleep = sleepReal, now = () => Date.now() } = {}) {
  const lanes = { product: Promise.resolve(), search: Promise.resolve() };
  const last = { product: -Infinity, search: -Infinity };

  let cache;
  function readCache() {
    if (cache) return cache;
    try { cache = JSON.parse(storage?.getItem(CACHE_KEY) || "null"); } catch { cache = null; }
    if (!cache || typeof cache !== "object") cache = {};
    for (const k of ["snaps", "products", "searches", "hist"]) if (!cache[k] || typeof cache[k] !== "object" || Array.isArray(cache[k])) cache[k] = {};
    return cache;
  }
  function writeCache() {
    const c = readCache();
    trim(c.snaps, MAX_SNAPS); trim(c.searches, MAX_SEARCHES); trim(c.products, MAX_SNAPS / 4); trim(c.hist, MAX_HIST);
    try { storage?.setItem(CACHE_KEY, JSON.stringify(c)); } catch {
      // Quota: drop the bulkiest part and try once more.
      c.searches = {};
      try { storage?.setItem(CACHE_KEY, JSON.stringify(c)); } catch { /* run uncached */ }
    }
  }

  function paced(lane, task) {
    const run = lanes[lane].then(async () => {
      const wait = last[lane] + LIMITS[lane] - now();
      if (wait > 0) await sleep(wait);
      last[lane] = now();
      return task();
    });
    lanes[lane] = run.catch(() => {});
    return run;
  }

  async function getJson(lane, url, { retries = 2 } = {}) {
    for (let attempt = 0; ; attempt++) {
      let res;
      try {
        res = await paced(lane, () => fetchFn(url, { credentials: "omit", referrerPolicy: "no-referrer", headers: { Accept: "application/json" } }));
      } catch {
        // OFF's "busy" 503 page carries no CORS header, so in a browser it
        // surfaces as a network error. Back off as if it were a 503.
        if (attempt < retries) { await sleep((lane === "search" ? 9000 : 2000) * (attempt + 1)); continue; }
        throw new OffError(navigator?.onLine === false ? "You're offline." : "Can't reach Open Food Facts right now (it may be busy). Try again in a minute.", "network");
      }
      if (res.status === 404) return null;
      if ((res.status === 503 || res.status === 429 || res.status === 502) && attempt < retries) {
        await sleep((lane === "search" ? 9000 : 3000) * (attempt + 1));
        continue;
      }
      if (!res.ok) throw new OffError(res.status === 503 || res.status === 429 ? "Open Food Facts is busy. Try again in a minute." : `Open Food Facts answered ${res.status}.`, "busy");
      try { return await res.json(); } catch { throw new OffError("Open Food Facts sent an unreadable answer.", "bad"); }
    }
  }

  /** Current product, or null when OFF doesn't know the barcode. Cached 6 h. */
  async function product(code, { fresh = false } = {}) {
    const c = readCache();
    const hit = c.products[code];
    if (!fresh && hit && now() - hit.at < 6 * HOUR) return hit.p ? cleanProduct(hit.p) : null;
    const data = await getJson("product", `${API}/api/v2/product/${code}.json?fields=${PRODUCT_FIELDS}`);
    const p = data && data.status === 1 && data.product ? cleanProduct({ ...data.product, code }) : null;
    c.products[code] = { at: now(), p };
    writeCache();
    return p;
  }

  /** One historical snapshot: { rev, t, size }. Revisions never change, so they're cached for good. */
  async function revision(code, rev) {
    const c = readCache();
    const key = `${code}@${rev}`;
    if (c.snaps[key]) return { rev, t: c.snaps[key].t ?? null, size: cleanSize(c.snaps[key].s) };
    let data;
    try { data = await getJson("product", `${API}/api/v2/product/${code}.json?rev=${rev}&fields=${REV_FIELDS}`, { retries: 1 }); } catch { return null; }
    if (!data || data.status !== 1 || !data.product) return null;
    const p = cleanProduct({ ...data.product, code });
    const snap = { rev, t: p?.last_modified_t ?? null, size: p ? sizeOf(p) : null };
    c.snaps[key] = { t: snap.t, s: snap.size };
    writeCache();
    return snap;
  }

  /** Cached revision snapshots for a barcode (free inputs to history sampling). */
  function knownRevisions(code) {
    const c = readCache();
    const prefix = `${code}@`;
    return Object.entries(c.snaps).filter(([k]) => k.startsWith(prefix))
      .map(([k, v]) => ({ rev: Number(k.slice(prefix.length)), t: v.t ?? null, size: cleanSize(v.s) }))
      .filter((s) => Number.isInteger(s.rev));
  }

  function saveHistory(code, h) { readCache().hist[code] = { ...h, at: now() }; writeCache(); }
  function cachedHistory(code) { return readCache().hist[code] || null; }

  /** Search with OFF's v2 tag filters, e.g. { brands_tags: "kraft", categories_tags: "en:peanut-butters" }. Cached 24 h. */
  async function search(filters, { pageSize = 100 } = {}) {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(filters).sort()) if (v) q.set(k, v);
    q.set("fields", SEARCH_FIELDS);
    q.set("page_size", String(pageSize));
    q.set("sort_by", "popularity_key");
    const key = q.toString();
    const c = readCache();
    const hit = c.searches[key];
    if (hit && now() - hit.at < 24 * HOUR && Array.isArray(hit.products)) return hit.products.map(cleanProduct).filter(Boolean);
    const data = await getJson("search", `${API}/api/v2/search?${key}`);
    const products = (Array.isArray(data?.products) ? data.products.slice(0, 200) : []).map(cleanProduct).filter(Boolean);
    c.searches[key] = { at: now(), products };
    writeCache();
    return products;
  }

  function clearCache() {
    cache = {};
    try { storage?.removeItem(CACHE_KEY); } catch { /* blocked */ }
  }

  return { product, revision, knownRevisions, search, saveHistory, cachedHistory, clearCache };
}

// Keep the newest entries of a cache bucket (insertion order ≈ age).
function trim(obj, max) {
  const keys = Object.keys(obj);
  for (let i = 0; i < keys.length - max; i++) delete obj[keys[i]];
}

export const off = createClient();
