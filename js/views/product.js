// Product page: the verdict, then the evidence behind it: OFF size history,
// same-brand size twins, your logged prices and store-brand alternatives.

import { $, h, money, mount, toast } from "../dom.js";
import { display } from "../gtin.js";
import { DEFAULT_BUDGET, DEFAULT_SAMPLES, changes, sampleHistory } from "../history.js";
import { off } from "../off.js";
import { classifySiblings, findAlternatives, siblingCategory, slug } from "../siblings.js";
import { addShrunk, deletePrice, isShrunk, isCode, pricesFor, rememberProduct, removeShrunk, state } from "../store.js";
import { productName, productRow, thumb, verdictBanner } from "../ui.js";
import { formatSize, per100, per100Label, sizeOf } from "../units.js";
import { monthYear, verdict } from "../verdict.js";
import { openLogPrice } from "./logprice.js";

const DEPTH = { quick: { samples: 5, budget: 8 }, normal: { samples: DEFAULT_SAMPLES, budget: DEFAULT_BUDGET }, deep: { samples: 12, budget: 40 } };

let token = 0;

export async function render(root, params, code) {
  const my = ++token;
  const live = () => my === token;
  if (!isCode(code)) { mount(root, h("p", { class: "empty" }, "That isn't a valid barcode."), h("a", { class: "btn", href: "#/scan" }, "Scan again")); return; }

  const ev = { size: null, events: [], historyChecked: false, siblings: { bigger: [], smaller: [] }, prices: pricesFor(code), siblingPrices: {} };
  const slots = {
    head: h("div", { class: "product-head" }),
    verdict: h("div", {}, verdictBanner({ level: "checking", title: "Checking…", reasons: [] })),
    actions: h("div", { class: "row" }),
    prices: h("section", { class: "panel" }),
    history: h("section", { class: "panel" }),
    siblings: h("section", { class: "panel" }),
    alts: h("section", { class: "panel" }),
  };
  mount(root, h("div", { class: "stack" }, slots.head, slots.verdict, slots.actions, slots.prices, slots.history, slots.siblings, slots.alts));

  let product = state.products[code] || null;
  if (product) drawHead(slots.head, product);
  else mount(slots.head, h("p", { class: "muted" }, `Looking up ${display(code)}…`));

  try {
    const fresh = await off.product(code);
    if (!live()) return;
    if (fresh) product = rememberProduct(fresh, { scanned: params.get("scan") === "1" });
  } catch (e) {
    if (!live()) return;
    if (!product) { drawError(root, code, e.message); return; }
    toast(`${e.message} Showing what was saved earlier.`);
  }
  if (!product) { drawMissing(root, code); return; }

  ev.size = sizeOf(product);
  drawHead(slots.head, product);
  const redraw = () => { if (live()) mount(slots.verdict, verdictBanner(verdict(ev))); };
  const refreshPrices = () => {
    ev.prices = pricesFor(code);
    for (const k of Object.keys(ev.siblingPrices)) ev.siblingPrices[k] = pricesFor(k);
    drawPrices(slots.prices, product, ev.prices, refreshPrices);
    redraw();
  };
  drawActions(slots.actions, product, refreshPrices);
  drawPrices(slots.prices, product, ev.prices, refreshPrices);
  redraw();

  // Siblings first (one search), then the revision walk (many small reads).
  mount(slots.siblings, h("h2", {}, "Same brand, other sizes"), h("p", { class: "muted" }, "Searching Open Food Facts…"));
  const brand = slug(product.brands_tags[0] || product.brands.split(",")[0] || "");
  const cat = siblingCategory(product);
  if (brand && cat) {
    try {
      const cands = await off.search({ brands_tags: brand, categories_tags: cat, countries_tags: "en:canada" });
      if (!live()) return;
      ev.siblings = classifySiblings(product, cands);
      for (const s of [...ev.siblings.bigger, ...ev.siblings.smaller]) ev.siblingPrices[s.code] = pricesFor(s.code);
      drawSiblings(slots.siblings, ev.siblings);
      redraw();
    } catch (e) {
      if (!live()) return;
      mount(slots.siblings, h("h2", {}, "Same brand, other sizes"), h("p", { class: "error" }, e.message), h("button", { class: "btn small", type: "button", onclick: () => render(root, params, code) }, "Retry"));
    }
  } else {
    mount(slots.siblings, h("h2", {}, "Same brand, other sizes"), h("p", { class: "muted" }, "Open Food Facts has no brand or category for this product, so there's nothing to compare it with."));
  }

  if (ev.size && product.rev) await runHistory(slots.history, product, ev, live, redraw);
  else mount(slots.history, h("h2", {}, "Size history"), h("p", { class: "muted" }, ev.size ? "No edit history available." : "No package size on record."));

  if (!live()) return;
  const flagged = ev.events.some((e) => e.kind === "shrink") || ev.siblings.bigger.length > 0;
  drawAltsPrompt(slots.alts, product, ev, live, flagged);
}

