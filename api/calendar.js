// GET /api/calendar — this week's US medium and high impact releases, from the
// same feed the bot uses for news outlooks and the news safety pause.

import { calendar } from './_lib/newsRun.js';
import { usCalendar } from './_lib/news.js';

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).send('{"error":"method_not_allowed"}'); }
  try {
    const events = usCalendar(await calendar());
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=900, stale-while-revalidate=1800');
    return res.status(200).send(JSON.stringify({ events }));
  } catch (err) {
    console.error('calendar failed', err?.message);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).send(JSON.stringify({ events: null }));
  }
}
