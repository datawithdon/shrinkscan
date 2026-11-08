// Barcode helpers: GS1 check digits and the code form Open Food Facts uses
// (UPC-A is stored as a 13-digit EAN with a leading 0).

/** True if the last digit is the GS1 mod-10 check digit of the rest. */
export function checkDigitOk(code) {
  if (!/^\d{8}$|^\d{12,14}$/.test(code)) return false;
  const digits = [...code].map(Number);
  const check = digits.pop();
  let sum = 0;
  digits.reverse().forEach((d, i) => { sum += d * (i % 2 === 0 ? 3 : 1); });
  return (10 - (sum % 10)) % 10 === check;
}

/** Expand an 8-digit UPC-E (number system 0 or 1) to its 12-digit UPC-A. */
export function expandUpcE(code) {
  if (!/^[01]\d{7}$/.test(code)) return null;
  const ns = code[0], d = code.slice(1, 7), check = code[7];
  const last = d[5];
  let body;
  if (last <= "2") body = `${d[0]}${d[1]}${last}0000${d[2]}${d[3]}${d[4]}`;
  else if (last === "3") body = `${d[0]}${d[1]}${d[2]}00000${d[3]}${d[4]}`;
  else if (last === "4") body = `${d[0]}${d[1]}${d[2]}${d[3]}00000${d[4]}`;
  else body = `${d[0]}${d[1]}${d[2]}${d[3]}${d[4]}0000${last}`;
  return `${ns}${body}${check}`;
}

/**
 * Normalise a scanned or typed barcode to the key Open Food Facts uses.
 * `format` is the scanner's format name when known (e.g. "upc_e", "UPCE").
 * Returns null for anything that isn't a valid retail barcode.
 */
export function normalize(raw, format = "") {
  let code = String(raw ?? "").replace(/[\s-]/g, "");
  if (!/^\d+$/.test(code)) return null;
  if (/upc[-_]?e/i.test(format) && code.length === 8) code = expandUpcE(code) || "";
  if (code.length === 14 && code.startsWith("0")) code = code.slice(1);
  if (code.length === 12) code = `0${code}`;
  if (code.length !== 8 && code.length !== 13) return null;
  return checkDigitOk(code) ? code : null;
}

/** Human-friendly display: UPC-A codes lose the padding zero again. */
export const display = (code) => (code.length === 13 && code.startsWith("0") ? code.slice(1) : code);
