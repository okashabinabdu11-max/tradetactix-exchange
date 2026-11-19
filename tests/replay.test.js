import test from 'node:test';
import assert from 'node:assert/strict';
import { replaySymbol, pipSize, openTrade, checkCandle, replayStats, startIndex, pipsBetween } from '../src/lib/replay.js';

test('replay pairs: forex, gold, crypto yes; indices no', () => {
  assert.equal(replaySymbol('FX:EURUSD'), 'EUR/USD');
  assert.equal(replaySymbol('OANDA:XAUUSD'), 'XAU/USD');
  assert.equal(replaySymbol('BINANCE:SOLUSDT'), 'SOL/USD');
  assert.equal(replaySymbol('OANDA:NAS100USD'), null);
});

test('pip sizes', () => {
  assert.equal(pipSize('XAU/USD'), 0.1); assert.equal(pipSize('USD/JPY'), 0.01); assert.equal(pipSize('EUR/USD'), 0.0001); assert.equal(pipSize('BTC/USD'), 1);
});

test('buy with SL/TP: TP hit gives pips; both in one candle counts SL', () => {
  const tr = openTrade({ side: 'buy', price: 2000, time: 'a', slPips: 100, tpPips: 300, symbol: 'XAU/USD', id: 1 });
  assert.equal(tr.sl, 1990); assert.equal(tr.tp, 2030);
  assert.equal(checkCandle(tr, { t: 'b', h: 2010, l: 1995 }, 'XAU/USD').result, null);
  const won = checkCandle(tr, { t: 'b', h: 2031, l: 1995 }, 'XAU/USD');
  assert.equal(won.result, 'tp'); assert.equal(won.pips, 300);
  const both = checkCandle(tr, { t: 'b', h: 2031, l: 1989 }, 'XAU/USD');
  assert.equal(both.result, 'sl'); assert.equal(both.pips, -100);
});

test('sell without SL/TP stays open; pips move the right way', () => {
  const tr = openTrade({ side: 'sell', price: 1.1000, time: 'a', symbol: 'EUR/USD', id: 1 });
  assert.equal(checkCandle(tr, { t: 'b', h: 1.2, l: 1.0 }, 'EUR/USD').result, null);
  assert.equal(pipsBetween(tr, 1.0950, 'EUR/USD'), 50);
});

test('stats and start index', () => {
  const s = replayStats([{ result: 'tp', pips: 30 }, { result: 'sl', pips: -10 }, { result: null, pips: null }]);
  assert.deepEqual([s.closed, s.wins, s.losses, s.winRate, s.pips], [2, 1, 1, 50, 20]);
  const c = Array.from({ length: 200 }, (_, i) => ({ t: new Date(Date.UTC(2026, 0, 1) + i * 86400e3).toISOString() }));
  assert.equal(startIndex(c, null), 100);
  assert.equal(startIndex(c, '2026-04-01'), 90);
  assert.equal(startIndex(c, '2025-01-01'), 60, 'keeps 60 candles of history on screen');
  assert.equal(startIndex(c, '2030-01-01'), 198);
});
