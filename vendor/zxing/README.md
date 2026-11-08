# Vendored barcode decoder

Served from this site so scanning never touches a CDN.

| File | Source | Version | License |
|---|---|---|---|
| `es/reader/index.js`, `es/share.js` | [zxing-wasm](https://github.com/Sec-ant/zxing-wasm) `dist/es/` | 3.1.6 | MIT (`LICENSE`) |
| `reader/zxing_reader.wasm` | zxing-wasm `dist/reader/` (zxing-cpp compiled to WebAssembly, Apache-2.0) | 3.1.6 | MIT / Apache-2.0 |

Unmodified. `js/barcode-worker.js` overrides `locateFile` so the `.wasm` is
loaded from this folder instead of the package's default jsDelivr URL. It is
only used where the browser has no native `BarcodeDetector`.

To update: `npm pack zxing-wasm@<version>` in a scratch folder, copy the same
files over, and bump `CACHE` in `sw.js`.
