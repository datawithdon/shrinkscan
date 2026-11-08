// Live barcode scanning from the rear camera. Uses the browser's built-in
// BarcodeDetector where it exists (Chrome on Android, Edge) and falls back to
// zxing-wasm in a worker everywhere else. Only retail symbologies are read,
// and a result must pass its check digit before it counts.

import { normalize } from "./gtin.js";

const NATIVE_FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e"];

let worker = null;
let nextId = 1;
const pending = new Map();

function zxing() {
  if (!worker) {
    worker = new Worker(new URL("./barcode-worker.js", import.meta.url), { type: "module" });
    worker.onmessage = (e) => {
      const p = pending.get(e.data?.id);
      if (p) { pending.delete(e.data.id); p(e.data); }
    };
    worker.onerror = () => {
      for (const p of pending.values()) p({ error: "decoder failed" });
      pending.clear();
      worker = null;
    };
  }
  return worker;
}

function decodeWithZxing(imageData) {
  return new Promise((resolve) => {
    const id = nextId++;
    pending.set(id, resolve);
    zxing().postMessage({ id, image: imageData }, [imageData.data.buffer]);
  });
}

async function nativeDetector() {
  if (!("BarcodeDetector" in globalThis)) return null;
  try {
    const supported = await globalThis.BarcodeDetector.getSupportedFormats();
    const formats = NATIVE_FORMATS.filter((f) => supported.includes(f));
    return formats.length ? new globalThis.BarcodeDetector({ formats }) : null;
  } catch {
    return null;
  }
}

/** Decode one still image (a photo picked from the gallery). */
export async function decodeImage(source) {
  const detector = await nativeDetector();
  if (detector) {
    try {
      for (const r of await detector.detect(source)) {
        const code = normalize(r.rawValue, r.format);
        if (code) return code;
      }
    } catch { /* fall through to zxing */ }
  }
  const w = source.naturalWidth || source.width, h = source.naturalHeight || source.height;
  const scale = Math.min(1, 1600 / Math.max(w, h));
  const c = document.createElement("canvas");
  c.width = Math.round(w * scale);
  c.height = Math.round(h * scale);
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(source, 0, 0, c.width, c.height);
  const res = await decodeWithZxing(ctx.getImageData(0, 0, c.width, c.height));
  return res.text ? normalize(res.text, res.format) : null;
}

/**
 * Start scanning into a <video>. Calls onCode(code) once with the first valid
 * barcode, then stops. Returns { stop() }. Throws a friendly Error when the
 * camera can't be opened.
 */
export async function startScanner(video, onCode) {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("This browser can't open the camera. Type the barcode instead.");
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
  } catch (e) {
    throw new Error(e?.name === "NotAllowedError" ? "Camera permission was denied. Allow it in your browser settings, or type the barcode." : "Couldn't open the camera. Type the barcode instead.");
  }
  video.srcObject = stream;
  video.setAttribute("playsinline", "");
  video.muted = true;
  await video.play().catch(() => {});

  const detector = await nativeDetector();
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  let stopped = false, timer = null, lastCode = null;

  const stop = () => {
    stopped = true;
    clearTimeout(timer);
    for (const t of stream.getTracks()) t.stop();
    video.srcObject = null;
  };

  // Two identical reads in a row before accepting, to avoid a misread digit
  // that still happens to pass the check digit.
  const accept = (code) => {
    if (!code) { lastCode = null; return false; }
    if (code === lastCode) { stop(); onCode(code); return true; }
    lastCode = code;
    return false;
  };

  async function tick() {
    if (stopped) return;
    try {
      if (video.readyState >= 2 && video.videoWidth) {
        if (detector) {
          const found = await detector.detect(video);
          const code = found.map((r) => normalize(r.rawValue, r.format)).find(Boolean) || null;
          if (accept(code)) return;
        } else {
          // Centre band only: barcodes are held in the middle of the frame, and
          // a smaller image decodes several times faster.
          const vw = video.videoWidth, vh = video.videoHeight;
          const cw = Math.min(vw, 960), ch = Math.round(cw * 0.5);
          const sx = (vw - cw) / 2, sy = Math.max(0, (vh - ch) / 2);
          canvas.width = cw; canvas.height = Math.min(ch, vh);
          ctx.drawImage(video, sx, sy, cw, canvas.height, 0, 0, cw, canvas.height);
          const res = await decodeWithZxing(ctx.getImageData(0, 0, canvas.width, canvas.height));
          if (accept(res.text ? normalize(res.text, res.format) : null)) return;
        }
      }
    } catch { /* keep trying */ }
    if (!stopped) timer = setTimeout(tick, detector ? 120 : 60);
  }
  tick();
  return { stop };
}
