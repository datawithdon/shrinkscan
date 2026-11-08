// "Sibling" products: the same brand and category under a different barcode.
// GS1 rules require a new GTIN when the declared net contents change, so a
// shrunk package usually appears in Open Food Facts as a *new* product while
// the old, bigger one keeps its own entry. Matching on brand + category + a
// similar name finds those pairs; per-barcode history alone would miss them.

import { pct, sameSize, sizeOf } from "./units.js";

// Canadian grocery store brands, grouped by the retailer that owns them.
export const STORE_BRANDS = {
  "president-s-choice": "Loblaw", "pc-organics": "Loblaw", "pc-blue-menu": "Loblaw", "no-name": "Loblaw",
  "life-smart": "Shoppers Drug Mart",
  compliments: "Sobeys", "sensations-by-compliments": "Sobeys",
  selection: "Metro", irresistibles: "Metro",
  "great-value": "Walmart",
  "kirkland-signature": "Costco",
};

// Words that carry no product identity: sizes, packaging, bilingual filler.
const STOP = new Set(("a an and the of with in for by au aux avec de des du d en et la le les l sans pour " +
  "pack box bag jar bottle can format family size value new nouveau original originale").split(" "));

export function slug(s) {
  return String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/['’]/g, "-").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export function tokens(name) {
  return new Set(slug(name).split("-").filter((t) => t && !STOP.has(t) && !/^\d/.test(t) && !/^(g|kg|ml|l|oz|lb|x)$/.test(t)));
}

/** Jaccard overlap of two names' tokens, 0..1. */
export function nameSimilarity(a, b) {
  const A = tokens(a), B = tokens(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

/** Best similarity across the names a product has (generic, English, French). */
export function productSimilarity(p, q) {
  let best = 0;
  for (const a of names(p)) for (const b of names(q)) best = Math.max(best, nameSimilarity(a, b));
  return best;
}
const names = (p) => [p.product_name, p.product_name_en, p.product_name_fr].filter((n) => typeof n === "string" && n.trim());

export const brandSlugs = (p) => (Array.isArray(p?.brands_tags) ? p.brands_tags : String(p?.brands || "").split(","))
  .map(slug).filter(Boolean);

/** Deepest category tag (OFF lists them general → specific). */
export function leafCategory(p) {
  const tags = Array.isArray(p?.categories_tags) ? p.categories_tags.filter((t) => typeof t === "string" && /^[a-z]{2}:[a-z0-9-]+$/.test(t)) : [];
  return tags.length ? tags[tags.length - 1] : null;
}
export function parentCategory(p) {
  const tags = Array.isArray(p?.categories_tags) ? p.categories_tags.filter((t) => typeof t === "string" && /^[a-z]{2}:[a-z0-9-]+$/.test(t)) : [];
  return tags.length > 1 ? tags[tags.length - 2] : null;
}

const NEAR = 0.75;      // shrinkflation is a few to ~25 percent, not "half the box"
const SIMILAR = 0.6;     // "smooth" vs "crunchy" peanut butter scores 0.5

/**
 * Split same-brand candidates into:
 *  - bigger: a near-identical product up to ~25% bigger → this one may have shrunk
 *  - smaller: a near-identical product up to ~25% smaller → it may be replacing this one
 *  - sizes: other pack sizes of the same thing (family packs, minis)
 */
export function classifySiblings(product, candidates) {
  const mine = sizeOf(product);
  const brands = new Set(brandSlugs(product));
  const out = { bigger: [], smaller: [], sizes: [] };
  if (!mine) return out;
  for (const c of candidates) {
    if (!c || c.code === product.code) continue;
    if (!brandSlugs(c).some((b) => brands.has(b))) continue;
    const size = sizeOf(c);
    if (!size || size.base !== mine.base || sameSize(size, mine)) continue;
    const sim = productSimilarity(product, c);
    if (sim < SIMILAR) continue;
    const row = { code: c.code, name: c.product_name || c.product_name_en || c.product_name_fr || "", size, sim, created: c.created_t ?? null };
    const ratio = mine.amount / size.amount;
    if (ratio < 1 && ratio >= NEAR) out.bigger.push({ ...row, pct: pct(ratio), olderThanThis: older(c, product) });
    else if (ratio > 1 && 1 / ratio >= NEAR) out.smaller.push({ ...row, pct: pct(1 / ratio), olderThanThis: older(c, product) });
    else out.sizes.push(row);
  }
  for (const k of Object.keys(out)) out[k].sort((a, b) => b.sim - a.sim);
  return out;
}

// OFF's created_t is when the barcode was first added to the database, a
// rough proxy for when the package hit shelves.
function older(a, b) {
  if (!Number.isFinite(a.created_t) || !Number.isFinite(b.created_t)) return null;
  return a.created_t < b.created_t;
}

/** Store-brand products in the same category, most similar first. */
export function storeBrandAlternatives(product, candidates, limit = 6) {
  const mine = sizeOf(product);
  const own = new Set(brandSlugs(product));
  const rows = [];
  for (const c of candidates) {
    if (!c || c.code === product.code) continue;
    const b = brandSlugs(c).find((s) => Object.hasOwn(STORE_BRANDS, s));
    if (!b || own.has(b)) continue;
    const size = sizeOf(c);
    const sim = productSimilarity(product, c);
    const sizeFit = mine && size && size.base === mine.base ? 1 - Math.min(1, Math.abs(Math.log(size.amount / mine.amount))) : 0;
    rows.push({ code: c.code, name: c.product_name || c.product_name_en || c.product_name_fr || "", brand: c.brands || b, retailer: STORE_BRANDS[b], size, score: sim * 2 + sizeFit });
  }
  return rows.sort((a, b) => b.score - a.score).slice(0, limit);
}

/** Category to search for same-brand siblings: one level up from the leaf, since leaf tags are applied inconsistently. */
export const siblingCategory = (p) => parentCategory(p) || leafCategory(p);

/**
 * Store-brand alternatives: the leaf category first, widened to its parent
 * when the leaf has fewer than 3 (leaf tags like "creamy peanut butters" are
 * often missing on store-brand entries).
 */
export async function findAlternatives(product, search, limit = 6) {
  const pool = [];
  for (const cat of [leafCategory(product), parentCategory(product)].filter(Boolean)) {
    pool.push(...await search({ categories_tags: cat, countries_tags: "en:canada" }));
    const alts = storeBrandAlternatives(product, dedupe(pool), limit);
    if (alts.length >= 3) return alts;
  }
  return storeBrandAlternatives(product, dedupe(pool), limit);
}
const dedupe = (list) => [...new Map(list.map((p) => [p.code, p])).values()];
