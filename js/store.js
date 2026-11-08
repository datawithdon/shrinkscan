// App state: scanned products, logged prices, the "shrunk" list and settings,
// persisted in localStorage. Everything read back from storage, an imported
// backup or the Open Food Facts API goes through a clean* function that
// rebuilds each record from known fields with type and length checks.

export const STORAGE_KEY = "shrinkscan.v1";
const MAX_PRODUCTS = 3000;
const MAX_PRICES = 10000;

const CODE_RE = /^\d{8}$|^\d{13}$/;
const ID_RE = /^[a-z0-9]{4,40}$/;
const CAT_RE = /^[a-z]{2}:[a-z0-9-]{1,80}$/;

export const str = (v, max = 120) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "");
const num = (v, min = 0, max = 1e6) => (typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? v : null);
const time = (v) => (Number.isInteger(v) && v > 0 && v < 4e9 ? v : null);
const ymd = (v) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) ? v : "");
export const isCode = (v) => typeof v === "string" && CODE_RE.test(v);

let seq = 0;
export const newId = () => `${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export function cleanSize(s) {
  if (!s || typeof s !== "object") return null;
  const amount = num(s.amount, 0.01, 1e6);
  return amount != null && (s.base === "g" || s.base === "ml") ? { amount: Math.round(amount * 100) / 100, base: s.base } : null;
}

/** A product as ShrinkScan keeps it (a subset of the OFF record). */
export function cleanProduct(x) {
  if (!x || typeof x !== "object" || !isCode(x.code)) return null;
  return {
    code: x.code,
    product_name: str(x.product_name, 140),
    product_name_en: str(x.product_name_en, 140),
    product_name_fr: str(x.product_name_fr, 140),
    brands: str(x.brands, 100),
    brands_tags: (Array.isArray(x.brands_tags) ? x.brands_tags : []).map((b) => str(b, 60)).filter(Boolean).slice(0, 8),
    categories_tags: (Array.isArray(x.categories_tags) ? x.categories_tags : []).filter((c) => typeof c === "string" && CAT_RE.test(c)).slice(-12),
    quantity: str(x.quantity, 60),
    product_quantity: num(typeof x.product_quantity === "string" ? Number(x.product_quantity) : x.product_quantity, 0, 1e6),
    product_quantity_unit: ["g", "ml", "kg", "l"].includes(String(x.product_quantity_unit || "").toLowerCase()) ? String(x.product_quantity_unit).toLowerCase() : "",
    rev: Number.isInteger(x.rev) && x.rev > 0 && x.rev < 1e6 ? x.rev : null,
    created_t: time(x.created_t),
    last_modified_t: time(x.last_modified_t),
    countries_tags: (Array.isArray(x.countries_tags) ? x.countries_tags : []).filter((c) => typeof c === "string" && CAT_RE.test(c)).slice(0, 20),
    scannedAt: time(x.scannedAt),
  };
}

export function cleanPrice(x) {
  if (!x || typeof x !== "object" || !isCode(x.code)) return null;
  const price = num(x.price, 0.01, 10000);
  if (price == null || !ymd(x.date)) return null;
  const shelf = x.shelfUnit && typeof x.shelfUnit === "object" && num(x.shelfUnit.per100, 0, 10000) != null && (x.shelfUnit.base === "g" || x.shelfUnit.base === "ml")
    ? { per100: x.shelfUnit.per100, base: x.shelfUnit.base } : null;
  return {
    id: typeof x.id === "string" && ID_RE.test(x.id) ? x.id : newId(),
    code: x.code,
    date: x.date,
    price: Math.round(price * 100) / 100,
    size: cleanSize(x.size),
    shelfUnit: shelf,
    store: str(x.store, 60),
    note: str(x.note, 200),
    onSale: x.onSale === true,
  };
}

export function cleanShrunk(x) {
  if (!x || typeof x !== "object" || !isCode(x.code)) return null;
  return {
    code: x.code,
    addedAt: ymd(x.addedAt) || new Date().toISOString().slice(0, 10),
    reason: str(x.reason, 200),
    compareTo: isCode(x.compareTo) ? x.compareTo : "",
    note: str(x.note, 300),
  };
}

export function cleanSettings(x) {
  const s = x && typeof x === "object" ? x : {};
  return {
    depth: ["quick", "normal", "deep"].includes(s.depth) ? s.depth : "normal",
    lastStore: str(s.lastStore, 60),
  };
}

export function sanitize(raw) {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const products = {};
  const list = Array.isArray(r.products) ? r.products : Object.values(r.products || {});
  for (const p of list.slice(0, MAX_PRODUCTS)) {
    const c = cleanProduct(p);
    if (c) products[c.code] = c;
  }
  const seen = new Set();
  const prices = (Array.isArray(r.prices) ? r.prices : []).slice(0, MAX_PRICES).map(cleanPrice)
    .filter((p) => p && !seen.has(p.id) && seen.add(p.id));
  const shrunkSeen = new Set();
  const shrunk = (Array.isArray(r.shrunk) ? r.shrunk : []).map(cleanShrunk).filter((s) => s && !shrunkSeen.has(s.code) && shrunkSeen.add(s.code)).slice(0, 2000);
  return { version: 1, products, prices, shrunk, settings: cleanSettings(r.settings) };
}

// ------------------------------------------------------------- persistence

export const state = sanitize(null);
const listeners = new Set();

export function load(storage = globalThis.localStorage) {
  let raw = null;
  try { raw = JSON.parse(storage?.getItem(STORAGE_KEY) || "null"); } catch { raw = null; }
  Object.assign(state, sanitize(raw));
}

export function save(storage = globalThis.localStorage) {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify({ ...state, products: Object.values(state.products) }));
    return true;
  } catch {
    return false;
  } finally {
    for (const fn of listeners) fn();
  }
}

export const onChange = (fn) => listeners.add(fn);

export function replaceAll(raw) {
  Object.assign(state, sanitize(raw));
  return save();
}

export const exportState = () => ({ app: "shrinkscan", exportedAt: new Date().toISOString(), ...state, products: Object.values(state.products) });

// ------------------------------------------------------------- records

export function rememberProduct(p, { scanned = false } = {}) {
  const prev = state.products[p?.code];
  const c = cleanProduct({ ...prev, ...p, scannedAt: scanned ? Math.floor(Date.now() / 1000) : prev?.scannedAt });
  if (!c) return null;
  state.products[c.code] = c;
  save();
  return c;
}

export const recentScans = (n = 12) => Object.values(state.products).filter((p) => p.scannedAt).sort((a, b) => b.scannedAt - a.scannedAt).slice(0, n);

export function addPrice(raw) {
  const p = cleanPrice(raw);
  if (!p) return null;
  state.prices.unshift(p);
  if (p.store) state.settings.lastStore = p.store;
  save();
  return p;
}

export function deletePrice(id) {
  state.prices = state.prices.filter((p) => p.id !== id);
  save();
}

export const pricesFor = (code) => state.prices.filter((p) => p.code === code).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
export const knownStores = () => [...new Set(state.prices.map((p) => p.store).filter(Boolean))].slice(0, 50);

export const isShrunk = (code) => state.shrunk.some((s) => s.code === code);
export function addShrunk(raw) {
  const s = cleanShrunk(raw);
  if (!s) return null;
  state.shrunk = [s, ...state.shrunk.filter((x) => x.code !== s.code)];
  save();
  return s;
}
export function removeShrunk(code) {
  state.shrunk = state.shrunk.filter((s) => s.code !== code);
  save();
}

export function setSetting(k, v) {
  state.settings = cleanSettings({ ...state.settings, [k]: v });
  save();
}

export function deleteAll(storage = globalThis.localStorage) {
  Object.assign(state, sanitize(null));
  try { storage?.removeItem(STORAGE_KEY); } catch { /* blocked */ }
  for (const fn of listeners) fn();
}
