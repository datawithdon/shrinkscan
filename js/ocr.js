// On-device OCR for shelf tags with Tesseract.js. The library, its WebAssembly
// core and the English model are all served from vendor/ on this site (no
// CDN), so the photo never leaves the phone.

import Tesseract from "../vendor/tesseract/tesseract.esm.min.js";

const VENDOR = new URL("../vendor/tesseract/", import.meta.url).href;
const OCR_WIDTH = 1400;

let workerPromise = null;
const onProgressRef = { fn: () => {} };

function getWorker(onProgress) {
  if (!workerPromise) {
    workerPromise = Tesseract.createWorker("eng", Tesseract.OEM.LSTM_ONLY, {
      workerPath: new URL("./tesseract-worker.js", import.meta.url).href,   // guard + vendor/tesseract/worker.min.js
      corePath: `${VENDOR}core/`,
      langPath: `${VENDOR}lang/`,
      workerBlobURL: false,
      gzip: true,
      logger: (m) => {
        if (m && typeof m.progress === "number" && typeof m.status === "string") onProgressRef.fn(m);
      },
    }).catch((e) => {
      workerPromise = null;
      throw e;
    });
  }
  onProgressRef.fn = onProgress || (() => {});
  return workerPromise;
}

/** Draw an image/bitmap to a canvas whose longest side is at most `maxSide`. */
export function toCanvas(source, maxSide = 2000) {
  const w = source.naturalWidth || source.videoWidth || source.width;
  const hgt = source.naturalHeight || source.videoHeight || source.height;
  const scale = Math.min(1, maxSide / Math.max(w, hgt));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w * scale));
  c.height = Math.max(1, Math.round(hgt * scale));
  c.getContext("2d").drawImage(source, 0, 0, c.width, c.height);
  return c;
}

/** Greyscale + contrast stretch (1% clipped each end): shelf tags are glossy and often lit unevenly. */
function prepare(canvas) {
  const scale = OCR_WIDTH / canvas.width;
  const c = document.createElement("canvas");
  c.width = OCR_WIDTH;
  c.height = Math.min(4000, Math.round(canvas.height * scale));
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(canvas, 0, 0, c.width, c.height);
  const img = ctx.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  const hist = new Uint32Array(256);
  for (let i = 0; i < d.length; i += 4) {
    const g = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
    d[i] = g;
    hist[g]++;
  }
  const n = d.length / 4, clip = n * 0.01;
  let lo = 0, hi = 255, acc = 0;
  while (lo < 255 && (acc += hist[lo]) < clip) lo++;
  acc = 0;
  while (hi > 0 && (acc += hist[hi]) < clip) hi--;
  const span = Math.max(1, hi - lo);
  for (let i = 0; i < d.length; i += 4) {
    const g = Math.max(0, Math.min(255, ((d[i] - lo) / span) * 255));
    d[i] = d[i + 1] = d[i + 2] = g;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/**
 * Read a shelf-tag photo. PSM 11 (sparse text) copes with the scattered
 * layout of a tag. Word box heights are returned so the parser can prefer
 * the big printed price over the small unit price.
 */
export async function readTag(canvas, onProgress) {
  const worker = await getWorker(onProgress);
  await worker.setParameters({ tessedit_pageseg_mode: "11", preserve_interword_spaces: "1" });
  const res = await worker.recognize(prepare(canvas), {}, { text: true, blocks: true });
  const words = [];
  for (const b of res.data.blocks || []) for (const p of b.paragraphs || []) for (const l of p.lines || []) for (const w of l.words || []) {
    if (w?.bbox && typeof w.text === "string") words.push({ text: w.text, height: w.bbox.y1 - w.bbox.y0 });
  }
  return { text: res.data.text || "", words, confidence: res.data.confidence ?? 0 };
}
