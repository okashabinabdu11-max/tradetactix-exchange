import { SECTIONS } from './data/plan.js';
import { startRouter } from './router.js';
import { renderShell, setActiveNav } from './ui/shell.js';
import { dashboardPage } from './pages/dashboard.js';
import { riskPage } from './pages/risk.js';
import { plannedPage, morePage, systemPage } from './pages/other.js';
import { profilePage } from './pages/profile.js';
import { session } from './state/session.js';
import { initBackend } from './services/backend.js';

const builtPages = {
  dashboard: dashboardPage,
  risk: riskPage,
  system: systemPage,
  profile: profilePage,
  more: morePage,
};

const routeIds = [...SECTIONS.map((s) => s.id), 'more'];

const root = document.getElementById('app');
const main = renderShell(root);
let cleanup = null;
let currentRoute = null;

function render(routeId, { keepScroll = false } = {}) {
  currentRoute = routeId;
  if (cleanup) cleanup();
  const page = builtPages[routeId] ? builtPages[routeId]() : plannedPage(routeId);
  main.innerHTML = page.html;
  cleanup = page.mount ? page.mount(main) : null;
  document.title = `${page.title} | TradeTactix AI`;
  setActiveNav(root, routeId);
  if (!keepScroll) window.scrollTo(0, 0);
}

// Create the backend client before routing: after an email confirmation link
// the sign-in details arrive in the URL hash and must be read first.
initBackend();
startRouter(routeIds, render);

// Signing in or out changes what pages show, so draw the current page again.
session.subscribe(() => render(currentRoute, { keepScroll: true }));
