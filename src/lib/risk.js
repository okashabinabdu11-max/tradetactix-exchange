// Risk and position-size maths for XAUUSD.
// Pure functions only: no DOM, no network, so they can be unit tested.

export const MIN_REWARD_TO_RISK = 3; // 1:3 minimum, per the trading plan
export const XAUUSD_CONTRACT_OZ = 100; // ounces per 1.00 lot (standard contract)
export const MIN_LOT = 0.01;
export const LOT_STEP = 0.01;
export const HIGH_RISK_PERCENT = 2;

const EPSILON = 1e-9;

const isPositive = (n) => typeof n === 'number' && Number.isFinite(n) && n > 0;

function roundDownToStep(value, step) {
  return Math.floor(value / step + EPSILON) * step;
}

/**
 * Checks a planned trade against the plan's rules and sizes the position.
 * Prices are in USD per ounce. Returns { ok: false, errors } when the inputs
 * cannot describe a real trade.
 */
export function evaluateTrade({
  direction,
  entry,
  stop,
  target,
  balance,
  riskPercent,
  contractSize = XAUUSD_CONTRACT_OZ,
  minRewardToRisk = MIN_REWARD_TO_RISK,
}) {
  // A personal minimum may be stricter than the plan's 1:3, never looser.
  const minimumRatio = Math.max(MIN_REWARD_TO_RISK, Number(minRewardToRisk) || MIN_REWARD_TO_RISK);
  const errors = [];

  if (direction !== 'buy' && direction !== 'sell') errors.push('Choose BUY or SELL.');
  if (!isPositive(entry)) errors.push('Enter an entry price.');
  if (!isPositive(stop)) errors.push('Enter a stop-loss price.');
  if (!isPositive(target)) errors.push('Enter a take-profit price.');
  if (!isPositive(balance)) errors.push('Enter your account balance.');
  if (!isPositive(riskPercent) || riskPercent > 100) {
    errors.push('Risk per trade must be between 0 and 100%.');
  }
  if (!isPositive(contractSize)) errors.push('Contract size must be above zero.');
  if (errors.length) return { ok: false, errors };

  if (direction === 'buy') {
    if (stop >= entry) errors.push('For a BUY, the stop-loss must be below the entry.');
    if (target <= entry) errors.push('For a BUY, the take-profit must be above the entry.');
  } else {
    if (stop <= entry) errors.push('For a SELL, the stop-loss must be above the entry.');
    if (target >= entry) errors.push('For a SELL, the take-profit must be below the entry.');
  }
  if (errors.length) return { ok: false, errors };

  const stopDistance = Math.abs(entry - stop);
  const targetDistance = Math.abs(target - entry);
  const rewardToRisk = targetDistance / stopDistance;
  const meetsMinimum = rewardToRisk >= minimumRatio - EPSILON;

  const sign = direction === 'buy' ? 1 : -1;
  const minimumTarget = entry + sign * stopDistance * minimumRatio;

  const riskBudget = balance * (riskPercent / 100);
  const riskPerLot = stopDistance * contractSize;
  const rawLots = riskBudget / riskPerLot;
  const belowMinLot = rawLots < MIN_LOT - EPSILON;
  const lots = belowMinLot ? 0 : Number(roundDownToStep(rawLots, LOT_STEP).toFixed(2));

  const actualRisk = lots * riskPerLot;
  const potentialReward = lots * targetDistance * contractSize;
  const minLotRisk = MIN_LOT * riskPerLot;

  const warnings = [];
  if (riskPercent > HIGH_RISK_PERCENT) {
    warnings.push(`Risking more than ${HIGH_RISK_PERCENT}% of the account on one trade.`);
  }
  if (belowMinLot) {
    warnings.push(
      'The stop is too wide for this risk: even the smallest position (0.01 lot) would risk more than your limit.',
    );
  }

  return {
    ok: true,
    errors: [],
    warnings,
    stopDistance,
    targetDistance,
    rewardToRisk,
    minimumRatio,
    meetsMinimum,
    minimumTarget,
    riskBudget,
    rawLots,
    lots,
    belowMinLot,
    actualRisk,
    actualRiskPercent: (actualRisk / balance) * 100,
    potentialReward,
    minLotRisk,
    minLotRiskPercent: (minLotRisk / balance) * 100,
    allowed: meetsMinimum && !belowMinLot,
  };
}
