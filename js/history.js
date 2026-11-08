// Size history from Open Food Facts revisions. Every edit of a product page is
// a numbered revision, and `?rev=N` returns that snapshot. Fetching all of them
// would blow through OFF's rate limit, so we sample evenly, then bisect between
// any two samples whose sizes differ to pin down when the change happened.

import { pct, sameSize } from "./units.js";

export const DEFAULT_SAMPLES = 8;
export const DEFAULT_BUDGET = 18;

/**
 * @param {number} latestRev  current revision number
 * @param {(rev:number)=>Promise<{rev:number,t:number|null,size:object|null}|null>} fetchRev
 * @param {{samples?:number,budget?:number,known?:object[],onProgress?:Function}} opts
 *   `known` are snapshots fetched earlier (from cache); they cost nothing.
 * @returns {Promise<{points:object[], fetched:number, complete:boolean}>}
 */
export async function sampleHistory(latestRev, fetchRev, opts = {}) {
  const { samples = DEFAULT_SAMPLES, budget = DEFAULT_BUDGET, known = [], onProgress } = opts;
  const byRev = new Map();
  for (const k of known) if (k && Number.isInteger(k.rev)) byRev.set(k.rev, k);
  let fetched = 0;
  let complete = true;

  async function get(rev) {
    if (byRev.has(rev)) return byRev.get(rev);
    if (fetched >= budget) { complete = false; return undefined; }
    fetched++;
    onProgress?.(fetched, budget);
    const snap = await fetchRev(rev);
    // A failed fetch is remembered as "no data" for this run only.
    byRev.set(rev, snap || { rev, t: null, size: null, failed: true });
    return byRev.get(rev);
  }

  const R = Math.max(1, Math.floor(latestRev));
  const plan = new Set([R]);
  for (let i = 0; i < samples; i++) plan.add(Math.max(1, Math.round(1 + ((R - 1) * i) / Math.max(1, samples - 1))));
  for (const rev of [...plan].sort((a, b) => b - a)) await get(rev);

  // Bisect between neighbouring sized snapshots that disagree, newest first,
  // because a recent change matters most to someone standing in the aisle.
  // A sizeless or failed probe doesn't say which side the change is on, so the
  // next probe is the untried revision nearest the middle of the same gap.
  for (let guard = 0; guard < 200; guard++) {
    const sized = withSize(byRev);
    let probe = null;
    for (let i = sized.length - 1; i > 0 && probe == null; i--) {
      const a = sized[i - 1], b = sized[i];
      if (!sameSize(a.size, b.size)) probe = untriedNearMid(byRev, a.rev, b.rev);
    }
    if (probe == null) break;
    if ((await get(probe)) === undefined) break;
  }

  const points = [...byRev.values()].filter((p) => !p.failed).sort((a, b) => a.rev - b.rev);
  return { points, fetched, complete };
}

const withSize = (map) => [...map.values()].filter((p) => p.size && !p.failed).sort((a, b) => a.rev - b.rev);

function untriedNearMid(map, lo, hi) {
  const mid = Math.floor((lo + hi) / 2);
  for (let d = 0; mid - d > lo || mid + d < hi; d++) {
    if (mid - d > lo && !map.has(mid - d)) return mid - d;
    if (mid + d < hi && !map.has(mid + d)) return mid + d;
  }
  return null;
}

/**
 * Turn sized points into change events.
 * kind: "shrink" (1–50% smaller), "grow", "revert" (shrinks back to a size it
 * had before a temporary bonus pack) or "fix" (unit family changed or the size
 * moved by 2× or more — almost always a data correction, not a new package).
 */
export function changes(points) {
  const sized = points.filter((p) => p.size).sort((a, b) => a.rev - b.rev);
  const events = [];
  for (let i = 1; i < sized.length; i++) {
    const a = sized[i - 1], b = sized[i];
    if (sameSize(a.size, b.size)) continue;
    const ev = { fromRev: a.rev, toRev: b.rev, from: a.size, to: b.size, t: b.t ?? null, tBefore: a.t ?? null };
    if (a.size.base !== b.size.base) ev.kind = "fix";
    else {
      const ratio = b.size.amount / a.size.amount;
      ev.pct = pct(ratio);
      if (ratio <= 0.5 || ratio >= 2) ev.kind = "fix";
      else if (ratio > 1) ev.kind = "grow";
      else {
        const lastGrow = events.findLast((e) => e.kind === "grow");
        ev.kind = lastGrow && sameSize(lastGrow.from, b.size) ? "revert" : "shrink";
      }
    }
    events.push(ev);
  }
  return events;
}