function drawHead(el, p) {
  mount(el,
    thumb(),
    h("div", { class: "product-title" },
      h("h1", {}, productName(p)),
      h("p", { class: "muted" }, [p.brands, formatSize(sizeOf(p))].filter(Boolean).join(" · ")),
      h("p", { class: "muted small" }, `Barcode ${display(p.code)} · `,
        h("a", { href: `https://world.openfoodfacts.org/product/${p.code}`, target: "_blank", rel: "noopener noreferrer" }, "Open Food Facts ↗"))));
}

function drawError(root, code, msg) {
  mount(root, h("section", { class: "panel narrow" },
    h("h1", {}, display(code)),
    h("p", { class: "error" }, msg),
    h("div", { class: "row" },
      h("button", { class: "btn primary", type: "button", onclick: () => dispatchEvent(new HashChangeEvent("hashchange")) }, "Try again"),
      h("a", { class: "btn", href: "#/scan" }, "Scan another"))));
}

function drawMissing(root, code) {
  mount(root, h("section", { class: "panel narrow" },
    h("h1", {}, "Not in Open Food Facts yet"),
    h("p", {}, `Nobody has added barcode ${display(code)} to Open Food Facts, so there's no size history to check.`),
    h("p", { class: "muted" }, "Adding it takes a couple of minutes in their app or website (photos of the front and the net weight are enough). Your scan then helps the next shopper too."),
    h("div", { class: "row" },
      h("a", { class: "btn primary", href: `https://world.openfoodfacts.org/product/${code}`, target: "_blank", rel: "noopener noreferrer" }, "Add it on Open Food Facts ↗"),
      h("a", { class: "btn", href: "#/scan" }, "Scan another"))));
}

function drawActions(el, p, onSaved) {
  const shrunkBtn = () => {
    const on = isShrunk(p.code);
    return h("button", { class: `btn${on ? " on" : ""}`, type: "button", "aria-pressed": String(on), onclick: () => {
      if (isShrunk(p.code)) { removeShrunk(p.code); toast("Removed from your shrunk list"); }
      else { addShrunk({ code: p.code, reason: $(".verdict strong")?.textContent || "" }); toast("Added to your shrunk list"); }
      mount(el, logBtn, shrunkBtn());
    } }, on ? "✓ On my shrunk list" : "Add to shrunk list");
  };
  const logBtn = h("button", { class: "btn primary", type: "button", onclick: () => openLogPrice(p, onSaved) }, "Log shelf price");
  mount(el, logBtn, shrunkBtn());
}

function drawPrices(el, p, prices, onChange) {
  const size = sizeOf(p);
  mount(el, h("h2", {}, "Your prices"),
    prices.length
      ? h("ul", { class: "price-list" }, prices.map((x) => {
          const u = per100(x.price, x.size || size);
          return h("li", {},
            h("span", {}, h("strong", {}, money(x.price)), x.onSale ? h("span", { class: "pill tiny watch" }, "sale") : null, " ",
              h("span", { class: "muted small" }, [x.date, x.store, x.size ? formatSize(x.size) : null].filter(Boolean).join(" · "))),
            h("span", { class: "row tight" },
              u != null ? h("span", { class: "muted small" }, `${money(u)}${per100Label(x.size || size)}`) : null,
              h("button", { class: "icon-btn small", type: "button", "aria-label": `Delete price from ${x.date}`, onclick: () => { deletePrice(x.id); onChange(); } }, "×")));
        }))
      : h("p", { class: "muted" }, "No prices logged yet. Snap the shelf tag to log one. Logging the same product over time is how price creep shows up."));
}

async function runHistory(el, p, ev, live, redraw) {
  const cached = off.cachedHistory(p.code);
  const depth = DEPTH[state.settings.depth] || DEPTH.normal;
  let points, complete;
  if (cached && cached.rev === p.rev && Number.isInteger(cached.points)) {
    ({ points, complete } = { points: off.knownRevisions(p.code).filter((s) => s.rev <= p.rev), complete: cached.complete });
  } else {
    const status = h("p", { class: "muted" }, "Reading the edit history…");
    mount(el, h("h2", {}, "Size history"), status);
    const res = await sampleHistory(p.rev, (rev) => off.revision(p.code, rev), {
      ...depth,
      known: off.knownRevisions(p.code),
      onProgress: (n, of) => { if (live()) status.textContent = `Reading the edit history… ${n}/${of}`; },
    });
    ({ points, complete } = res);
    off.saveHistory(p.code, { rev: p.rev, points: points.length, complete });
  }
  if (!live()) return;
  ev.events = changes(points);
  ev.historyChecked = true;
  ev.firstSeen = points.find((x) => x.size && x.t)?.t ?? null;
  drawHistory(el, p, points, ev.events, complete);
  redraw();
}

