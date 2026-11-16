import test from 'node:test';
import assert from 'node:assert/strict';
import { tradeMetrics, summarize, dailyResults, monthGrid, validateTrade, fromTradeRow, toTradeRow } from '../src/lib/journal.js';

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} is not close to ${b}`);
const plan = { level4h: true, liquidity1h: true, retest15m: true, confirm5m: false };
const win = { ...plan, direction: 'buy', entryPrice: 2650, stopLoss: 2645, takeProfit: 2665, exitPrice: 2665, lots: 0.02, openedAt: '2026-11-10T09:00:00Z', closedAt: '2026-11-10T12:00:00Z', pnl: null };
const loss = { ...plan, direction: 'sell', entryPrice: 2700, stopLoss: 2705, takeProfit: 2685, exitPrice: 2705, lots: 0.02, openedAt: '2026-11-11T09:00:00Z', closedAt: '2026-11-11T12:00:00Z', pnl: null };
const open = { ...plan, direction: 'buy', entryPrice: 2600, stopLoss: 2595, takeProfit: 2615, exitPrice: null, lots: 0.01, openedAt: '2026-11-12T09:00:00Z', closedAt: null, pnl: null };

test('winning buy: P&L, R multiple and plan check', () => {
  const m = tradeMetrics(win);
  near(m.pnl, 30); // 15 x 0.02 x 100
  near(m.rMultiple, 3);
  near(m.plannedRR, 3);
  assert.equal(m.result, 'win');
  assert.equal(m.followedPlan, true);
});

test('losing sell stopped out is -1R', () => {
  const m = tradeMetrics(loss);
  near(m.pnl, -10);
  near(m.rMultiple, -1);
  assert.equal(m.result, 'loss');
});

test('broker net result overrides the computed gross', () => {
  const m = tradeMetrics({ ...win, pnl: 28.6 });
  near(m.pnl, 28.6);
  near(m.grossPnl, 30);
});

test('open trade has no result', () => {
  const m = tradeMetrics(open);
  assert.equal(m.closed, false);
  assert.equal(m.result, 'open');
  assert.equal(m.pnl, null);
});

test('off-plan reasons are listed', () => {
  const m = tradeMetrics({ ...win, retest15m: false, takeProfit: 2660 });
  assert.equal(m.followedPlan, false);
  assert.deepEqual(m.offPlan, ['No 15M retest', 'Planned below 1:3']);
  assert.deepEqual(tradeMetrics({ ...win, takeProfit: null }).offPlan, ['No take-profit']);
});

test('summary statistics', () => {
  const s = summarize([win, loss, open]);
  assert.equal(s.total, 3);
  assert.equal(s.closed, 2);
  assert.equal(s.open, 1);
  near(s.netPnl, 20);
  near(s.winRate, 50);
  near(s.profitFactor, 3);
  near(s.averageR, 1);
  near(s.averageWin, 30);
  near(s.averageLoss, -10);
  near(s.planFollowedRate, 100);
});

test('summary of nothing has no invented numbers', () => {
  const s = summarize([]);
  assert.equal(s.netPnl, 0);
  assert.equal(s.winRate, null);
  assert.equal(s.profitFactor, null);
  assert.equal(s.averageR, null);
  assert.equal(summarize([win]).profitFactor, null); // no losses yet
});

test('daily results group closed trades by closing day', () => {
  const key = (iso) => iso.slice(0, 10);
  const days = dailyResults([win, { ...win, pnl: -5 }, loss, open], key);
  assert.equal(days.size, 2);
  near(days.get('2026-11-10').pnl, 25);
  assert.equal(days.get('2026-11-10').count, 2);
  near(days.get('2026-11-11').pnl, -10);
});

test('month grid starts on Monday and covers the month', () => {
  const weeks = monthGrid(2026, 10); // November 2026 starts on a Sunday
  assert.equal(weeks[0][6].day, 1);
  assert.equal(weeks[0][0], null);
  assert.equal(weeks.flat().filter(Boolean).length, 30);
  assert.equal(weeks.flat().filter(Boolean).at(-1).key, '2026-11-30');
  assert.ok(weeks.every((w) => w.length === 7));
});

const form = { direction: 'buy', openedAt: '2026-11-10T09:00', entryPrice: '2650', stopLoss: '2645', takeProfit: '2665', lots: '0.02', exitPrice: '', closedAt: '', pnl: '', notes: ' retest held ', level4h: true };

test('valid open trade passes validation', () => {
  const r = validateTrade(form);
  assert.equal(r.ok, true);
  assert.equal(r.values.exitPrice, null);
  assert.equal(r.values.notes, 'retest held');
  assert.equal(r.values.liquidity1h, false);
});

test('validation catches wrong sides and half-closed trades', () => {
  assert.equal(validateTrade({ ...form, stopLoss: '2655' }).ok, false);
  assert.equal(validateTrade({ ...form, takeProfit: '2640' }).ok, false);
  assert.equal(validateTrade({ ...form, exitPrice: '2660' }).ok, false);
  assert.equal(validateTrade({ ...form, closedAt: '2026-11-10T10:00' }).ok, false);
  assert.equal(validateTrade({ ...form, exitPrice: '2660', closedAt: '2026-11-09T10:00' }).ok, false);
  assert.equal(validateTrade({ ...form, pnl: '12' }).ok, false);
  assert.equal(validateTrade({ ...form, lots: '' }).ok, false);
  assert.equal(validateTrade({ ...form, exitPrice: '2660', closedAt: '2026-11-10T10:00', pnl: '-3.5' }).ok, true);
});

test('database row mapping round-trips', () => {
  const v = validateTrade({ ...form, exitPrice: '2660', closedAt: '2026-11-10T10:00' }).values;
  const row = toTradeRow(v);
  assert.equal(row.entry_price, 2650);
  const back = fromTradeRow({ ...row, id: 'abc', entry_price: '2650.000', lots: '0.02' });
  assert.equal(back.entryPrice, 2650);
  assert.equal(back.lots, 0.02);
  assert.equal(back.takeProfit, 2665);
  assert.equal(back.pnl, null);
});

// ---------- Analytics ----------
import { equityCurve, extremes, breakdown, disciplineReport } from '../src/lib/journal.js';

const mk = (o) => ({
  direction: 'buy', lots: 0.01, entryPrice: 2650, stopLoss: 2645, takeProfit: 2665, exitPrice: null, closedAt: null, pnl: null,
  openedAt: new Date(2026, 10, 2, 10).toISOString(), level4h: true, liquidity1h: true, retest15m: true, confirm5m: false, ...o,
});
const closedAt = (day, hour = 12) => new Date(2026, 10, day, hour).toISOString();
const sample = [
  mk({ exitPrice: 2665, closedAt: closedAt(2) }), // +15
  mk({ exitPrice: 2645, closedAt: closedAt(3), openedAt: new Date(2026, 10, 3, 9).toISOString() }), // -5
  mk({ exitPrice: 2645, closedAt: closedAt(4), openedAt: new Date(2026, 10, 4, 9).toISOString(), direction: 'buy', retest15m: false }), // -5
  mk({ exitPrice: 2660, closedAt: closedAt(5), openedAt: new Date(2026, 10, 5, 9).toISOString(), takeProfit: 2660 }), // +10, planned 1:2
  mk({ openedAt: new Date(2026, 10, 5, 11).toISOString() }), // open
];

test('equity curve runs in closing order and finds the deepest drawdown', () => {
  const { points, maxDrawdown } = equityCurve([...sample].reverse());
  assert.deepEqual(points.map((p) => Math.round(p.total)), [15, 10, 5, 15]);
  assert.equal(Math.round(maxDrawdown), 10);
});

test('equity curve of no closed trades is empty', () => {
  assert.deepEqual(equityCurve([mk({})]), { points: [], maxDrawdown: 0 });
  assert.deepEqual(extremes([]), { best: null, worst: null, expectancy: null });
});

test('extremes and expectancy', () => {
  const e = extremes(sample);
  assert.equal(Math.round(e.best), 15);
  assert.equal(Math.round(e.worst), -5);
  assert.equal(e.expectancy.toFixed(2), '3.75');
});

test('breakdown groups closed trades only', () => {
  const rows = breakdown(sample, (t, m) => (m.followedPlan ? 'On plan' : 'Off plan'));
  const on = rows.find((r) => r.label === 'On plan');
  const off = rows.find((r) => r.label === 'Off plan');
  assert.equal(on.count, 2);
  assert.equal(off.count, 2);
  assert.equal(Math.round(on.pnl), 10);
  assert.equal(on.winRate, 50);
});

test('discipline report scores each rule and flags busy days', () => {
  const r = disciplineReport(sample, { minRewardToRisk: 3, maxTradesPerDay: 1 });
  const rule = (id) => r.rules.find((x) => x.id === id);
  assert.equal(r.total, 5);
  assert.equal(rule('level4h').passed, 5);
  assert.equal(rule('retest15m').passed, 4);
  assert.equal(rule('minrr').passed, 4);
  assert.equal(rule('perday').passed, 3); // two trades opened on the 5th
  assert.equal(r.overDays.length, 1);
  assert.equal(r.overDays[0].count, 2);
  assert.equal(r.score.toFixed(0), '84'); // 21 of 25 checks
  assert.equal(r.fullyOnPlan, 2);
});

test('discipline report without trades or a daily limit', () => {
  const empty = disciplineReport([], {});
  assert.equal(empty.score, null);
  assert.equal(disciplineReport(sample, {}).rules.length, 4);
});
