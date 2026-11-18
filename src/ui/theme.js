// Dark (default) and light themes. The choice is kept in this browser only.
// index.html applies the saved theme before the page draws, so it never flashes.

import { icon } from './icons.js';

const KEY = 'tt-theme';
const META = { dark: '#000000', light: '#ffffff' };

export const currentTheme = () => (document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');

export function setTheme(theme) {
  const t = theme === 'light' ? 'light' : 'dark';
  if (t === 'light') document.documentElement.dataset.theme = 'light';
  else delete document.documentElement.dataset.theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', META[t]);
  document.querySelector('meta[name="color-scheme"]')?.setAttribute('content', t);
  try { localStorage.setItem(KEY, t); } catch { /* private mode: still switches for this visit */ }
  document.querySelectorAll('[data-theme-toggle]').forEach((b) => b.setAttribute('aria-label', label()));
}

const label = () => (currentTheme() === 'light' ? 'Switch to dark theme' : 'Switch to light theme');

// Shows a moon in dark mode and a sun in light mode.
export const themeToggle = () =>
  `<button class="theme-toggle" type="button" data-theme-toggle aria-label="${label()}" title="Dark or light">
    <span class="icon-dark">${icon('moon', 18)}</span><span class="icon-light">${icon('sun', 18)}</span>
  </button>`;

export function initTheme() {
  setTheme(currentTheme());
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-theme-toggle]')) setTheme(currentTheme() === 'light' ? 'dark' : 'light');
  });
}
