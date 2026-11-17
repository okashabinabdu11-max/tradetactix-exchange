// POST /api/verify-payment — administrators only.
//   { claimId }                       check a customer's claim and record the result
//   { network, txHash, amount? }      test any transaction (records nothing)
// The caller's own sign-in token is passed to the database, which enforces
// that only administrators can read claims and record results.

import { bearerToken, getEntitlement } from './_lib/access.js';
import { verifyTransfer } from './_lib/chain.js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://htycjrdyoysnudasqdop.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_SEn6hnam_lE5yzk0mZQrYg_eVrh42Fn';

const send = (res, status, body) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'private, no-store');
  res.status(status).send(JSON.stringify(body));
};

async function db(token, path, init = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json', ...(init.headers || {}) },
    signal: AbortSignal.timeout(6000),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw Object.assign(new Error(body?.message || `database ${res.status}`), { status: res.status });
  return body;
}

const HASH = /^(0x)?[0-9a-fA-F]{64}$/;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return send(res, 405, { error: 'method_not_allowed' });
  }
  const token = bearerToken(req);
  const who = await getEntitlement(token);
  if (!who.is_admin) return send(res, 403, { error: 'admins_only' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = null; } }
  if (!body || typeof body !== 'object') return send(res, 400, { error: 'bad_request' });

  try {
    let claim = null;
    let network;
    let txHash;
    if (body.claimId) {
      if (!/^[0-9a-f-]{36}$/i.test(String(body.claimId))) return send(res, 400, { error: 'bad_claim' });
      const rows = await db(token, `payment_claims?id=eq.${body.claimId}&select=*`);
      claim = rows?.[0];
      if (!claim) return send(res, 404, { error: 'claim_not_found' });
      if (claim.status !== 'pending') return send(res, 409, { error: 'not_pending' });
      network = claim.network;
      txHash = claim.tx_hash;
    } else {
      network = String(body.network || '');
      txHash = String(body.txHash || '').trim();
      if (!HASH.test(txHash)) return send(res, 400, { error: 'bad_hash' });
    }

    const nets = await db(token, `payment_networks?id=eq.${encodeURIComponent(network)}&select=*`);
    const net = nets?.[0];
    if (!net) return send(res, 404, { error: 'network_not_found' });
    if (!net.auto_verify) return send(res, 422, { error: 'no_automatic_check', message: 'This network has no automatic check yet.' });
    const tokenContract = String(body.tokenContract || net.token_contract || '');
    const decimals = Number.isInteger(body.decimals) ? body.decimals : net.token_decimals;
    if (!tokenContract || !Number.isInteger(decimals)) return send(res, 422, { error: 'token_not_set', message: 'Set the token contract and decimals for this network first.' });

    const created = claim ? new Date(claim.created_at).getTime() : null;
    const result = await verifyTransfer({
      network,
      txHash,
      tokenContract,
      decimals,
      recipient: net.receiving_address, // always the stored address, never one from the request
      expectedAmount: claim ? claim.amount_usdt : (body.amount ?? null),
      // A claim's payment must happen after the request was made and before it expired.
      notBefore: created ? created - 5 * 60e3 : null,
      notAfter: claim ? new Date(claim.expires_at).getTime() + 60 * 60e3 : null,
    });
    result.tokenContract = tokenContract;
    result.recipient = net.receiving_address;

    if (claim) {
      await db(token, 'rpc/admin_record_verification', { method: 'POST', body: JSON.stringify({ p_id: claim.id, p_result: result }) });
    }
    return send(res, 200, { ...result, recorded: Boolean(claim), test: !claim });
  } catch (err) {
    console.error('verify-payment failed', err?.message);
    return send(res, 502, { error: 'check_failed', message: `The check could not finish: ${String(err?.message || 'unknown error').slice(0, 200)}` });
  }
}
