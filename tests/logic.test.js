import assert from "node:assert/strict";
import { test } from "node:test";
import { checkDigitOk, display, expandUpcE, normalize } from "../js/gtin.js";
import { changes, sampleHistory } from "../js/history.js";
import { parseShelfTag } from "../js/shelf.js";
import { classifySiblings, findAlternatives, nameSimilarity, storeBrandAlternatives } from "../js/siblings.js";
import { formatSize, parseQuantity, per100, sameSize, sizeOf } from "../js/units.js";
import { priceCreep, verdict } from "../js/verdict.js";

test("gtin: check digits and OFF code form", () => {
  assert.ok(checkDigitOk("0068100084245"));
  assert.ok(!checkDigitOk("0068100084246"));
  assert.equal(normalize("068100084245"), "0068100084245");          // UPC-A → EAN-13
  assert.equal(normalize("0 68100 08424 5"), "0068100084245");
  assert.equal(normalize("00068100084245"), "0068100084245");        // GTIN-14 padding
  assert.equal(normalize("12345"), null);
  assert.equal(normalize("abc"), null);
  assert.equal(expandUpcE("04252614"), "042100005264");
  assert.equal(normalize("04252614", "upc_e"), "0042100005264");
  assert.equal(display("0068100084245"), "068100084245");
});

test("units: OFF quantity strings", () => {
  assert.deepEqual(parseQuantity("35.3 oz (1 kg)"), { amount: 1000, base: "g" });
  assert.deepEqual(parseQuantity("4 x 125 g"), { amount: 500, base: "g" });
  assert.deepEqual(parseQuantity("150 g (12x 12.5 g)"), { amount: 150, base: "g" });
  assert.deepEqual(parseQuantity("1,5 L"), { amount: 1500, base: "ml" });
  assert.deepEqual(parseQuantity("500mL"), { amount: 500, base: "ml" });
  assert.deepEqual(parseQuantity("300 g ℮"), { amount: 300, base: "g" });
  assert.equal(parseQuantity("13.5oz").amount, 382.72);
  assert.equal(parseQuantity("1"), null);
  assert.equal(parseQuantity("12 large eggs"), null);
  assert.equal(parseQuantity(""), null);
  assert.deepEqual(sizeOf({ product_quantity: "176", quantity: "176g" }), { amount: 176, base: "g" });
  assert.deepEqual(sizeOf({ product_quantity: 0, quantity: "1" }), null);
  assert.ok(sameSize({ amount: 1000.74, base: "g" }, { amount: 1000, base: "g" }));
  assert.ok(!sameSize({ amount: 375, base: "g" }, { amount: 400, base: "g" }));
  assert.equal(formatSize({ amount: 1000, base: "g" }), "1 kg");
  assert.equal(formatSize({ amount: 946, base: "ml" }), "946 mL");
  assert.equal(per100(4.99, { amount: 500, base: "g" }), 0.998);
});

// A fake OFF: the size is 400 g until rev 37, then 375 g.
function fakeRevs(latest, sizeAt, { missing = new Set() } = {}) {
  const calls = [];
  const fetchRev = async (rev) => {
    calls.push(rev);
    if (rev > latest) return null;
    return { rev, t: 1.6e9 + rev * 86400, size: missing.has(rev) ? null : sizeAt(rev) };
  };
  return { fetchRev, calls };
}

test("history: sampling + bisection pins down the change", async () => {
  const { fetchRev, calls } = fakeRevs(120, (r) => ({ amount: r < 37 ? 400 : 375, base: "g" }));
  const { points, fetched } = await sampleHistory(120, fetchRev, { samples: 8, budget: 30 });
  const ev = changes(points);
  assert.equal(ev.length, 1);
  assert.equal(ev[0].kind, "shrink");
  assert.equal(ev[0].fromRev, 36);
  assert.equal(ev[0].toRev, 37);
  assert.equal(ev[0].pct, -6.3);
  assert.equal(fetched, calls.length);
  assert.ok(fetched <= 30);
});

