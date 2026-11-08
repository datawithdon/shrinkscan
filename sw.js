// Offline shell: same-origin files are served cache-first and refreshed in the
// background. Open Food Facts requests are never cached here (the app keeps
// its own cache of product data in localStorage).

const CACHE = "shrinkscan-v2";
const SHELL = [
  "./", "index.html", "manifest.webmanifest",
  "css/styles.css", "icons/icon.svg", "js/app.js", "js/barcode-worker.js", "js/barcode.js", "js/worker-guard.js", "js/tesseract-worker.js", "js/dom.js", "js/gtin.js", "js/history.js", "js/ocr.js", "js/off.js", "js/shelf.js", "js/siblings.js", "js/store.js", "js/ui.js", "js/units.js", "js/verdict.js", "js/views/logprice.js", "js/views/prices.js", "js/views/product.js", "js/views/scan.js", "js/views/settings.js", "js/views/shrunk.js",
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
    return hit || fresh;
  }));
});
