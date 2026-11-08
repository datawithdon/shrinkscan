// "Log shelf price" sheet: snap the shelf tag, OCR fills in the price and
// unit price, one tap saves. Everything can be typed by hand too.

import { h, money, toast } from "../dom.js";
import { readTag, toCanvas } from "../ocr.js";
import { parseShelfTag } from "../shelf.js";
import { addPrice, knownStores, state } from "../store.js";
import { closeModal, openModal, productName } from "../ui.js";
import { formatSize, parseQuantity, per100, per100Label, sizeOf } from "../units.js";

const today = () => new Date().toLocaleDateString("en-CA");

export function openLogPrice(product, onSaved) {
  const pkg = sizeOf(product);
  const price = h("input", { type: "number", inputmode: "decimal", step: "0.01", min: "0.01", max: "10000", required: true, id: "lp-price" });
  const unit = h("input", { type: "number", inputmode: "decimal", step: "0.001", min: "0", id: "lp-unit", placeholder: "optional" });
  const sizeIn = h("input", { type: "text", id: "lp-size", value: pkg ? formatSize(pkg) : "", placeholder: "e.g. 375 g" });
  const store = h("input", { type: "text", id: "lp-store", list: "lp-stores", maxlength: "60", value: state.settings.lastStore, placeholder: "e.g. No Frills Bloor" });
  const date = h("input", { type: "date", id: "lp-date", value: today(), max: today() });
  const sale = h("input", { type: "checkbox", id: "lp-sale" });
  const status = h("p", { class: "status", role: "status" });
  const check = h("p", { class: "muted small", "aria-live": "polite" });
  const file = h("input", { type: "file", accept: "image/*", capture: "environment", class: "visually-hidden", id: "lp-photo" });

  const updateCheck = () => {
    const p = Number(price.value), s = parseQuantity(sizeIn.value) || pkg, u = Number(unit.value);
    const mine = per100(p, s);
    if (!mine) { check.textContent = ""; return; }
    let msg = `That's ${money(mine)}${per100Label(s)}.`;
    // The shelf's own unit price is a cross-check on the package size we have.
    if (u > 0 && Math.abs(u - mine) > mine * 0.1) msg += ` The tag says ${money(u)}${per100Label(s)}, so check the size (the package may have changed).`;
    check.textContent = msg;
  };
  for (const el of [price, unit, sizeIn]) el.addEventListener("input", updateCheck);

  file.addEventListener("change", async () => {
    const f = file.files?.[0];
    file.value = "";
    if (!f) return;
    status.className = "status";
    status.textContent = "Reading the tag…";
    try {
      const bmp = await createImageBitmap(f);
      const canvas = toCanvas(bmp, 2000);
      bmp.close?.();
      const res = await readTag(canvas, (m) => { status.textContent = m.status === "recognizing text" ? `Reading the tag… ${Math.round(m.progress * 100)}%` : "Loading the text reader (first time only)…"; });
      const tag = parseShelfTag(res.text, res.words);
      if (tag.price != null) price.value = tag.price.toFixed(2);
      if (tag.unitPrice && (!pkg || tag.unitPrice.base === pkg.base)) unit.value = String(tag.unitPrice.per100);
      status.className = tag.price != null ? "status ok" : "status error";
      status.textContent = tag.price != null
        ? `Found ${money(tag.price)}${tag.multi ? ` (${tag.multi})` : ""}${tag.unitPrice ? ` and ${money(tag.unitPrice.per100)}${tag.unitPrice.base === "ml" ? "/100 mL" : "/100 g"}` : ""}. Check it and save.`
        : "Couldn't find a price on that photo. Type it in, or try closer with the tag filling the frame.";
      updateCheck();
      price.focus();
    } catch {
      status.className = "status error";
      status.textContent = "The text reader couldn't start on this device. Type the price instead.";
    }
  });

  const form = h("form", { class: "form-grid", onsubmit: (e) => {
    e.preventDefault();
    const p = Number(price.value);
    if (!(p > 0)) { price.focus(); return; }
    const size = parseQuantity(sizeIn.value) || pkg;
    const u = Number(unit.value);
    const saved = addPrice({
      code: product.code, date: date.value || today(), price: p, size,
      shelfUnit: u > 0 && size ? { per100: u, base: size.base } : null,
      store: store.value, onSale: sale.checked,
    });
    if (!saved) { toast("That price couldn't be saved. Check the fields."); return; }
    closeModal();
    toast(`Logged ${money(saved.price)}`);
    onSaved?.();
  } },
    h("div", { class: "span2 row" },
      h("label", { class: "btn primary", for: "lp-photo" }, "📷 Snap shelf tag"), file,
      h("span", { class: "muted small" }, "Read on your phone; the photo isn't kept.")),
    h("div", { class: "span2" }, status),
    h("label", { for: "lp-price" }, "Price ($)", price),
    h("label", { for: "lp-unit" }, `Tag unit price ($${per100Label(pkg)})`, unit),
    h("label", { for: "lp-size" }, "Package size", sizeIn),
    h("label", { for: "lp-date" }, "Date", date),
    h("label", { class: "span2", for: "lp-store" }, "Store", store),
    h("datalist", { id: "lp-stores" }, knownStores().map((s) => h("option", { value: s }))),
    h("label", { class: "check span2" }, sale, "Sale price (left out of price-creep checks)"),
    h("div", { class: "span2" }, check),
    h("div", { class: "span2 row" }, h("button", { class: "btn primary", type: "submit" }, "Save price")));

  openModal("Log shelf price", h("h2", {}, "Log shelf price"), h("p", { class: "muted" }, `${productName(product)}${pkg ? ` · ${formatSize(pkg)}` : ""}`), form);
}
