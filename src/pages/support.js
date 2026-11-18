// Support: an AI assistant that answers questions about TradeTactix, and a
// "Message the admin" form that reaches the admin on Telegram. The chat lives
// only in this tab; nothing is stored.

import { session } from '../state/session.js';
import { getAccessToken } from '../services/backend.js';
import { escapeHtml } from '../lib/format.js';

const TG = 'https://t.me/Tradetactix1';
const TG_BUTTON = `<a class="button button-primary tg-button" href="${TG}" target="_blank" rel="noopener">Message @Tradetactix1 on Telegram</a>`;
const WELCOME = 'Hi! I can help with signing up, getting approved, Telegram alerts, and what the dashboard colours mean. What do you need?';
const SUGGESTIONS = ['How do I get approved?', 'How do I connect Telegram?', 'What does Put BE mean?'];
const chat = []; // kept while the page is open in this tab

// Text is escaped first; then only **bold** and line breaks are turned into markup.
const format = (t) => escapeHtml(t).replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>').replace(/@Tradetactix1\b/g, `<a href="${TG}" target="_blank" rel="noopener">@Tradetactix1</a>`).replace(/\n/g, '<br>');
const bubble = (m) => `<div class="msg msg-${m.role}"><p>${format(m.content)}</p></div>`;

async function post(body) {
  const token = await getAccessToken().catch(() => null);
  const res = await fetch('/api/support', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

export function supportPage() {
  const email = session.get().user?.email || '';
  return {
    title: 'Support',
    html: `
      <header class="page-head"><h1>Support</h1><p>Ask the AI assistant. For big problems, message the admin on Telegram: @Tradetactix1.</p></header>
      <section class="panel support" aria-label="Chat with the support assistant">
        <div class="chat-log" id="chat-log" aria-live="polite">
          ${bubble({ role: 'assistant', content: WELCOME })}
          ${chat.map(bubble).join('')}
        </div>
        <div class="chat-suggest" id="chat-suggest" ${chat.length ? 'hidden' : ''}>
          ${SUGGESTIONS.map((s) => `<button class="button button-quiet" type="button" data-ask="${escapeHtml(s)}">${escapeHtml(s)}</button>`).join('')}
        </div>
        <form class="chat-form" id="chat-form" novalidate>
          <label class="sr-only" for="chat-input">Your question</label>
          <textarea id="chat-input" rows="2" maxlength="800" placeholder="Type your question…"></textarea>
          <button class="button button-primary" type="submit">Send</button>
        </form>
        <p class="panel-note">The assistant answers questions about TradeTactix. It cannot see the market, your account or approvals, and it does not give trading advice.</p>
      </section>

      <section class="panel" aria-labelledby="human-title">
        <h2 class="panel-title" id="human-title">Message the admin</h2>
        <p class="panel-note">For approval, sign-in, Telegram or any big problem. The fastest way is Telegram:</p>
        <div class="form-actions">${TG_BUTTON}</div>
        <p class="panel-note">Or send a message from here, and the admin gets it on Telegram:</p>
        <form class="human-form" id="human-form" novalidate>
          <label class="field-label" for="human-contact">Your Telegram username or email</label>
          <input id="human-contact" type="text" maxlength="100" autocomplete="email" value="${escapeHtml(email)}" placeholder="@yourname or you@example.com" />
          <label class="field-label" for="human-message">Message</label>
          <textarea id="human-message" rows="3" maxlength="800"></textarea>
          <div class="form-actions"><button class="button button-primary" type="submit">Message the admin</button></div>
          <p class="form-status" id="human-status" role="status"></p>
        </form>
      </section>`,
    mount(root) {
      const log = root.querySelector('#chat-log');
      const input = root.querySelector('#chat-input');
      const form = root.querySelector('#chat-form');
      const sendBtn = form.querySelector('button[type=submit]');
      let alive = true;

      const ask = async (text) => {
        const q = text.trim().slice(0, 800);
        if (!q || sendBtn.disabled) return;
        root.querySelector('#chat-suggest').hidden = true;
        chat.push({ role: 'user', content: q });
        log.insertAdjacentHTML('beforeend', bubble({ role: 'user', content: q }) + '<div class="msg msg-assistant is-typing" id="typing"><p>Typing…</p></div>');
        log.scrollTop = log.scrollHeight;
        input.value = ''; sendBtn.disabled = true;
        let reply;
        try {
          const { ok, status, data } = await post({ action: 'ask', messages: chat });
          reply = ok && data.reply ? data.reply
            : status === 429 ? 'You have sent a lot of questions. Please wait a while, or message the admin on Telegram: @Tradetactix1'
            : 'The AI assistant is not available right now. Please message the admin on Telegram: @Tradetactix1';
          if (ok && data.reply) chat.push({ role: 'assistant', content: data.reply });
        } catch {
          reply = 'The assistant could not be reached. Check your connection, or message the admin on Telegram: @Tradetactix1';
        }
        if (!alive) return;
        root.querySelector('#typing')?.remove();
        log.insertAdjacentHTML('beforeend', bubble({ role: 'assistant', content: reply }));
        log.scrollTop = log.scrollHeight;
        sendBtn.disabled = false;
      };

      form.addEventListener('submit', (e) => { e.preventDefault(); ask(input.value); });
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(input.value); } });
      root.querySelector('#chat-suggest').addEventListener('click', (e) => { const b = e.target.closest('[data-ask]'); if (b) ask(b.dataset.ask); });
      log.scrollTop = log.scrollHeight;

      const human = root.querySelector('#human-form');
      const status = root.querySelector('#human-status');
      human.addEventListener('submit', async (e) => {
        e.preventDefault();
        const contact = root.querySelector('#human-contact').value.trim();
        const message = root.querySelector('#human-message').value.trim();
        status.className = 'form-status is-error';
        if (!contact) { status.textContent = 'Add your Telegram username or email so the admin can reply.'; return; }
        if (!message) { status.textContent = 'Write your message first.'; return; }
        const btn = human.querySelector('button'); btn.disabled = true;
        status.className = 'form-status'; status.textContent = 'Sending…';
        try {
          const { ok, status: code } = await post({ action: 'human', contact, message, messages: chat, page: 'support' });
          if (!alive) return;
          if (ok) { status.className = 'form-status is-ok'; status.textContent = 'Sent. The admin will reply on Telegram or by email.'; root.querySelector('#human-message').value = ''; }
          else { status.className = 'form-status is-error'; status.textContent = code === 429 ? 'You have sent several messages already. Please wait an hour before sending another.' : 'The message could not be sent right now. Please try again later.'; }
        } catch { status.className = 'form-status is-error'; status.textContent = 'The message could not be sent. Check your connection.'; }
        btn.disabled = false;
      });
      return () => { alive = false; };
    },
  };
}
