// Read a Canadian shelf tag from OCR text: the selling price and the printed
// unit price ("$0.80 /100 g", "0,80 $ / 100 g", "$8.00/kg"). Bilingual tags
// and the big-dollars-small-cents layout ("3 99") are both common.

const MONEY = String.raw`\$?\s*(\d{1,3}(?:[.,]\d{2,3}))\s*\$?`;
const PER = String.raw`(?:\/|per|par|pour|le|la)\s*`;
const UNIT = String.raw`(100\s*(?:g|gr|ml)|1?\s*kg|1?\s*l(?![a-z])|1?\s*lb|ea|each|un|unit[eé]?)`;
const UNIT_PRICE_RE = new RegExp(`${MONEY}\\s*${PER}${UNIT}`, "gi");

const toNum = (s) => Number(String(s).replace(",", "."));

/** Convert a printed unit price to price per 100 g / 100 mL (null for "each"). */
export function normaliseUnitPrice(value, unit) {
  const u = unit.toLowerCase().replace(/\s+/g, "");
  if (/^100(g|gr)$/.test(u)) return { per100: value, base: "g" };
  if (u === "100ml") return { per100: value, base: "ml" };
  if (/^1?kg$/.test(u)) return { per100: value / 10, base: "g" };
  if (/^1?l$/.test(u)) return { per100: value / 10, base: "ml" };
  if (/^1?lb$/.test(u)) return { per100: (value / 453.59237) * 100, base: "g" };
  return null;
}

/**
 * @param {string} text OCR output
 * @param {{text:string,height:number}[]} [words] OCR words with box heights;
 *   when given, the tallest price is preferred (the selling price is printed big).
 * @returns {{price:number|null, unitPrice:{per100:number,base:string}|null, multi:string|null, candidates:number[]}}
 */
export function parseShelfTag(text, words = []) {
  const s = String(text || "").replace(/[Oo](?=\d)|(?<=\d)[Oo]/g, "0").replace(/\r/g, "");
  let unitPrice = null;
  const unitSpans = [];
  for (const m of s.matchAll(UNIT_PRICE_RE)) {
    const n = normaliseUnitPrice(toNum(m[1]), m[2]);
    unitSpans.push([m.index, m.index + m[0].length]);
    if (n && !unitPrice) unitPrice = { per100: round(n.per100, 3), base: n.base };
  }
  const outsideUnit = (i) => !unitSpans.some(([a, b]) => i >= a && i < b);

  // Multi-buy: "2/$5", "2 for $5.00", "2 pour 5 $"
  const multiRe = /(\d{1,2})\s*(?:\/|for|pour)\s*\$?\s*(\d{1,3}(?:[.,]\d{2})?)\s*\$?/gi;
  for (const m of s.matchAll(multiRe)) {
    const qty = Number(m[1]), total = toNum(m[2]);
    if (outsideUnit(m.index) && qty >= 2 && total > 0 && /\$|for|pour/i.test(m[0])) {
      return { price: round(total / qty, 2), unitPrice, multi: `${qty} for $${total.toFixed(2)}`, candidates: [round(total / qty, 2)] };
    }
  }

  const candidates = [];
  for (const m of s.matchAll(/\$\s*(\d{1,3}[.,]\d{2})(?!\d)|(?<![\d.,])(\d{1,3}[.,]\d{2})\s*\$|(?<![\d.,])(\d{1,3}[.,]\d{2})(?![\d%])/g)) {
    if (!outsideUnit(m.index)) continue;
    const v = toNum(m[1] || m[2] || m[3]);
    if (v > 0 && v < 1000) candidates.push({ v, dollar: Boolean(m[1] || m[2]), i: m.index });
  }
  // Big dollars + small cents on their own line: "3 99" or "399" with a ¢-less tag.
  for (const m of s.matchAll(/^\s*\$?\s*(\d{1,2})\s+(\d{2})\s*$/gm)) {
    if (outsideUnit(m.index)) candidates.push({ v: Number(`${m[1]}.${m[2]}`), dollar: true, i: m.index, big: true });
  }

  let price = null;
  if (words.length && candidates.length) {
    const tall = [...words].filter((w) => /\d/.test(w.text)).sort((a, b) => b.height - a.height)[0];
    if (tall) {
      const digits = tall.text.replace(/\D/g, "");
      const hit = candidates.find((c) => c.v.toFixed(2).replace(/\D/g, "").includes(digits) || digits.includes(c.v.toFixed(2).replace(/\D/g, "")));
      if (hit) price = hit.v;
    }
  }
  if (price == null) {
    const pick = candidates.find((c) => c.big) || candidates.find((c) => c.dollar) || candidates[0];
    price = pick ? pick.v : null;
  }
  return { price, unitPrice, multi: null, candidates: [...new Set(candidates.map((c) => c.v))] };
}

const round = (n, d) => Math.round(n * 10 ** d) / 10 ** d;
