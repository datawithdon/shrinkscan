# Security

ShrinkScan is a static site with no backend, accounts or cookies. This page
lists what it does to protect users and how to report a problem.

## Data and network

- **Your data stays on your device.** Prices, the shrunk list and scan history
  are stored in the browser's localStorage. Nothing is uploaded.
- **The app talks to exactly one outside host:** `world.openfoodfacts.org`,
  for read-only product lookups. Its Content-Security-Policy allows nothing
  else, and the barcode decoder and the OCR engine are served from this site.
- **No product photos are loaded.** Remote images would tell an image host
  which products you look at, so a local placeholder is shown instead.
- **No analytics, trackers, cookies, fonts or CDNs.** A full run (lookup, OCR,
  both barcode decoders, camera) was recorded at the network level and
  contacted only this site and `world.openfoodfacts.org`.
- **Barcode lookups are the only thing sent out.** Open Food Facts sees the
  barcodes you look up, as with any lookup app. Requests carry no cookies or
  referrer (`credentials: "omit"`, `no-referrer`).
- **Shelf-tag and barcode photos never leave the phone.** They're read on the
  device and then discarded, not stored.
- **Camera** access is requested only when you tap "Scan a barcode", and is
  stopped when you leave the page or switch apps.

## Hardening in the code

- No `innerHTML`, `eval` or inline scripts or styles. All text is rendered with
  `textContent`, and the CSP blocks inline code.
- Open Food Facts responses, OCR text and imported backups are untrusted. Each
  record is rebuilt field by field with type, length and pattern checks
  (`js/store.js` `cleanProduct` / `sanitize`). Barcodes must pass their GS1
  check digit. Product images are accepted only from
  `https://images.openfoodfacts.org/images/products/…`.
- CSV export prefixes cells that start with `= + - @` so they can't run as
  spreadsheet formulas.
- Backups are size-capped (5 MB) and must identify as ShrinkScan backups.
- Outbound links use `rel="noopener noreferrer"`.
- Requests to Open Food Facts are paced below its published rate limits and
  cached, so the app doesn't hammer a volunteer-run service.
- **Security headers from the service worker.** GitHub Pages can't send
  response headers, so `sw.js` adds them to what it serves:
  - Pages get a real `Content-Security-Policy` (the same as the `<meta>` one,
    plus `frame-ancestors 'none'`), `Permissions-Policy` (camera for this site
    only; microphone, location, payment, USB and others off),
    `Cross-Origin-Opener-Policy: same-origin`, `X-Frame-Options: DENY`,
    `nosniff` and `no-referrer`.
  - **Web Workers get their own CSP**
    (`default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'`).
    A page's CSP doesn't reach workers, so without this a worker could
    `import()` or fetch code from any site. Workers wait (up to 4 s) for the
    service worker to take control before starting.
- **Worker guard as a second layer.** Both workers also load
  `js/worker-guard.js` first. It limits `fetch`, `importScripts` and XHR to
  this site and disables WebSocket, EventSource and WebTransport. It can't
  intercept `import()`; the worker CSP above covers that. The guard matters
  only when the service worker isn't running (very first moments of a visit
  on a slow device, or private modes that disable service workers).
- **Framing.** When another site frames the app, the browser isolates its
  storage, so the service worker (and its `frame-ancestors` header) isn't
  used there. The app then refuses to run and replaces itself with a notice
  before anything can be clicked.
- Third-party code is vendored at pinned versions (see `vendor/*/README.md`).
  Every file was compared byte-for-byte with the official npm packages
  (tesseract.js 7.0.0, tesseract.js-core 7.0.0, @tesseract.js-data/eng 1.0.0
  `4.0.0_best_int`, zxing-wasm 3.1.6). All are identical except two stripped
  `//# sourceMappingURL` comments.

## Reporting

Please open a private security advisory on the GitHub repository rather than a
public issue.
