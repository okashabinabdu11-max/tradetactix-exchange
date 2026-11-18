import { themeToggle } from './theme.js';
import { SECTIONS, CURRENT_STAGE } from '../data/plan.js';
import { appConfig } from '../config.js';
import { icon } from './icons.js';

const MOBILE_TABS = ['dashboard', 'signals', 'risk', 'journal'];

const brand = `
  <a class="brand" href="#/home" aria-label="TradeTactix AI home">
    <span class="brand-mark" aria-hidden="true">T</span>
    <span class="brand-name">TradeTactix <span class="brand-ai">AI</span></span>
  </a>`;

function navLink(section) {
  const planned = section.stage > CURRENT_STAGE ? `<span class="nav-stage">Stage ${section.stage}</span>` : '';
  return `<a class="nav-link" href="#/${section.id}" data-nav="${section.id}" ${section.adminOnly ? 'data-admin hidden' : ''}>${icon(section.icon)}<span>${section.label}</span>${planned}</a>`;
}

export function renderShell(root) {
  const tabs = MOBILE_TABS.map((id) => SECTIONS.find((s) => s.id === id));
  const tradingChip = appConfig.liveTradingEnabled
    ? '<span class="chip chip-sell">Live trading on</span>'
    : `<a class="chip chip-lock" href="#/system" title="Live trading is locked">${icon('lock', 14)}<span>Live trading locked</span></a>`;

  root.innerHTML = `
    <a class="skip-link" href="#main">Skip to content</a>
    <aside class="sidebar" aria-label="Sections">
      ${brand}
      <nav class="side-nav">${SECTIONS.map(navLink).join('')}</nav>
    </aside>
    <div class="frame">
      <header class="topbar">
        <div class="topbar-brand">${brand}</div>
        <div class="topbar-instrument"><strong>XAUUSD</strong><span>Gold vs US dollar</span></div>
        ${tradingChip}
        ${themeToggle()}
      </header>
      <main id="main" class="main" tabindex="-1"></main>
    </div>
    <nav class="tabbar" aria-label="Main sections">
      ${tabs.map((s) => `<a class="tab" href="#/${s.id}" data-nav="${s.id}">${icon(s.icon, 22)}<span>${s.label}</span></a>`).join('')}
      <a class="tab" href="#/more" data-nav="more">${icon('more', 22)}<span>More</span></a>
    </nav>`;

  return root.querySelector('#main');
}

/** Shows administrator-only links to administrators. Access itself is enforced by the database. */
export function setAdminNav(root, isAdmin) {
  root.querySelectorAll('[data-admin]').forEach((el) => { el.hidden = !isAdmin; });
}

export function setActiveNav(root, routeId) {
  const inTabs = MOBILE_TABS.includes(routeId);
  root.querySelectorAll('[data-nav]').forEach((el) => {
    const id = el.dataset.nav;
    const isTab = el.classList.contains('tab');
    const active = id === routeId || (isTab && id === 'more' && !inTabs);
    el.classList.toggle('is-active', active);
    if (active) el.setAttribute('aria-current', 'page');
    else el.removeAttribute('aria-current');
  });
}