test("history: sizeless revisions and budget limits don't loop", async () => {
  const missing = new Set(Array.from({ length: 40 }, (_, i) => 20 + i));
  const { fetchRev } = fakeRevs(100, (r) => ({ amount: r < 50 ? 400 : 375, base: "g" }), { missing });
  const res = await sampleHistory(100, fetchRev, { samples: 6, budget: 12 });
  assert.equal(res.fetched, 12);
  assert.equal(res.complete, false);
  assert.equal(changes(res.points).filter((e) => e.kind === "shrink").length, 1);
});

test("history: cached snapshots cost nothing", async () => {
  const { fetchRev, calls } = fakeRevs(10, () => ({ amount: 500, base: "g" }));
  const known = Array.from({ length: 10 }, (_, i) => ({ rev: i + 1, t: 1, size: { amount: 500, base: "g" } }));
  const res = await sampleHistory(10, fetchRev, { known });
  assert.equal(calls.length, 0);
  assert.equal(changes(res.points).length, 0);
});

test("history: data fixes and bonus packs aren't shrinkflation", () => {
  const p = (rev, amount, base = "g") => ({ rev, t: rev, size: { amount, base } });
  assert.equal(changes([p(1, 1), p(2, 500)])[0].kind, "fix");               // "1" → 500 g data cleanup
  assert.equal(changes([p(1, 500, "ml"), p(2, 500, "g")])[0].kind, "fix");
  const bonus = changes([p(1, 400), p(2, 480), p(3, 400)]);
  assert.deepEqual(bonus.map((e) => e.kind), ["grow", "revert"]);
  assert.deepEqual(changes([p(1, 400), p(2, 480), p(3, 375)]).map((e) => e.kind), ["grow", "shrink"]);
});

const kraft = { code: "0068100084245", product_name: "Smooth Peanut Butter", brands_tags: ["Kraft"], quantity: "1 kg", created_t: 1600000000 };

test("siblings: bigger same-brand twin flags a possible shrink", () => {
  const cands = [
    { code: "0068100000001", product_name: "Smooth Peanut Butter", brands_tags: ["kraft"], quantity: "1.1 kg", created_t: 1500000000 },
    { code: "0068100000002", product_name: "Smooth Peanut Butter", brands_tags: ["kraft"], quantity: "2 kg" },
    { code: "0068100000003", product_name: "Crunchy Peanut Butter", brands_tags: ["kraft"], quantity: "900 g", created_t: 1700000000 },
    { code: "0068100000004", product_name: "Smooth Peanut Butter", brands_tags: ["skippy"], quantity: "1.1 kg" },
    { code: "0068100000005", product_name: "Peanut Butter Smooth", brands_tags: ["Kraft"], quantity: "950 g", created_t: 1700000000 },
  ];
  const s = classifySiblings(kraft, cands);
  assert.deepEqual(s.bigger.map((b) => b.code), ["0068100000001"]);
  assert.equal(s.bigger[0].olderThanThis, true);
  assert.equal(s.bigger[0].pct, -9.1);
  assert.deepEqual(s.smaller.map((b) => b.code), ["0068100000005"]);   // crunchy isn't the same product
  assert.deepEqual(s.sizes.map((b) => b.code), ["0068100000002"]);
  assert.ok(nameSimilarity("Beurre d'arachide crémeux", "beurre d arachide cremeux") === 1);
});

test("siblings: store-brand alternatives", () => {
  const cands = [
    { code: "0060383007621", product_name: "crunchy peanut butter", brands_tags: ["no-name"], quantity: "1 kg" },
    { code: "0055742348378", product_name: "Smooth peanut butter", brands_tags: ["compliments"], quantity: "1kg" },
    { code: "0068100099999", product_name: "Smooth peanut butter", brands_tags: ["kraft"], quantity: "1kg" },
  ];
  const alts = storeBrandAlternatives(kraft, cands);
  assert.deepEqual(alts.map((a) => a.code), ["0055742348378", "0060383007621"]);
  assert.equal(alts[0].retailer, "Sobeys");
});

