// Package sizes: parse Open Food Facts' free-text "quantity" (e.g. "35.3 oz
// (1 kg)", "4 x 125 g", "1,5 L") into grams or millilitres, and compare them.

const MASS = { mg: 0.001, g: 1, gr: 1, gram: 1, grams: 1, grammes: 1, kg: 1000, oz: 28.349523125, lb: 453.59237, lbs: 453.59237 };
const VOL = { ml: 1, cl: 10, dl: 100, l: 1000, litre: 1000, liter: 1000, litres: 1000, liters: 1000, "fl oz": 29.5735295625, floz: 29.5735295625 };
const UNIT_RE = "(fl\\.? ?oz|floz|mg|kg|g|gr|grams?|grammes|oz|lbs?|ml|cl|dl|l|litres?|liters?)";

function unitInfo(u) {
  const k = u.toLowerCase().replace(/\./g, "").replace(/\s+/g, " ");
  if (k === "fl oz" || k === "floz") return { base: "ml", factor: VOL["fl oz"] };
  if (Object.hasOwn(MASS, k)) return { base: "g", factor: MASS[k] };
  if (Object.hasOwn(VOL, k)) return { base: "ml", factor: VOL[k] };
  return null;
}

const toNum = (s) => Number(String(s).replace(",", "."));

/**
 * Parse a quantity string. Metric amounts win over imperial ones when both are
 * printed ("35.3 oz (1 kg)" → 1000 g), and "4 x 125 g" multiplies out.
 * Returns { amount, base: "g" | "ml" } or null.
 */
export function parseQuantity(text) {
  if (typeof text !== "string") return null;
  const s = text.toLowerCase().replace(/℮/g, " ").replace(/\s+/g, " ").trim();
  if (!s) return null;
  const found = [];
  const multi = new RegExp(`(\\d+)\\s*[x×]\\s*(\\d+(?:[.,]\\d+)?)\\s*${UNIT_RE}\\b`, "g");
  let rest = s;
  for (const m of s.matchAll(multi)) {
    const u = unitInfo(m[3]);
    if (u) found.push({ amount: Number(m[1]) * toNum(m[2]) * u.factor, base: u.base, metric: !/oz|lb/.test(m[3]) });
    rest = rest.replace(m[0], " ");
  }
  if (!found.length) {
    const single = new RegExp(`(\\d+(?:[.,]\\d+)?)\\s*${UNIT_RE}(?![a-z])`, "g");
    for (const m of rest.matchAll(single)) {
      const u = unitInfo(m[2]);
      if (u) found.push({ amount: toNum(m[1]) * u.factor, base: u.base, metric: !/oz|lb/.test(m[2]) });
    }
  }
  const pick = found.find((f) => f.metric) || found[0];
  if (!pick || !Number.isFinite(pick.amount) || pick.amount <= 0 || pick.amount > 1e6) return null;
  return { amount: round(pick.amount), base: pick.base };
}

const round = (n) => Math.round(n * 100) / 100;

/**
 * Best size for an OFF product snapshot: the normalised product_quantity +
 * unit when present, otherwise the parsed quantity text.
 */
export function sizeOf(p) {
  if (!p || typeof p !== "object") return null;
  const fromText = parseQuantity(p.quantity);
  const pq = typeof p.product_quantity === "string" ? Number(p.product_quantity) : p.product_quantity;
  if (Number.isFinite(pq) && pq > 0 && pq <= 1e6) {
    const unit = String(p.product_quantity_unit || "").toLowerCase();
    const base = unit === "ml" || unit === "l" ? "ml" : unit === "g" || unit === "kg" ? "g" : fromText?.base;
    if (base) return { amount: round(pq), base };
  }
  return fromText;
}

/** Same unit family and within 0.5% (covers oz → g rounding). */
export function sameSize(a, b) {
  return Boolean(a && b && a.base === b.base && Math.abs(a.amount - b.amount) <= Math.max(a.amount, b.amount) * 0.005);
}

export function formatSize(s) {
  if (!s) return "size unknown";
  if (s.amount >= 1000 && s.amount % 10 === 0) return `${trim(s.amount / 1000)} ${s.base === "g" ? "kg" : "L"}`;
  return `${trim(s.amount)} ${s.base === "g" ? "g" : "mL"}`;
}
const trim = (n) => String(Math.round(n * 100) / 100);

/** Price per 100 g / 100 mL. */
export function per100(price, size) {
  if (!Number.isFinite(price) || !size || !(size.amount > 0)) return null;
  return Math.round((price / size.amount) * 100 * 1000) / 1000;
}

export const per100Label = (size) => (size?.base === "ml" ? "/100 mL" : "/100 g");

/** Percent change for a size ratio, one decimal, halves rounded away from zero (0.9375 → -6.3). */
export function pct(ratio) {
  const x = (ratio - 1) * 1000;
  return (Math.sign(x) * Math.round(Math.abs(x))) / 10;
}
