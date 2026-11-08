// Workers only get their CSP header from the service worker (sw.js), so give
// it a moment to take control before starting one. Without a service worker
// (insecure context, or it never takes over), carry on: the in-worker guard
// (worker-guard.js) still applies.

export function swControl(timeoutMs = 4000) {
  const sw = navigator.serviceWorker;
  if (!sw || !globalThis.isSecureContext || sw.controller) return Promise.resolve(Boolean(sw?.controller));
  return new Promise((resolve) => {
    const done = () => { clearTimeout(t); sw.removeEventListener("controllerchange", done); resolve(Boolean(sw.controller)); };
    const t = setTimeout(done, timeoutMs);
    sw.addEventListener("controllerchange", done);
  });
}
