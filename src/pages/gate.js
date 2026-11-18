// Shown instead of every signal page until the admin approves the visitor.

import { session } from '../state/session.js';
import { t } from '../lib/i18n.js';

export function approvalGatePage(title) {
  const { ready, user } = session.get();
  let body;
  if (!ready) body = `<p class="result-empty">${t('Checking sign-in…')}</p>`;
  else if (!user) {
    body = `
      <p>${t(`Signals, charts and analysis are for approved members only.`)}</p>
      <ol class="gate-steps"><li>${t('Register with Google on the homepage.')}</li><li>${t(`Send your Telegram username on the Plans page.`)}</li><li>${t(`Wait for the admin to approve you.`)}</li></ol>
      <div class="form-actions"><a class="button button-primary" href="#/home">${t(`Open Account`)}</a><a class="button button-quiet" href="#/plans">${t(`How access works`)}</a></div>`;
  } else {
    body = `
      <p>${t(`Your account does not have signal access yet. Send a request and wait for the admin to approve you. Access lasts for the time the admin chooses and stops automatically after.`)}</p>
      <div class="form-actions"><a class="button button-primary" href="#/plans">${t(`Request approval`)}</a></div>`;
  }
  return {
    title,
    html: `
      <section class="panel gate">
        <span class="gate-mark" aria-hidden="true">T</span>
        <h1>${t(`Get approved to receive signals`)}</h1>
        ${body}
      </section>`,
  };
}
