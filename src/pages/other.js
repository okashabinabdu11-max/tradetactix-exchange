import { SECTIONS, STAGES, CURRENT_STAGE, STAGE_OF, sectionById } from '../data/plan.js';
import { appConfig, isSupabaseConfigured } from '../config.js';
import { icon } from '../ui/icons.js';
import { session } from '../state/session.js';
import { marketState } from '../services/market.js';

/** Honest holding page for a section that has not been built yet. */
export function plannedPage(id) {
  const section = sectionById(id);
  const stage = STAGES.find((s) => s.n === section.stage);
  return {
    title: section.label,
    html: `
      <header class="page-head">
        <h1>${section.label}</h1>
      </header>
      <section class="panel planned">
        <span class="planned-icon">${icon(section.icon, 28)}</span>
        <h2>Not built yet</h2>
        <p>${section.summary}</p>
        <p class="planned-stage">Arrives in <strong>Stage ${stage.n}</strong>: ${stage.title.toLowerCase()}. Until then this page shows no data, real or sample.</p>
        <a class="button button-quiet" href="#/system">See build progress</a>
      </section>`,
  };
}

export function morePage() {
  return {
    title: 'More',
    html: `
      <header class="page-head"><h1>All sections</h1></header>
      <nav class="panel more-list" aria-label="All sections">
        ${SECTIONS.filter((s) => !s.adminOnly || session.get().entitlement?.is_admin).map((s) => `
          <a href="#/${s.id}">${icon(s.icon)}<span>${s.label}</span>${s.stage > CURRENT_STAGE ? `<span class="nav-stage">Stage ${s.stage}</span>` : ''}</a>`).join('')}
      </nav>`,
  };
}

export function systemPage() {
  const { ready, user } = session.get();
  const dbText = !isSupabaseConfigured ? 'Not set up' : !ready ? 'Checking…' : user ? 'Signed in' : 'Not signed in';
  const row = (label, value, on) => `<li><span class="dot ${on ? 'dot-on' : ''}" aria-hidden="true"></span><span>${label}</span><span class="conn-state">${value}</span></li>`;
  return {
    title: 'System',
    html: `
      <header class="page-head">
        <h1>System</h1>
        <p>What is connected, what is locked, and how far the build has come.</p>
      </header>
      <div class="system">
        <section class="panel" aria-labelledby="sys-status">
          <h2 id="sys-status" class="panel-title">Status</h2>
          <ul class="conn-list">
            ${row('Market data', marketState().status === 'ok' ? 'Connected' : marketState().status === 'error' ? 'Not connected' : 'Open the dashboard to check', marketState().status === 'ok')}
            ${row('Exness MT5', appConfig.brokerConnected ? 'Connected' : 'Not connected', appConfig.brokerConnected)}
            ${row('Database', dbText, Boolean(user))}
            ${row('Live trading', appConfig.liveTradingEnabled ? 'On' : 'Locked', false)}
          </ul>
          <p class="panel-note">Live trading is switched off in the code itself. It can only be enabled in Stage ${STAGE_OF.live}, after the Exness MT5 connection works and you authorise it explicitly.</p>
        </section>
        <section class="panel" aria-labelledby="sys-road">
          <h2 id="sys-road" class="panel-title">Build progress</h2>
          <ol class="roadmap">
            ${STAGES.map((s) => `
              <li class="${s.n < CURRENT_STAGE ? 'is-done' : s.n === CURRENT_STAGE ? 'is-current' : ''}">
                <span class="roadmap-n">${s.n}</span>
                <div><h3>${s.title}</h3><p>${s.detail}</p></div>
                <span class="roadmap-state">${s.n < CURRENT_STAGE ? 'Done' : s.n === CURRENT_STAGE ? 'Current' : 'Planned'}</span>
              </li>`).join('')}
          </ol>
        </section>
      </div>`,
  };
}
