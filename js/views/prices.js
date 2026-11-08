// Every price you've logged, newest first, grouped by product.

import { download, h, money, mount } from "../dom.js";
import { display } from "../gtin.js";
import { state } from "../store.js";
import { productName } from "../ui.js";
import { formatSize, per100, per100Label, sizeOf } from "../units.js";

export function render(root) {
  const byCode = new Map();
  for (const p of state.prices) {
    if (!byCode.has(p.code)) byCode.set(p.code, []);
    byCode.get(p.code).push(p);
  }
  const groups = [...byCode.entries()].map(([code, list]) => ({ code, list: list.sort((a, b) => (a.date < b.date ? 1 : -1)) }))
    .sort((a, b) => (a.list[0].date < b.list[0].date ? 1 : -1));

  mount(root, h("section", { class: "panel narrow" },
    h("div", { class: "head" }, h("h1", {}, "Price log"),
      state.prices.length ? h("button", { class: "btn small", type: "button", onclick: exportCsv }, "Export CSV") : null),
    groups.length ? null : h("p", { class: "empty" }, "No prices yet. Open a product and tap “Log shelf price”."),
    groups.map(({ code, list }) => {
      const prod = state.products[code];
      const size = sizeOf(prod);
      return h("div", { class: "group" },
        h("a", { class: "group-title", href: `#/product/${code}` }, prod ? productName(prod) : display(code), h("span", { class: "muted small" }, ` · ${formatSize(size)}`)),
        h("div", { class: "table-wrap" }, h("table", { class: "prices" },
          h("thead", {}, h("tr", {}, h("th", {}, "Date"), h("th", {}, "Store"), h("th", {}, "Price"), h("th", {}, "Per 100"))),
          h("tbody", {}, list.map((p) => {
            const u = per100(p.price, p.size || size);
            return h("tr", {}, h("td", {}, p.date), h("td", {}, p.store || "—"),
              h("td", {}, money(p.price), p.onSale ? " (sale)" : ""),
              h("td", {}, u != null ? `${money(u)}${per100Label(p.size || size)}` : "—"));
          })))));
    })));
}

const csvCell = (v) => {
  let s = String(v ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;        // no spreadsheet formula injection
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

function exportCsv() {
  const rows = [["date", "barcode", "product", "store", "price_cad", "size", "per_100", "sale"]];
  for (const p of state.prices) {
    const prod = state.products[p.code];
    const size = p.size || sizeOf(prod);
    rows.push([p.date, display(p.code), prod ? productName(prod) : "", p.store, p.price.toFixed(2), size ? formatSize(size) : "", per100(p.price, size) ?? "", p.onSale ? "yes" : ""]);
  }
  download(`shrinkscan-prices-${new Date().toLocaleDateString("en-CA")}.csv`, rows.map((r) => r.map(csvCell).join(",")).join("\n"), "text/csv");
}
