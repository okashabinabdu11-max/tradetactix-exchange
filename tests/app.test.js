import test from 'node:test';
import assert from 'node:assert/strict';
import { isGoldMarketOpen, sessionStatus } from '../src/lib/sessions.js';
import { parseRoute } from '../src/router.js';
import { SECTIONS, STAGES, TIMEFRAMES, SIGNAL_STATES, CURRENT_STAGE } from '../src/data/plan.js';
import { ratio, escapeHtml } from '../src/lib/format.js';

const at = (iso) => new Date(iso);

test('gold market is closed at the weekend', () => {
  assert.equal(isGoldMarketOpen(at('2026-11-14T12:00:00Z')), false); // Saturday
  assert.equal(isGoldMarketOpen(at('2026-11-15T12:00:00Z')), false); // Sunday morning NY
  assert.equal(isGoldMarketOpen(at('2026-11-15T23:30:00Z')), true); // Sunday 18:30 NY
  assert.equal(isGoldMarketOpen(at('2026-11-13T22:30:00Z')), false); // Friday 17:30 NY
});

test('gold market pauses for the daily break', () => {
  assert.equal(isGoldMarketOpen(at('2026-11-17T22:30:00Z')), false); // Tuesday 17:30 NY
  assert.equal(isGoldMarketOpen(at('2026-11-17T14:00:00Z')), true);
});

test('London and New York overlap is detected', () => {
  const s = sessionStatus(at('2026-11-16T14:00:00Z')); // Mon 14:00 London, 09:00 NY
  assert.equal(s.overlap, 'London and New York');
  assert.equal(s.sessions.find((x) => x.id === 'tokyo').open, false);
});

test('session hours follow daylight saving time', () => {
  // July: London is UTC+1, so 07:30 UTC is 08:30 local and the session is open.
  assert.equal(sessionStatus(at('2026-07-15T07:30:00Z')).sessions.find((x) => x.id === 'london').open, true);
  // November: 07:30 UTC is 07:30 local and the session is still closed.
  assert.equal(sessionStatus(at('2026-11-17T07:30:00Z')).sessions.find((x) => x.id === 'london').open, false);
});

test('Tokyo session opens on Monday morning in Asia', () => {
  const s = sessionStatus(at('2026-11-16T01:00:00Z')); // Mon 10:00 Tokyo, Sun 20:00 NY
  assert.equal(s.sessions.find((x) => x.id === 'tokyo').open, true);
});

test('router falls back to the dashboard for unknown routes', () => {
  const ids = SECTIONS.map((s) => s.id);
  assert.equal(parseRoute('#/risk', ids), 'risk');
  assert.equal(parseRoute('#/RISK', ids), 'risk');
  assert.equal(parseRoute('', ids), 'dashboard');
  assert.equal(parseRoute('#/<script>', ids), 'dashboard');
});

test('plan data is consistent', () => {
  assert.deepEqual(TIMEFRAMES.map((t) => t.tf), ['4H', '1H', '15M', '5M']);
  assert.deepEqual(SIGNAL_STATES.map((s) => s.id), ['offline', 'no-setup', 'waiting', 'buy', 'sell']);
  for (const s of SECTIONS) {
    assert.ok(STAGES.some((st) => st.n === s.stage), `${s.id} has a valid stage`);
    if (s.stage > CURRENT_STAGE) assert.ok(s.summary, `${s.id} explains what is planned`);
  }
});

test('formatters', () => {
  assert.equal(ratio(3), '1:3');
  assert.equal(ratio(2.5), '1:2.5');
  assert.equal(ratio(10), '1:10');
  assert.equal(escapeHtml('<b>"x"</b>'), '&lt;b&gt;&quot;x&quot;&lt;/b&gt;');
});

import { CHART_VIEWS, widgetConfig } from '../src/pages/chart.js';

test('chart views follow the plan: 4H line chart, then candles', () => {
  assert.deepEqual(CHART_VIEWS.map((v) => v.interval), ['240', '60', '15', '5']);
  assert.equal(widgetConfig(CHART_VIEWS[0]).style, '2'); // line
  assert.equal(widgetConfig(CHART_VIEWS[2]).style, '1'); // candles
  assert.equal(widgetConfig(CHART_VIEWS[1]).symbol, 'OANDA:XAUUSD');
  assert.equal(widgetConfig(CHART_VIEWS[1]).allow_symbol_change, false);
});
