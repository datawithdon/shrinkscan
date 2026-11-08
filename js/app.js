// Entry point: hash router, shrunk-list badge, service worker.

import { $, $$ } from "./dom.js";
import { load, onChange, state } from "./store.js";
import { closeModal } from "./ui.js";
import * as prices from "./views/prices.js";
import * as product from "./views/product.js";
import * as scan from "./views/scan.js";
import * as settings from "./views/settings.js";
import * as shrunk from "./views/shrunk.js";

const ROUTES = { scan, product, shrunk, prices, settings };

function route() {
  const raw = location.hash.replace(/^#\/?/, "");
  const [path, query = ""] = raw.split("?");
  const [name, arg] = path.split("/");
  const view = Object.hasOwn(ROUTES, name) ? name : "scan";
  closeModal();
  scan.stop();
  const navView = view === "product" ? "scan" : view;
  for (const a of $$("header nav a")) a.toggleAttribute("aria-current", a.dataset.view === navView);
  const root = $("#view");
  let id = "";
  try { id = arg ? decodeURIComponent(arg) : ""; } catch { id = ""; }
  ROUTES[view].render(root, new URLSearchParams(query), id);
  root.focus({ preventScroll: true });
  scrollTo(0, 0);
}

function updateBadge() {
  const n = state.shrunk.length;
  const b = $("#nav-shrunk");
  b.textContent = n ? String(n) : "";
  b.classList.toggle("hidden", !n);
}

// GitHub Pages can't send X-Frame-Options and a <meta> CSP can't set
// frame-ancestors, so refuse to run inside another site's frame (clickjacking).
if (window.top !== window.self) {
  document.body.replaceChildren(Object.assign(document.createElement("p"), { className: "empty", textContent: "ShrinkScan can't run inside another site. Open it directly." }));
  throw new Error("framed");
}

load();
onChange(updateBadge);
updateBadge();
addEventListener("hashchange", route);
addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });
$("#modal").addEventListener("click", (e) => { if (e.target.id === "modal") closeModal(); });
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") scan.stop(); });
route();

if ("serviceWorker" in navigator && globalThis.isSecureContext) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
