// Home: live camera scanner, photo/typed fallbacks, recent scans.

import { decodeImage, startScanner } from "../barcode.js";
import { h, mount, toast } from "../dom.js";
import { normalize } from "../gtin.js";
import { recentScans } from "../store.js";
import { productRow } from "../ui.js";

let scanner = null;

export function stop() {
  scanner?.stop();
  scanner = null;
}

const go = (code) => { location.hash = `#/product/${code}?scan=1`; };

export function render(root) {
  stop();
  const video = h("video", { class: "viewfinder", playsinline: true, muted: true, "aria-label": "Camera preview" });
  const status = h("p", { class: "status", role: "status" });
  const stage = h("div", { class: "stage hidden" }, video, h("div", { class: "aim", "aria-hidden": "true" }));
  const startBtn = h("button", { class: "btn primary big", type: "button", onclick: start }, "Scan a barcode");
  const stopBtn = h("button", { class: "btn hidden", type: "button", onclick: () => { stop(); stage.classList.add("hidden"); stopBtn.classList.add("hidden"); startBtn.classList.remove("hidden"); status.textContent = ""; } }, "Stop camera");

  async function start() {
    status.className = "status";
    status.textContent = "Opening the camera…";
    try {
      stage.classList.remove("hidden");
      scanner = await startScanner(video, (code) => { scanner = null; navigator.vibrate?.(60); go(code); });
      startBtn.classList.add("hidden");
      stopBtn.classList.remove("hidden");
      status.textContent = "Hold the barcode inside the frame.";
    } catch (e) {
      stage.classList.add("hidden");
      status.className = "status error";
      status.textContent = e.message;
    }
  }

  const typed = h("input", { type: "text", inputmode: "numeric", autocomplete: "off", pattern: "[0-9 ]*", maxlength: "16", placeholder: "e.g. 068100084245", id: "code", "aria-describedby": "code-hint" });
  const photo = h("input", { type: "file", accept: "image/*", class: "visually-hidden", id: "barcode-photo", onchange: async (e) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    status.className = "status";
    status.textContent = "Reading the barcode in your photo…";
    try {
      const bmp = await createImageBitmap(f);
      const code = await decodeImage(bmp);
      bmp.close?.();
      if (code) go(code);
      else { status.className = "status error"; status.textContent = "No barcode found in that photo. Try closer, flat-on and in good light."; }
    } catch {
      status.className = "status error";
      status.textContent = "Couldn't read that photo.";
    }
  } });

  const recent = recentScans();
  mount(root,
    h("section", { class: "panel narrow hero" },
      h("h1", {}, "Did it shrink?"),
      h("p", { class: "muted" }, "Scan a grocery barcode. ShrinkScan checks the package's size history in Open Food Facts, looks for a bigger version of the same product, and compares the prices you log."),
      startBtn, stopBtn, stage, status,
      h("form", { class: "row code-form", onsubmit: (e) => {
        e.preventDefault();
        const code = normalize(typed.value);
        if (code) go(code); else { toast("That isn't a valid barcode. Check the digits."); typed.focus(); }
      } },
        h("label", { class: "visually-hidden", for: "code" }, "Barcode number"), typed,
        h("button", { class: "btn", type: "submit" }, "Look up")),
      h("p", { class: "muted small", id: "code-hint" }, "Or type the digits under the barcode, or ",
        h("label", { class: "link", for: "barcode-photo" }, "pick a photo"), photo, ".")),
    recent.length ? h("section", { class: "panel narrow" }, h("h2", {}, "Recent scans"), h("div", { class: "list" }, recent.map((p) => productRow(p)))) : null);
}
