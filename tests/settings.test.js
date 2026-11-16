import test from 'node:test';
import assert from 'node:assert/strict';
import { validateRiskSettings, fromRow, toRow, DEFAULT_RISK_SETTINGS } from '../src/lib/riskSettings.js';
import { evaluateTrade } from '../src/lib/risk.js';

const good = { riskPercent: '1.5', minRewardToRisk: '4', maxTradesPerDay: '2', maxDailyLossPercent: '3' };

test('valid limits are accepted and converted to numbers', () => {
  const r = validateRiskSettings(good);
  assert.equal(r.ok, true);
  assert.deepEqual(r.values, { riskPercent: 1.5, minRewardToRisk: 4, maxTradesPerDay: 2, maxDailyLossPercent: 3 });
});

test('defaults are valid', () => {
  assert.equal(validateRiskSettings(DEFAULT_RISK_SETTINGS).ok, true);
});

test('minimum reward-to-risk can never be saved below 1:3', () => {
  assert.equal(validateRiskSettings({ ...good, minRewardToRisk: '2.9' }).ok, false);
  assert.equal(validateRiskSettings({ ...good, minRewardToRisk: '3' }).ok, true);
});

test('out-of-range and empty values are rejected', () => {
  assert.equal(validateRiskSettings({ ...good, riskPercent: '0' }).ok, false);
  assert.equal(validateRiskSettings({ ...good, riskPercent: '' }).ok, false);
  assert.equal(validateRiskSettings({ ...good, maxTradesPerDay: '2.5' }).ok, false);
  assert.equal(validateRiskSettings({ ...good, maxTradesPerDay: '0' }).ok, false);
  assert.equal(validateRiskSettings({ ...good, maxDailyLossPercent: '101' }).ok, false);
});

test('database row mapping round-trips', () => {
  const values = validateRiskSettings(good).values;
  const row = toRow(values, 'user-1');
  assert.equal(row.user_id, 'user-1');
  assert.deepEqual(fromRow(row), values);
  // Postgres numerics arrive as strings
  assert.equal(fromRow({ risk_percent: '1.50', min_reward_to_risk: '3.00', max_trades_per_day: 3, max_daily_loss_percent: '3.00' }).riskPercent, 1.5);
});

test('a stricter personal minimum is applied by the calculator', () => {
  const trade = { direction: 'buy', balance: 1000, riskPercent: 1, entry: 2650, stop: 2645, target: 2665 };
  assert.equal(evaluateTrade(trade).allowed, true); // 1:3 passes the plan
  const strict = evaluateTrade({ ...trade, minRewardToRisk: 4 });
  assert.equal(strict.allowed, false);
  assert.equal(strict.minimumTarget, 2670);
});

test('a looser personal minimum is ignored', () => {
  const r = evaluateTrade({ direction: 'buy', balance: 1000, riskPercent: 1, entry: 2650, stop: 2645, target: 2660, minRewardToRisk: 2 });
  assert.equal(r.minimumRatio, 3);
  assert.equal(r.allowed, false);
});
