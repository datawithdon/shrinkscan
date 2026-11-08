// Shared UI pieces: modal host, product thumbnails, verdict banner.

import { display } from "./gtin.js";
import { $, h, mount } from "./dom.js";
import { formatSize, sizeOf } from "./units.js";

let lastFocus = null;
export function openModal(label, ...content) {
  const host = $("#modal");
  lastFocus = document.activeElement;
  mount(host, h("div", { class: "sheet", role: "dialog", "aria-modal": "true", "aria-label": label },
    h("button", { class: "icon-btn close", type: "button", "aria-label": "Close", onclick: closeModal }, "×"),
    ...content));
  host.classList.remove("hidden");
  document.body.classList.add("modal-open");
  host.querySelector(".close").focus();
}

export function closeModal() {
  const host = $("#modal");
  if (host.classList.contains("hidden")) return;
  host.classList.add("hidden");
  host.replaceChildren();
  document.body.classList.remove("modal-open");
  lastFocus?.focus?.();
}

export const productName = (p) => p?.product_name || p?.product_name_en || p?.product_name_fr || "Unnamed product";

// No remote product photos: loading them would tell a third-party image host
// which products you look at. A neutral placeholder stands in.
export function thumb() {
  return h("span", { class: "thumb placeholder", "aria-hidden": "true" }, "▦");
}

/** A compact row linking to a product page. */
export function productRow(p, side = null) {
  return h("a", { class: "item", href: `#/product/${p.code}` },
    thumb(),
    h("span", { class: "item-main" },
      h("strong", {}, productName(p)),
      h("span", { class: "muted small" }, [p.brands, formatSize(sizeOf(p)), display(p.code)].filter(Boolean).join(" · "))),
    side);
}

const ICONS = { shrunk: "▼", possible: "?", watch: "●", none: "✓", unknown: "–", checking: "…" };

export function verdictBanner(v) {
  return h("section", { class: `verdict ${v.level}`, "aria-live": "polite" },
    h("div", { class: "verdict-head" },
      h("span", { class: "verdict-icon", "aria-hidden": "true" }, ICONS[v.level] || "?"),
      h("strong", {}, v.title)),
    v.reasons.length ? h("ul", {}, v.reasons.map((r) => h("li", {}, r))) : null);
}

export const levelPill = (level, text) => h("span", { class: `pill ${level}` }, text);
