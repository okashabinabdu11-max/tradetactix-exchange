// Trading-journal maths: per-trade metrics, summary statistics and the
// calendar. Pure functions, unit tested. Every number comes from trades the
// user recorded; nothing here invents data.

import { MIN_REWARD_TO_RISK, XAUUSD_CONTRACT_OZ } from './risk.js';

const EPSILON = 1e-9;
const sign = (t) => (t.direction === 'buy' ? 1 : -1);
const has = (v) => v !== null && v !== undefined && !Number.isNaN(v);

export function tradeMetrics(t, minRewardToRisk = MIN_REWARD_TO_RISK) {
  const riskPerOz = Math.abs(t.entryPrice - t.stopLoss);
  const plannedRR = has(t.takeProfit) && riskPerOz > 0 ? Math.abs(t.takeProfit - t.entryPrice) / riskPerOz : null;
  const closed = has(t.exitPrice) && Boolean(t.closedAt);

  let grossPnl = null;
  let pnl = null;
  let rMultiple = null;
  let result = 'open';
  if (closed) {
    const move = (t.exitPrice - t.entryPrice) * sign(t);
    grossPnl = move * t.lots * XAUUSD_CONTRACT_OZ;
    pnl = has(t.pnl) ? t.pnl : grossPnl; // prefer the broker's net figure when given
    rMultiple = riskPerOz > 0 ? move / riskPerOz : null;
    result = pnl > EPSILON ? 'win' : pnl < -EPSILON ? 'loss' : 'breakeven';
  }

  const offPlan = [];
  if (!t.level4h) offPlan.push('No 4H level');
  if (!t.liquidity1h) offPlan.push('No 1H liquidity');
  if (!t.retest15m) offPlan.push('No 15M retest');
  if (plannedRR === null) offPlan.push('No take-profit');
  else if (plannedRR < minRewardToRisk - EPSILON) offPlan.push(`Planned below 1:${minRewardToRisk}`);

  return { riskPerOz, plannedRR, closed, grossPnl, pnl, rMultiple, result, offPlan, followedPlan: offPlan.length === 0 };
}

export function summarize(trades, minRewardToRisk = MIN_REWARD_TO_RISK) {
  const all = trades.map((t) => tradeMetrics(t, minRewardToRisk));
  const closed = all.filter((m) => m.closed);
  const wins = closed.filter((m) => m.result === 'win');
  const losses = closed.filter((m) => m.result === 'loss');
  const sum = (list, key) => list.reduce((acc, m) => acc + m[key], 0);
  const grossProfit = sum(wins, 'pnl');
  const grossLoss = Math.abs(sum(losses, 'pnl'));
  const withR = closed.filter((m) => m.rMultiple !== null);

  return {
    total: all.length,
    open: all.length - closed.length,
    closed: closed.length,
    wins: wins.length,
    losses: losses.length,
    breakeven: closed.length - wins.length - losses.length,
    netPnl: sum(closed, 'pnl'),
    winRate: closed.length ? (wins.length / closed.length) * 100 : null,
    // Undefined without at least one losing trade.
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : null,
    averageWin: wins.length ? grossProfit / wins.length : null,
    averageLoss: losses.length ? -grossLoss / losses.length : null,
    averageR: withR.length ? sum(withR, 'rMultiple') / withR.length : null,
    planFollowedRate: all.length ? (all.filter((m) => m.followedPlan).length / all.length) * 100 : null,
  };
}

const pad = (n) => String(n).padStart(2, '0');

