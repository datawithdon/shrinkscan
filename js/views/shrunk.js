// "My shrunk list": products you've flagged, each with store-brand
// alternatives on demand.

import { h, mount } from "../dom.js";
import { off } from "../off.js";
import { findAlternatives, leafCategory } from "../siblings.js";
import { removeShrunk, state } from "../store.js";
import { productRow } from "../ui.js";
import { formatSize } from "../units.js";

export function render(root) {
  const items = state.shrunk.map((s) => ({ s, p: state.products[s.code] || { code: s.code, product_name: "" } }));
  mount(root, h("section", { class: "panel narrow" },
    h("h1", {}, "My shrunk list"),
    items.length
      ? h("p", { class: "muted" }, "Products you've flagged. Tap “Alternatives” for store brands in the same category.")
      : h("p", { class: "empty" }, "Nothing here yet. When a scan says “Shrunk” or “Possibly shrunk”, add it to this list to keep track and find a store-brand swap."),
    h("div", { class: "list" }, items.map(({ s, p }) => card(s, p)))));
}

function card(s, p) {
  const altBox = h("div", {});
  const el = h("div", { class: "item-card" },
    productRow(p, h("span", { class: "muted small" }, `Added ${s.addedAt}`)),
    s.reason ? h("p", { class: "muted small" }, s.reason) : null,
    h("div", { class: "row tight" },
      h("button", { class: "btn small", type: "button", onclick: () => alts(altBox, p) }, "Alternatives"),
      h("button", { class: "btn small danger", type: "button", onclick: () => { removeShrunk(s.code); el.remove(); } }, "Remove")),
    altBox);
  return el;
}

async function alts(box, p) {
  if (!leafCategory(p)) { mount(box, h("p", { class: "muted small" }, "Open the product once so its category is known, then try again.")); return; }
  mount(box, h("p", { class: "muted small" }, "Searching…"));
  try {
    const list = await findAlternatives(p, off.search);
    mount(box, list.length
      ? h("div", { class: "list" }, list.map((a) => productRow({ code: a.code, product_name: a.name, brands: a.brand, quantity: a.size ? formatSize(a.size) : "" }, h("span", { class: "pill none" }, a.retailer))))
      : h("p", { class: "muted small" }, "No store-brand products in this category for Canada yet."));
  } catch (e) {
    mount(box, h("p", { class: "error small" }, e.message));
  }
}
