// Offline shell + security headers. Same-origin files are served cache-first
// and refreshed in the background. Open Food Facts requests are never cached
// here (the app keeps its own cache of product data in localStorage).
//
// GitHub Pages can't send response headers, so this worker adds them:
//  - documents get a real CSP (including frame-ancestors, which a <meta> CSP
//    can't set), Permissions-Policy, COOP and nosniff;
//  - Web Worker scripts get their own CSP. A page's CSP doesn't reach workers,
//    so without this a worker could import() or fetch code from anywhere.

const CACHE = "shrinkscan-v3";

const DOC_CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self' https://world.openfoodfacts.org; font-src 'self'; worker-src 'self'; media-src 'self' blob:; manifest-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'; frame-ancestors 'none'";
// Workers: own-origin scripts and data only. 'wasm-unsafe-eval' lets them
// compile the vendored WebAssembly (OCR and barcode decoders); nothing else.
const WORKER_CSP = "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'; worker-src 'none'; base-uri 'none'";
const PERMISSIONS = "camera=(self), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), hid=(), midi=(), display-capture=(), clipboard-read=(), browsing-topics=()";

function secure(res, request) {
  if (!res || !res.ok || res.type === "opaque" || res.type === "opaqueredirect") return res;
  const h = new Headers(res.headers);
  h.set("X-Content-Type-Options", "nosniff");
  h.set("Referrer-Policy", "no-referrer");
  if (request.mode === "navigate" || request.destination === "document") {
    h.set("Content-Security-Policy", DOC_CSP);
    h.set("Permissions-Policy", PERMISSIONS);
    h.set("Cross-Origin-Opener-Policy", "same-origin");
    h.set("X-Frame-Options", "DENY");
  } else if (request.destination === "worker" || request.destination === "sharedworker") {
    h.set("Content-Security-Policy", WORKER_CSP);
  }
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}
const SHELL = [
  "./", "index.html", "manifest.webmanifest",
  "css/styles.css", "icons/icon.svg", "js/app.js", "js/barcode-worker.js", "js/barcode.js", "js/sw-ready.js", "js/worker-guard.js", "js/tesseract-worker.js", "js/dom.js", "js/gtin.js", "js/history.js", "js/ocr.js", "js/off.js", "js/shelf.js", "js/siblings.js", "js/store.js", "js/ui.js", "js/units.js", "js/verdict.js", "js/views/logprice.js", "js/views/prices.js", "js/views/product.js", "js/views/scan.js", "js/views/settings.js", "js/views/shrunk.js",
  "vendor/tesseract/tesseract.esm.min.js", "vendor/tesseract/worker.min.js",
  "vendor/zxing/es/reader/index.js", "vendor/zxing/es/share.js", "vendor/zxing/reader/zxing_reader.wasm",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return;
  e.respondWith(caches.open(CACHE).then(async (cache) => {
    const hit = await cache.match(e.request, { ignoreSearch: true });
    const fresh = fetch(e.request).then((res) => {
      if (res.ok && res.type === "basic") cache.put(e.request, res.clone());
      return res;
    }).catch(() => hit);
    return secure(await (hit || fresh), e.request);
  }));
});
