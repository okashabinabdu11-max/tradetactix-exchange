import test from 'node:test';
import assert from 'node:assert/strict';
import { nextEvent, eventMessage, pips } from '../api/_lib/tracker.js';

const T0 = Date.UTC(2026, 10, 18, 10, 0);
const at = (i) => new Date(T0 + i * 15 * 60e3).toISOString();
const c = (i, h, l) => ({ t: at(i), o: (h + l) / 2, h, l, c: (h + l) / 2 });
const BUY = { direction: 'buy', entry: 4008, stop: 4000, target: 4032, opened_at: at(0), be_sent_at: null };

test('pips: 1 pip is 10 cents of gold', () => {
  assert.equal(pips(8), 80);
  assert.equal(pips(24), 240);
});

test('stop hit before anything else is SL hit', () => {
  assert.deepEqual(nextEvent(BUY, [c(0, 4010, 4004), c(1, 4006, 3999)], T0), { event: 'sl', pips: -80, price: 4000 });
});

test('1R in profit asks to put BE, then target is TP Done', () => {
  const candles = [c(0, 4012, 4005), c(1, 4016.5, 4010)];
  assert.equal(nextEvent(BUY, candles, T0).event, 'be_move');
  const afterBe = { ...BUY, be_sent_at: at(2) };
  assert.equal(nextEvent(afterBe, [...candles, c(2, 4020, 4012), c(3, 4033, 4021)], T0).event, 'tp');
  assert.equal(nextEvent(afterBe, [...candles, c(3, 4033, 4021)], T0).pips, 240);
});

test('after BE, a return to entry closes at breakeven, not a loss', () => {
  const t = { ...BUY, be_sent_at: at(2) };
  const r = nextEvent(t, [c(0, 4016.5, 4005), c(2, 4014, 4007.5)], T0);
  assert.deepEqual(r, { event: 'be', pips: 0, price: 4008 });
});

test('a candle touching stop and target counts as the stop', () => {
  assert.equal(nextEvent(BUY, [c(0, 4033, 3999)], T0).event, 'sl');
});

test('candles from before the signal are ignored', () => {
  assert.equal(nextEvent(BUY, [c(-2, 4040, 3990)], T0), null);
});

test('SELL mirrors BUY', () => {
  const sell = { direction: 'sell', entry: 4092, stop: 4100, target: 4068, opened_at: at(0), be_sent_at: null };
  assert.equal(nextEvent(sell, [c(0, 4095, 4083.5)], T0).event, 'be_move');
  assert.equal(nextEvent(sell, [c(0, 4101, 4090)], T0).event, 'sl');
  assert.equal(nextEvent(sell, [c(0, 4093, 4067)], T0).event, 'tp');
});

test('nothing for 48 hours expires', () => {
  assert.equal(nextEvent(BUY, [c(0, 4010, 4004)], T0 + 49 * 3600e3).event, 'expired');
  assert.equal(nextEvent(BUY, [c(0, 4010, 4004)], T0 + 47 * 3600e3), null);
});

test('messages say Put BE, TP Done, SL hit with the numbers', () => {
  assert.match(eventMessage(BUY, { event: 'be_move', pips: 80 }), /Put BE[\s\S]*breakeven at <b>4008.00<\/b>/);
  assert.match(eventMessage(BUY, { event: 'tp', pips: 240 }), /TP Done[\s\S]*\+240 pips smashed/);
  assert.match(eventMessage(BUY, { event: 'sl', pips: -80 }), /SL hit[\s\S]*[−-]80 pips/);
  assert.match(eventMessage(BUY, { event: 'be', pips: 0 }), /breakeven[\s\S]*0 pips/);
});
