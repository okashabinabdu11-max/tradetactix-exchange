import { SECTIONS } from './data/plan.js';
import { startRouter } from './router.js';
import { renderShell, setActiveNav } from './ui/shell.js';
import { dashboardPage } from './pages/dashboard.js';
import { riskPage } from './pages/risk.js';
import { plannedPage, morePage, systemPage } from './pages/other.js';

const builtPages = {
  dashboard: dashboardPage,
  risk: riskPage,
  system: systemPage,
  more: morePage,
};

const routeIds = [...SECTIONS.map((s) => s.id), 'more'];

const root = document.getElementById('app');
const main = renderShell(root);
let cleanup = null;

startRouter(routeIds, (routeId) => {
  if (cleanup) cleanup();
  const page = builtPages[routeId] ? builtPages[routeId]() : plannedPage(routeId);
  main.innerHTML = page.html;
  cleanup = page.mount ? page.mount(main) : null;
  document.title = `${page.title} | TradeTactix AI`;
  setActiveNav(root, routeId);
  window.scrollTo(0, 0);
});
