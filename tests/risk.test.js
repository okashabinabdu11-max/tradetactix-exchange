import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateTrade } from '../src/lib/risk.js';

const base = { direction: 'buy', balance: 1000, riskPercent: 1, entry: 2650, stop: 2645, target: 2665 };
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} is not close to ${b}`);

test('buy at exactly 1:3 passes and is sized to the risk limit', () => {
  const r = evaluateTrade(base);
  assert.equal(r.ok, true);
  near(r.rewardToRisk, 3);
  assert.equal(r.meetsMinimum, true);
  assert.equal(r.allowed, true);
  // $10 budget / ($5 stop x 100 oz) = 0.02 lot
  assert.equal(r.lots, 0.02);
  near(r.actualRisk, 10);
  near(r.potentialReward, 30);
});

test('trade below 1:3 is rejected and the minimum target is given', () => {
  const r = evaluateTrade({ ...base, target: 2660 });
  near(r.rewardToRisk, 2);
  assert.equal(r.meetsMinimum, false);
  assert.equal(r.allowed, false);
  near(r.minimumTarget, 2665);
});

test('sell mirrors buy', () => {
  const r = evaluateTrade({ ...base, direction: 'sell', stop: 2655, target: 2630 });
  assert.equal(r.ok, true);
  near(r.rewardToRisk, 4);
  near(r.minimumTarget, 2635);
  assert.equal(r.allowed, true);
});

test('lot size rounds down, never up past the risk limit', () => {
  // $10 / ($3 x 100) = 0.0333 -> 0.03
  const r = evaluateTrade({ ...base, stop: 2647, target: 2660 });
  assert.equal(r.lots, 0.03);
  assert.ok(r.actualRisk <= r.riskBudget + 1e-9);
});

test('floating point prices still count as 1:3', () => {
  const r = evaluateTrade({ ...base, entry: 2650.1, stop: 2649.8, target: 2651 });
  assert.equal(r.meetsMinimum, true);
});

test('stop too wide for the minimum lot blocks the trade', () => {
  const r = evaluateTrade({ ...base, balance: 100, stop: 2630, target: 2710 });
  assert.equal(r.belowMinLot, true);
  assert.equal(r.lots, 0);
  assert.equal(r.allowed, false);
  near(r.minLotRisk, 20);
});

test('wrong-side stop or target is an input error', () => {
  assert.equal(evaluateTrade({ ...base, stop: 2655 }).ok, false);
  assert.equal(evaluateTrade({ ...base, target: 2640 }).ok, false);
  assert.equal(evaluateTrade({ ...base, direction: 'sell' }).ok, false);
});

test('missing or invalid numbers are input errors', () => {
  assert.equal(evaluateTrade({ ...base, entry: NaN }).ok, false);
  assert.equal(evaluateTrade({ ...base, balance: 0 }).ok, false);
  assert.equal(evaluateTrade({ ...base, riskPercent: 150 }).ok, false);
  assert.equal(evaluateTrade({ ...base, direction: 'hold' }).ok, false);
});

test('risk above 2% raises a warning but is still calculated', () => {
  const r = evaluateTrade({ ...base, riskPercent: 5 });
  assert.equal(r.ok, true);
  assert.equal(r.warnings.length, 1);
});
