// Strong-password rules for new accounts. Pure, so it is unit tested.
// Existing accounts are not affected: people with an older password can still sign in.

export const PASSWORD_RULES = [
  { id: 'length', text: 'At least 8 characters', test: (p) => p.length >= 8 },
  { id: 'upper', text: 'An uppercase letter (A–Z)', test: (p) => /[A-Z]/.test(p) },
  { id: 'lower', text: 'A lowercase letter (a–z)', test: (p) => /[a-z]/.test(p) },
  { id: 'number', text: 'A number (0–9)', test: (p) => /[0-9]/.test(p) },
  { id: 'symbol', text: 'A symbol, like ! @ # $', test: (p) => /[^A-Za-z0-9\s]/.test(p) },
];

export const passwordChecks = (p = '') => PASSWORD_RULES.map((r) => ({ id: r.id, text: r.text, ok: r.test(String(p)) }));
export const isStrongPassword = (p = '') => passwordChecks(p).every((c) => c.ok);
