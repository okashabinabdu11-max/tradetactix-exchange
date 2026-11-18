import test from 'node:test';
import assert from 'node:assert/strict';
import { passwordChecks, isStrongPassword } from '../src/lib/password.js';
import { winRateWindows } from '../src/lib/journal.js';

test('strong password needs length, upper, lower, number and symbol', () => {
  assert.equal(isStrongPassword('Gold#2026x'), true);
  for (const weak of ['short1!A', 'alllowercase1!', 'ALLUPPER1!', 'NoNumber!!', 'NoSymbol123', '']) {
    assert.equal(isStrongPassword(weak), weak === 'short1!A', weak); // 'short1!A' is exactly 8 and complete
  }
  assert.deepEqual(passwordChecks('abc').map((c) => c.ok), [false, false, true, false, false]);
});

test('win rate windows count only trades closed inside each window', () => {
  const now = Date.parse('2026-11-18T12:00:00Z');
  const t = (daysAgo, exit) => ({ direction: 'buy', lots: 0.01, entryPrice: 2650, stopLoss: 2645, takeProfit: 2665, openedAt: new Date(now - daysAgo * 86400e3 - 3600e3).toISOString(), closedAt: new Date(now - daysAgo * 86400e3).toISOString(), exitPrice: exit });
  const trades = [t(1, 2665), t(2, 2645), t(10, 2665), t(40, 2645), { ...t(0, null), closedAt: null, exitPrice: null }];
  const [w, m, a] = winRateWindows(trades, 3, now);
  assert.deepEqual([w.closed, w.wins, w.losses, Math.round(w.winRate)], [2, 1, 1, 50]);
  assert.deepEqual([m.closed, m.wins, m.losses, Math.round(m.winRate)], [3, 2, 1, 67]);
  assert.deepEqual([a.closed, a.open, a.wins, a.losses], [4, 1, 2, 2]);
});