/** YYYY-MM-DD in the device's own time zone. */
export function localDateKey(dateLike) {
  const d = new Date(dateLike);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Net result and trade count per closing day. */
export function dailyResults(trades, keyFn = localDateKey) {
  const days = new Map();
  for (const t of trades) {
    const m = tradeMetrics(t);
    if (!m.closed) continue;
    const key = keyFn(t.closedAt);
    const day = days.get(key) || { pnl: 0, count: 0 };
    day.pnl += m.pnl;
    day.count += 1;
    days.set(key, day);
  }
  return days;
}

/** Weeks of a month, Monday first. Cells outside the month are null. */
export function monthGrid(year, monthIndex) {
  const first = new Date(year, monthIndex, 1);
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const lead = (first.getDay() + 6) % 7;
  const cells = Array(lead).fill(null);
  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push({ day, key: `${year}-${pad(monthIndex + 1)}-${pad(day)}` });
  }
  while (cells.length % 7) cells.push(null);
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

const num = (v) => (v === '' || v === null || v === undefined ? null : Number(v));
const validDate = (v) => v && !Number.isNaN(new Date(v).getTime());

export function validateTrade(input) {
  const errors = [];
  const v = {
    direction: input.direction,
    openedAt: validDate(input.openedAt) ? new Date(input.openedAt).toISOString() : null,
    closedAt: validDate(input.closedAt) ? new Date(input.closedAt).toISOString() : null,
    entryPrice: num(input.entryPrice),
    stopLoss: num(input.stopLoss),
    takeProfit: num(input.takeProfit),
    exitPrice: num(input.exitPrice),
    lots: num(input.lots),
    pnl: num(input.pnl),
    level4h: Boolean(input.level4h),
    liquidity1h: Boolean(input.liquidity1h),
    retest15m: Boolean(input.retest15m),
    confirm5m: Boolean(input.confirm5m),
    notes: String(input.notes || '').trim().slice(0, 4000),
  };
  const positive = (n) => typeof n === 'number' && Number.isFinite(n) && n > 0;

  if (v.direction !== 'buy' && v.direction !== 'sell') errors.push('Choose BUY or SELL.');
  if (!v.openedAt) errors.push('Enter when the trade was opened.');
  if (!positive(v.entryPrice)) errors.push('Enter the entry price.');
  if (!positive(v.stopLoss)) errors.push('Enter the stop-loss price.');
  if (!positive(v.lots)) errors.push('Enter the position size in lots.');
  if (v.takeProfit !== null && !positive(v.takeProfit)) errors.push('Take-profit must be a price above zero.');
  if (v.pnl !== null && !Number.isFinite(v.pnl)) errors.push('Net result must be a number.');
  if (errors.length) return { ok: false, errors, values: v };

  const buy = v.direction === 'buy';
  if (buy ? v.stopLoss >= v.entryPrice : v.stopLoss <= v.entryPrice) {
    errors.push(`For a ${buy ? 'BUY' : 'SELL'}, the stop-loss must be ${buy ? 'below' : 'above'} the entry.`);
  }
  if (v.takeProfit !== null && (buy ? v.takeProfit <= v.entryPrice : v.takeProfit >= v.entryPrice)) {
    errors.push(`For a ${buy ? 'BUY' : 'SELL'}, the take-profit must be ${buy ? 'above' : 'below'} the entry.`);
  }

  const hasExit = v.exitPrice !== null;
  const hasClose = Boolean(input.closedAt);
  if (hasExit !== hasClose) errors.push('To close a trade, enter both the exit price and the closing time.');
  if (hasExit && !positive(v.exitPrice)) errors.push('Exit price must be above zero.');
  if (hasClose && !v.closedAt) errors.push('The closing time is not a valid date.');
  if (v.closedAt && v.openedAt && new Date(v.closedAt) < new Date(v.openedAt)) errors.push('The closing time is before the opening time.');
  if (!hasExit && v.pnl !== null) errors.push('Net result can only be entered for a closed trade.');

  return { ok: errors.length === 0, errors, values: v };
}

const n = (x) => (x === null || x === undefined ? null : Number(x));

export const fromTradeRow = (row) => ({
  id: row.id,
  direction: row.direction,
  openedAt: row.opened_at,
  closedAt: row.closed_at,
  entryPrice: n(row.entry_price),
  stopLoss: n(row.stop_loss),
  takeProfit: n(row.take_profit),
  exitPrice: n(row.exit_price),
  lots: n(row.lots),
  pnl: n(row.pnl),
  level4h: Boolean(row.level_4h),
  liquidity1h: Boolean(row.liquidity_1h),
  retest15m: Boolean(row.retest_15m),
  confirm5m: Boolean(row.confirm_5m),
  notes: row.notes || '',
  source: row.source || 'manual',
});

export const toTradeRow = (v) => ({
  direction: v.direction,
  opened_at: v.openedAt,
  closed_at: v.closedAt,
  entry_price: v.entryPrice,
  stop_loss: v.stopLoss,
  take_profit: v.takeProfit,
  exit_price: v.exitPrice,
  lots: v.lots,
  pnl: v.pnl,
  level_4h: v.level4h,
  liquidity_1h: v.liquidity1h,
  retest_15m: v.retest15m,
  confirm_5m: v.confirm5m,
  notes: v.notes,
});

// ---------- Analytics ----------

/** Closed trades in closing order with the running total, plus the deepest fall from a peak. */
export function equityCurve(trades) {
  const closed = trades
    .map((t) => ({ t, m: tradeMetrics(t) }))
    .filter((x) => x.m.closed)
    .sort((a, b) => new Date(a.t.closedAt) - new Date(b.t.closedAt));
  let total = 0;
  let peak = 0;
  let maxDrawdown = 0;
  const points = closed.map(({ t, m }) => {
    total += m.pnl;
    peak = Math.max(peak, total);
    maxDrawdown = Math.max(maxDrawdown, peak - total);
    return { closedAt: t.closedAt, pnl: m.pnl, total };
  });
  return { points, maxDrawdown };
}

/** Largest win, largest loss and average result per closed trade. */
export function extremes(trades) {
  const pnls = trades.map((t) => tradeMetrics(t)).filter((m) => m.closed).map((m) => m.pnl);
  if (!pnls.length) return { best: null, worst: null, expectancy: null };
  return {
    best: Math.max(...pnls),
    worst: Math.min(...pnls),
    expectancy: pnls.reduce((a, b) => a + b, 0) / pnls.length,
  };
}

/** Closed-trade results grouped by any label, e.g. session or direction. */
export function breakdown(trades, labelFn) {
  const groups = new Map();
  for (const t of trades) {
    const m = tradeMetrics(t);
    if (!m.closed) continue;
    const label = labelFn(t, m);
    const g = groups.get(label) || { label, count: 0, wins: 0, pnl: 0 };
    g.count += 1;
    g.pnl += m.pnl;
    if (m.result === 'win') g.wins += 1;
    groups.set(label, g);
  }
  return [...groups.values()].map((g) => ({ ...g, winRate: (g.wins / g.count) * 100 }));
}

/** How often each rule of the plan was kept, and the days with too many trades. */
export function disciplineReport(trades, { minRewardToRisk = MIN_REWARD_TO_RISK, maxTradesPerDay = null, keyFn = localDateKey } = {}) {
  const total = trades.length;
  const count = (fn) => trades.filter(fn).length;
  const metrics = new Map(trades.map((t) => [t, tradeMetrics(t, minRewardToRisk)]));

  const perDay = new Map();
  for (const t of trades) {
    const key = keyFn(t.openedAt);
    perDay.set(key, (perDay.get(key) || 0) + 1);
  }
  const overDays = maxTradesPerDay
    ? [...perDay.entries()].filter(([, n]) => n > maxTradesPerDay).map(([key, n]) => ({ key, count: n })).sort((a, b) => (a.key < b.key ? 1 : -1))
    : [];
  const overKeys = new Set(overDays.map((d) => d.key));

  const rules = [
    { id: 'level4h', label: 'Traded from a 4H level', passed: count((t) => t.level4h) },
    { id: 'liquidity1h', label: 'Marked 1H liquidity', passed: count((t) => t.liquidity1h) },
    { id: 'retest15m', label: 'Waited for the 15M retest', passed: count((t) => t.retest15m) },
    { id: 'minrr', label: `Planned at least 1:${minRewardToRisk}`, passed: count((t) => { const m = metrics.get(t); return m.plannedRR !== null && m.plannedRR >= minRewardToRisk - EPSILON; }) },
  ];
  if (maxTradesPerDay) {
    rules.push({ id: 'perday', label: `Stayed within ${maxTradesPerDay} trade${maxTradesPerDay === 1 ? '' : 's'} a day`, passed: count((t) => !overKeys.has(keyFn(t.openedAt))) });
  }
  const checks = rules.length * total;
  const passed = rules.reduce((a, r) => a + r.passed, 0);
  return {
    total,
    rules: rules.map((r) => ({ ...r, total, rate: total ? (r.passed / total) * 100 : null })),
    score: checks ? (passed / checks) * 100 : null,
    fullyOnPlan: count((t) => metrics.get(t).followedPlan && !overKeys.has(keyFn(t.openedAt))),
    overDays,
  };
}
