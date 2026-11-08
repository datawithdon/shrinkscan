// The answer in the aisle: did this product shrink? Combines three kinds of
// evidence, strongest first:
//  1. OFF edit history of this barcode showing a smaller size ("shrunk")
//  2. a near-identical same-brand product that's bigger ("possible")
//  3. your own price log: price per 100 g went up ("price creep")

import { formatSize, per100, sameSize } from "./units.js";

const SAME_PRICE = 0.03;    // within 3% counts as "the same price"

/**
 * @param {{size:object|null, events:object[], historyChecked:boolean, siblings:{bigger:object[],smaller:object[]}, prices:object[], siblingPrices:Record<string,object[]>}} e
 * @returns {{level:"shrunk"|"possible"|"watch"|"none"|"unknown", title:string, reasons:string[]}}
 */
export function verdict(e) {
  const reasons = [];
  let level = e.size ? "none" : "unknown";
  const bump = (l) => { if (rank(l) > rank(level)) level = l; };

  const shrinks = (e.events || []).filter((ev) => ev.kind === "shrink");
  for (const ev of shrinks) {
    bump("shrunk");
    const when = ev.t ? ` around ${monthYear(ev.t)}` : "";
    reasons.push(`Open Food Facts edits show this barcode going from ${formatSize(ev.from)} to ${formatSize(ev.to)} (${ev.pct}%)${when}.`);
    const same = samePriceAcross(e.prices, ev.from, ev.to);
    if (same) reasons.push(same);
  }

  for (const b of (e.siblings?.bigger || []).slice(0, 3)) {
    bump("possible");
    const age = b.olderThanThis === true ? "an older" : "a";
    reasons.push(`There's ${age} ${formatSize(b.size)} version of this product (barcode ${b.code}). This one is ${b.pct}% smaller.`);
    const theirs = latest(e.siblingPrices?.[b.code]);
    const mine = latest(e.prices);
    if (theirs && mine && e.size) {
      const a = per100(theirs.price, theirs.size || b.size), c = per100(mine.price, mine.size || e.size);
      if (a && c) {
        const same = Math.abs(mine.price - theirs.price) <= theirs.price * SAME_PRICE;
        reasons.push(`${same ? "Same price, less product: " : ""}you logged $${theirs.price.toFixed(2)} for the ${formatSize(theirs.size || b.size)} and $${mine.price.toFixed(2)} for this one. That's ${pctChange(a, c)} per 100.`);
        if (same) bump("shrunk");
      }
    }
  }

  for (const s of (e.siblings?.smaller || []).slice(0, 2)) {
    bump("watch");
    reasons.push(`A ${formatSize(s.size)} version also exists (barcode ${s.code}, ${s.pct}%). ${s.olderThanThis === false ? "It was added more recently, so it may be replacing this one." : "Check which one is on the shelf."}`);
  }

  const creep = priceCreep(e.prices, e.size);
  if (creep) { bump("watch"); reasons.push(creep); }

  if (level === "none") {
    reasons.push(e.historyChecked
      ? `No size drop in the Open Food Facts history${e.firstSeen ? ` since ${monthYear(e.firstSeen)}` : ""}, and no bigger same-brand version found.`
      : "No bigger same-brand version found. The size history hasn't been checked yet.");
  }
  if (level === "unknown") reasons.push("Open Food Facts has no package size for this barcode, so changes can't be checked. Adding the size on openfoodfacts.org helps everyone.");

  return { level, title: TITLES[level], reasons };
}

const TITLES = {
  shrunk: "Shrunk",
  possible: "Possibly shrunk",
  watch: "Worth watching",
  none: "No shrink found",
  unknown: "Can't tell",
};
const ORDER = ["unknown", "none", "watch", "possible", "shrunk"];
const rank = (l) => ORDER.indexOf(l);

const latest = (list) => (Array.isArray(list) && list.length ? [...list].sort((a, b) => (a.date < b.date ? 1 : -1))[0] : null);

/** If you logged prices before and after a size change and they match, say so. */
function samePriceAcross(prices, from, to) {
  const before = latest((prices || []).filter((p) => sameSize(p.size, from)));
  const after = latest((prices || []).filter((p) => sameSize(p.size, to)));
  if (!before || !after) return null;
  const same = Math.abs(after.price - before.price) <= before.price * SAME_PRICE;
  return `${same ? "Same price, less product: " : ""}you paid $${before.price.toFixed(2)} for ${formatSize(from)} and $${after.price.toFixed(2)} for ${formatSize(to)} (${pctChange(per100(before.price, from), per100(after.price, to))} per 100).`;
}

/** Your own logs of this barcode: per-100 price up 5%+ between the oldest and newest regular-price entries. */
export function priceCreep(prices, size) {
  const regular = (prices || []).filter((p) => !p.onSale && (p.size || size)).sort((a, b) => (a.date < b.date ? -1 : 1));
  if (regular.length < 2) return null;
  const first = regular[0], last = regular[regular.length - 1];
  const a = per100(first.price, first.size || size), b = per100(last.price, last.size || size);
  if (!a || !b || b < a * 1.05) return null;
  return `Your logs: ${pctChange(a, b)} per 100 between ${first.date} and ${last.date} (regular prices).`;
}

export function pctChange(a, b) {
  if (!a || !b) return "—";
  const p = Math.round(((b - a) / a) * 1000) / 10;
  return `${p > 0 ? "+" : ""}${p}%`;
}

export function monthYear(t) {
  return new Date(t * 1000).toLocaleDateString("en-CA", { month: "short", year: "numeric", timeZone: "UTC" });
}