test("shelf: Canadian tag layouts", () => {
  let r = parseShelfTag("KRAFT PEANUT BUTTER 1KG\n$6.99\n$0.70 /100 g");
  assert.equal(r.price, 6.99);
  assert.deepEqual(r.unitPrice, { per100: 0.7, base: "g" });
  r = parseShelfTag("BEURRE D'ARACHIDE\n6,99 $\n0,70 $ / 100 g");
  assert.equal(r.price, 6.99);
  assert.equal(r.unitPrice.per100, 0.7);
  r = parseShelfTag("2/$5.00\n$0.56/100g");
  assert.equal(r.price, 2.5);
  assert.equal(r.multi, "2 for $5.00");
  r = parseShelfTag("COFFEE\n8 99\nunit price $13.98/kg");
  assert.equal(r.price, 8.99);
  assert.equal(r.unitPrice.per100, 1.398);
  r = parseShelfTag("JUICE 1.75L\n$3.49\n$1.99 /1L");
  assert.equal(r.price, 3.49);
  assert.deepEqual(r.unitPrice, { per100: 0.199, base: "ml" });
  r = parseShelfTag("$4.49 $3.29", [{ text: "$4.49", height: 20 }, { text: "$3.29", height: 60 }]);
  assert.equal(r.price, 3.29);
  assert.equal(parseShelfTag("no numbers here").price, null);
});

test("verdict: history shrink + same price", () => {
  const ev = [{ kind: "shrink", from: { amount: 400, base: "g" }, to: { amount: 375, base: "g" }, pct: -6.3, t: 1740000000 }];
  const prices = [
    { date: "2024-01-05", price: 4.99, size: { amount: 400, base: "g" } },
    { date: "2025-06-01", price: 4.99, size: { amount: 375, base: "g" } },
  ];
  const v = verdict({ size: { amount: 375, base: "g" }, events: ev, historyChecked: true, siblings: { bigger: [], smaller: [] }, prices });
  assert.equal(v.level, "shrunk");
  assert.match(v.reasons.join(" "), /Same price, less product/);
  assert.match(v.reasons.join(" "), /\+6\.7%/);
});

test("verdict: none / unknown / possible", () => {
  assert.equal(verdict({ size: { amount: 500, base: "g" }, events: [], historyChecked: true, siblings: { bigger: [], smaller: [] }, prices: [] }).level, "none");
  assert.equal(verdict({ size: null, events: [], siblings: {}, prices: [] }).level, "unknown");
  const v = verdict({ size: { amount: 1000, base: "g" }, events: [], siblings: { bigger: [{ code: "1", size: { amount: 1100, base: "g" }, pct: -9.1, olderThanThis: true }], smaller: [] }, prices: [] });
  assert.equal(v.level, "possible");
  assert.match(v.reasons[0], /older 1\.1 kg version/);
});

test("verdict: price creep from your own logs ignores sale prices", () => {
  const size = { amount: 500, base: "g" };
  assert.match(priceCreep([{ date: "2025-01-01", price: 4 }, { date: "2026-01-01", price: 4.5 }], size), /\+12\.5%/);
  assert.equal(priceCreep([{ date: "2025-01-01", price: 4 }, { date: "2026-01-01", price: 5, onSale: true }], size), null);
});

test("siblings: alternatives widen to the parent category when the leaf is thin", async () => {
  const p = { ...kraft, categories_tags: ["en:peanut-butters", "en:creamy-peanut-butters"] };
  const calls = [];
  const search = async (f) => {
    calls.push(f.categories_tags);
    return f.categories_tags === "en:creamy-peanut-butters"
      ? [{ code: "0060383376147", product_name: "Peanut butter", brands_tags: ["no-name"], quantity: "1 kg" }]
      : [{ code: "0060383376147", product_name: "Peanut butter", brands_tags: ["no-name"], quantity: "1 kg" },
         { code: "0055742348378", product_name: "Smooth peanut butter", brands_tags: ["compliments"], quantity: "1kg" },
         { code: "0059749894456", product_name: "Peanut Butter Smooth", brands_tags: ["selection"], quantity: "1 kg" }];
  };
  const alts = await findAlternatives(p, search);
  assert.deepEqual(calls, ["en:creamy-peanut-butters", "en:peanut-butters"]);
  assert.equal(alts.length, 3);
});
