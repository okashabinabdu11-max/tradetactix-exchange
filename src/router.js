// Minimal hash router: #/dashboard, #/risk, ...
// Hash routes work on any static host without server rewrites.

export function parseRoute(hash, knownIds, fallback = 'dashboard') {
  const id = String(hash || '').replace(/^#\/?/, '').split(/[/?]/)[0].toLowerCase();
  return knownIds.includes(id) ? id : fallback;
}

export function startRouter(knownIds, onChange) {
  const handle = () => onChange(parseRoute(window.location.hash, knownIds));
  window.addEventListener('hashchange', handle);
  handle();
}
