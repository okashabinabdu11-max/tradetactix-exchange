// Decides how much of a signal a caller may see. Pure, so it is unit tested.
//
//   Pro (and admins)   everything
//   Free, signed in    the state, and for BUY/SELL the direction and timeframe
//                      only, for a limited number of different signals a month
//   Signed out         whether the engine is waiting, never a direction
//
// Nothing here creates a signal: it only removes detail from a real one.

export const NO_SETUP_TEXT = 'Wait — the market setup is analyzing. When the setup is ready, the signal will be sent.';

const flags = (checks) => (checks ? {
  h4: checks.h4 ? { ok: checks.h4.ok } : null,
  h1: checks.h1 ? { ok: checks.h1.ok } : null,
  m15: checks.m15 ? { ok: checks.m15.ok } : null,
} : null);

export const signalKey = (s) => `${s.state}-${s.confirmedAt || s.asOf || ''}`.slice(0, 80);

export function gateSignal(signal, entitlement, preview = null) {
  const isTrade = signal.state === 'buy' || signal.state === 'sell';
  const base = { state: signal.state, asOf: signal.asOf ?? null, timeframe: isTrade ? '15M' : null };

  if (entitlement.shows_levels) {
    return {
      ...base,
      access: 'full',
      reason: signal.state === 'no-setup' ? `${NO_SETUP_TEXT} ${signal.reason}` : signal.reason,
      direction: signal.direction ?? null,
      checks: signal.checks ?? null,
      price: signal.price ?? null,
      entry: signal.entry ?? null,
      stop: signal.stop ?? null,
      target: signal.target ?? null,
      rr: signal.rr ?? null,
      targetBasis: signal.targetBasis ?? null,
      confirmedAt: signal.confirmedAt ?? null,
      minRR: signal.minRR ?? null,
      levels: entitlement.shows_analysis ? (signal.levels || []).map((l) => ({ price: l.price, touches: l.touches })) : null,
      liquidity: entitlement.shows_analysis && signal.liquidity
        ? { high: signal.liquidity.high ? { price: signal.liquidity.high.price } : null, low: signal.liquidity.low ? { price: signal.liquidity.low.price } : null }
        : null,
    };
  }

  const generic = {
    offline: 'The market is closed or price data is unavailable.',
    'no-setup': NO_SETUP_TEXT,
    waiting: 'Price is at a 4H level. Waiting for the 15M confirmation.',
    'news-pause': 'No new signals 30 minutes before and after high-impact US news.',
  };
  if (!isTrade) {
    return { ...base, access: entitlement.signed_in ? 'limited' : 'anonymous', reason: generic[signal.state] || generic.offline, checks: entitlement.signed_in ? flags(signal.checks) : null };
  }
  if (!entitlement.signed_in) {
    return { ...base, state: 'locked', timeframe: null, access: 'anonymous', reason: 'A signal is active. Sign in to see its direction.', checks: null };
  }
  if (!preview || !preview.allowed) {
    return {
      ...base, state: 'locked', access: 'limited', checks: null,
      reason: preview && preview.limit === 0
        ? 'A signal is active. Signals are for approved members: request access on the Plans page.'
        : preview && preview.limit !== null
        ? `A signal is active. You have used all ${preview.limit} free previews this month.`
        : 'A signal is active, but your preview could not be checked. Try again shortly.',
      previews: preview ? { used: preview.used, limit: preview.limit } : null,
    };
  }
  return {
    ...base,
    access: 'limited',
    direction: signal.direction,
    checks: flags(signal.checks),
    reason: `A ${signal.direction === 'buy' ? 'BUY' : 'SELL'} setup is confirmed on the 15M timeframe at a 4H level. Entry, stop-loss and take-profit are for Pro members.`,
    previews: { used: preview.used, limit: preview.limit },
  };
}
