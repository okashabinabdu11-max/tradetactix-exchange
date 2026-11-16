// Personal risk limits: validation and mapping to the database row.
// Pure functions, unit tested. The database repeats these checks.

import { MIN_REWARD_TO_RISK } from './risk.js';

export const DEFAULT_RISK_SETTINGS = Object.freeze({
  riskPercent: 1,
  minRewardToRisk: MIN_REWARD_TO_RISK,
  maxTradesPerDay: 3,
  maxDailyLossPercent: 3,
});

const num = (v) => (v === '' || v === null || v === undefined ? NaN : Number(v));

export function validateRiskSettings(input) {
  const values = {
    riskPercent: num(input.riskPercent),
    minRewardToRisk: num(input.minRewardToRisk),
    maxTradesPerDay: num(input.maxTradesPerDay),
    maxDailyLossPercent: num(input.maxDailyLossPercent),
  };
  const errors = [];
  if (!(values.riskPercent > 0 && values.riskPercent <= 100)) {
    errors.push('Risk per trade must be above 0 and at most 100%.');
  }
  if (!(values.minRewardToRisk >= MIN_REWARD_TO_RISK && values.minRewardToRisk <= 20)) {
    errors.push(`Minimum reward-to-risk must be between 1:${MIN_REWARD_TO_RISK} and 1:20. It cannot go below 1:${MIN_REWARD_TO_RISK}.`);
  }
  if (!(Number.isInteger(values.maxTradesPerDay) && values.maxTradesPerDay >= 1 && values.maxTradesPerDay <= 50)) {
    errors.push('Trades per day must be a whole number from 1 to 50.');
  }
  if (!(values.maxDailyLossPercent > 0 && values.maxDailyLossPercent <= 100)) {
    errors.push('Daily loss limit must be above 0 and at most 100%.');
  }
  return { ok: errors.length === 0, errors, values };
}

export const fromRow = (row) => ({
  riskPercent: Number(row.risk_percent),
  minRewardToRisk: Number(row.min_reward_to_risk),
  maxTradesPerDay: Number(row.max_trades_per_day),
  maxDailyLossPercent: Number(row.max_daily_loss_percent),
});

export const toRow = (values, userId) => ({
  user_id: userId,
  risk_percent: values.riskPercent,
  min_reward_to_risk: values.minRewardToRisk,
  max_trades_per_day: values.maxTradesPerDay,
  max_daily_loss_percent: values.maxDailyLossPercent,
});
