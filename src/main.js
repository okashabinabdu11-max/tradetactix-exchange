import { SECTIONS } from './data/plan.js';
import { startRouter } from './router.js';
import { renderShell, setActiveNav } from './ui/shell.js';
import { dashboardPage } from './pages/dashboard.js';
import { riskPage } from './pages/risk.js';
import { plannedPage, morePage, systemPage } from './pages/other.js';
import { profilePage } from './pages/profile.js';
import { chartPage } from './pages/chart.js';
import { signalsPage, analysisPage } from './pages/signals.js';
import { journalPage } from './pages/journal.js';
import { historyPage, analyticsPage, calendarPage, disciplinePage } from './pages/insights.js';
import { session, setSession } from './state/session.js';
import { initBackend } from './services/backend.js';

const builtPages = {
  dashboard: dashboardPage,
  risk: riskPage,
  system: systemPage,
  profile: profilePage,
  chart: chartPage,
  signals: signalsPage,
  analysis: analysisPage,
  journal: journalPage,
  history: historyPage,
  analytics: analyticsPage,
  calendar: calendarPage,
  discipline: disciplinePage,
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

// A confirmation or Google link that failed comes back with the reason in the
// address. Keep the reason, show it on the Profile page, and tidy the address.
function readAuthError() {
  const fromHash = new URLSearchParams(window.location.hash.replace(/^#\/?/, ''));
  const fromQuery = new URLSearchParams(window.location.search);
  const text = fromHash.get('error_description') || fromQuery.get('error_description');
  if (!text) return;
  const expired = /expired|invalid/i.test(text);
  setSession({
    authNotice: expired
      ? 'That link has expired or was already used. Sign in, or create the account again to get a new link.'
      : `Sign-in did not finish: ${text}`,
  }, { silent: true });
  window.history.replaceState(null, '', `${window.location.pathname}#/profile`);
}
readAuthError();

// Create the backend client before routing: after an email confirmation link
// the sign-in details arrive in the URL hash and must be read first.
initBackend();
startRouter(routeIds, render);

// Signing in or out changes what pages show, so draw the current page again.
session.subscribe(() => render(currentRoute, { keepScroll: true }));
