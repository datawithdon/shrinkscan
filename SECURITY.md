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
- The app refuses to run inside a frame, because GitHub Pages can't send
  `X-Frame-Options` (clickjacking).
- Requests to Open Food Facts are paced below its published rate limits and
  cached, so the app doesn't hammer a volunteer-run service.
- **Workers are fenced in too.** A page's CSP doesn't reach Web Workers, and
  GitHub Pages can't send a CSP header, so both workers load
  `js/worker-guard.js` first. It only lets `fetch`, `importScripts` and XHR
  reach this site, and disables WebSocket, EventSource and WebTransport. The
  vendored libraries' default CDN URLs (jsDelivr) are always overridden, and
  the guard makes sure a failed override can't load code from off-site.
- Third-party code is vendored at pinned versions (see `vendor/*/README.md`).
  Every file was compared byte-for-byte with the official npm packages
  (tesseract.js 7.0.0, tesseract.js-core 7.0.0, @tesseract.js-data/eng 1.0.0
  `4.0.0_best_int`, zxing-wasm 3.1.6). All are identical except two stripped
  `//# sourceMappingURL` comments.

## Reporting

Please open a private security advisory on the GitHub repository rather than a
public issue.
