export const usd = (n, digits = 2) =>
  '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });

export const price = (n) =>
  Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const ratio = (n) => `1:${Number(n).toFixed(2).replace(/\.?0+$/, '')}`;

export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
