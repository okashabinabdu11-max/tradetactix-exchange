// English (default) and Amharic. English text is the key; anything not in the
// Amharic list stays in English. The choice is kept on this device only.

import { AM } from '../data/am.js';

const KEY = 'tt-lang';
export const lang = () => { try { return localStorage.getItem(KEY) === 'am' ? 'am' : 'en'; } catch { return 'en'; } };
export const t = (s) => (lang() === 'am' && AM[s]) || s;

export function setLang(l) {
  try { localStorage.setItem(KEY, l === 'am' ? 'am' : 'en'); } catch { /* private mode */ }
  window.location.reload(); // every page and the menu are drawn again in the new language
}

export const langToggle = () => (lang() === 'am'
  ? '<button class="lang-toggle" type="button" data-lang-toggle aria-label="Switch to English" title="English">EN</button>'
  : '<button class="lang-toggle" type="button" data-lang-toggle aria-label="ወደ አማርኛ ቀይር" title="አማርኛ">አማ</button>');

export function initLang() {
  document.documentElement.lang = lang();
  document.addEventListener('click', (e) => { if (e.target.closest('[data-lang-toggle]')) setLang(lang() === 'am' ? 'en' : 'am'); });
}