const KIND = { shrink: "Shrank", grow: "Grew", revert: "Back to normal size (bonus pack ended)", fix: "Data correction" };

function drawHistory(el, p, points, events, complete) {
  const sized = points.filter((x) => x.size);
  mount(el, h("h2", {}, "Size history"),
    h("p", { class: "muted small" }, `Sampled ${points.length} of ${p.rev} Open Food Facts edits (${sized.length} with a size)${complete ? "" : " (sampling budget used up, so the change dates may be approximate)"}.`),
    sized.length
      ? h("ol", { class: "timeline" }, timeline(sized, events).map((row) => h("li", { class: row.kind || "" },
          h("span", { class: "when" }, row.t ? monthYear(row.t) : `edit ${row.rev}`),
          h("span", {}, row.kind ? h("strong", {}, `${KIND[row.kind]}: ${formatSize(row.from)} → ${formatSize(row.to)}${row.pct != null && row.kind !== "fix" ? ` (${row.pct > 0 ? "+" : ""}${row.pct}%)` : ""}`) : formatSize(row.size)))))
      : h("p", { class: "muted" }, "None of the sampled edits had a package size."));
}

// Collapse runs of identical sizes into "first seen" rows plus change rows.
function timeline(sized, events) {
  const rows = [{ rev: sized[0].rev, t: sized[0].t, size: sized[0].size }];
  for (const e of events) rows.push({ rev: e.toRev, t: e.t, kind: e.kind, from: e.from, to: e.to, pct: e.pct });
  const last = sized[sized.length - 1];
  if (last.rev !== rows[rows.length - 1].rev) rows.push({ rev: last.rev, t: last.t, size: last.size });
  return rows.reverse();
}

function drawSiblings(el, s) {
  const row = (x, note) => productRow({ code: x.code, product_name: x.name, quantity: formatSize(x.size), brands: "" }, h("span", { class: "muted small" }, note));
  const any = s.bigger.length + s.smaller.length + s.sizes.length;
  mount(el, h("h2", {}, "Same brand, other sizes"),
    h("p", { class: "muted small" }, "When the net contents change, the product normally gets a new barcode, so a shrunk package usually shows up here as a separate product."),
    any ? null : h("p", { class: "muted" }, "No other sizes of this product in Open Food Facts for Canada."),
    s.bigger.length ? [h("h3", {}, "Bigger versions"), h("div", { class: "list" }, s.bigger.map((x) => row(x, `${x.pct}% vs this${x.olderThanThis ? " · older" : ""}`)))] : null,
    s.smaller.length ? [h("h3", {}, "Smaller versions"), h("div", { class: "list" }, s.smaller.map((x) => row(x, `${x.pct}%${x.olderThanThis === false ? " · newer" : ""}`)))] : null,
    s.sizes.length ? [h("h3", {}, "Other pack sizes"), h("div", { class: "list" }, s.sizes.slice(0, 6).map((x) => row(x, formatSize(x.size))))] : null);
}

function drawAltsPrompt(el, p, ev, live, auto) {
  const go = () => loadAlts(el, p, live);
  mount(el, h("h2", {}, "Store-brand alternatives"),
    h("p", { class: "muted" }, "Loblaw, Sobeys, Metro, Walmart, Costco and Shoppers house brands in the same category."),
    h("button", { class: "btn", type: "button", onclick: go }, "Find alternatives"));
  if (auto) go();
}

async function loadAlts(el, p, live) {
  mount(el, h("h2", {}, "Store-brand alternatives"), h("p", { class: "muted" }, "Searching…"));
  try {
    const alts = await findAlternatives(p, off.search);
    if (!live()) return;
    for (const a of alts) rememberProduct({ code: a.code, product_name: a.name, brands: a.brand, quantity: a.size ? formatSize(a.size) : "" });
    mount(el, h("h2", {}, "Store-brand alternatives"),
      alts.length
        ? h("div", { class: "list" }, alts.map((a) => productRow({ code: a.code, product_name: a.name, brands: a.brand, quantity: a.size ? formatSize(a.size) : "" }, h("span", { class: "pill none" }, a.retailer))))
        : h("p", { class: "muted" }, "No store-brand products in this category in Open Food Facts for Canada."),
      alts.length ? h("p", { class: "muted small" }, "Matched by category and name. Scan the alternative in store to check its size history and log its price.") : null);
  } catch (e) {
    if (!live()) return;
    mount(el, h("h2", {}, "Store-brand alternatives"), h("p", { class: "error" }, e.message), h("button", { class: "btn small", type: "button", onclick: () => loadAlts(el, p, live) }, "Retry"));
  }
}
