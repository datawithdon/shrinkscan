// Same-origin network guard for Web Workers. The page's <meta> CSP doesn't
// reach workers, and GitHub Pages can't send a CSP header, so this is the
// workers' equivalent of `connect-src 'self'`. The vendored libraries carry
// default CDN URLs (jsDelivr) that the app always overrides; if an override
// ever failed, this stops a worker from quietly loading or sending anything
// off-site. Plain script (no exports) so it works with importScripts() and
// as a module import. Must run before any library code.

(() => {
  const g = self;
  if (g.__sameOriginGuard) return;
  g.__sameOriginGuard = true;
  const origin = g.location.origin;
  const local = (u) => {
    try {
      const url = new URL(typeof u === "string" ? u : u?.url ?? String(u), g.location.href);
      return url.origin === origin || url.protocol === "blob:" || url.protocol === "data:";
    } catch { return false; }
  };
  const blocked = (u) => new TypeError(`Blocked off-site request from worker: ${String(u?.url ?? u).slice(0, 80)}`);

  const realFetch = g.fetch?.bind(g);
  if (realFetch) g.fetch = (input, init) => (local(input) ? realFetch(input, init) : Promise.reject(blocked(input)));

  const realImport = g.importScripts?.bind(g);
  if (realImport) g.importScripts = (...urls) => { for (const u of urls) if (!local(u)) throw blocked(u); return realImport(...urls); };

  if (g.XMLHttpRequest) {
    const open = g.XMLHttpRequest.prototype.open;
    g.XMLHttpRequest.prototype.open = function (method, url, ...rest) {
      if (!local(url)) throw blocked(url);
      return open.call(this, method, url, ...rest);
    };
  }
  for (const name of ["WebSocket", "EventSource", "WebTransport"]) {
    if (g[name]) g[name] = function () { throw new TypeError(`${name} is disabled in this worker`); };
  }
})();
