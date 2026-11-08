// Barcode decoding off the main thread with zxing-wasm (vendored), for
// browsers without the native BarcodeDetector (iOS Safari, Firefox). The
// WebAssembly file is served from this site, never from a CDN.

import "./worker-guard.js";   // first: same-origin network guard
import { prepareZXingModule, readBarcodes } from "../vendor/zxing/es/reader/index.js";

const WASM = new URL("../vendor/zxing/reader/zxing_reader.wasm", import.meta.url).href;

prepareZXingModule({
  overrides: { locateFile: (path, prefix) => (path.endsWith(".wasm") ? WASM : prefix + path) },
  fireImmediately: false,
});

const OPTIONS = { formats: ["EAN13", "EAN8", "UPCA", "UPCE"], tryHarder: true, maxNumberOfSymbols: 1 };

self.onmessage = async (e) => {
  const { id, image } = e.data || {};
  try {
    const results = await readBarcodes(image, OPTIONS);
    const hit = results.find((r) => r.isValid && r.text);
    self.postMessage({ id, text: hit ? hit.text : null, format: hit ? hit.format : null });
  } catch (err) {
    self.postMessage({ id, error: String(err?.message || err).slice(0, 200) });
  }
};
