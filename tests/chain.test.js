import test from 'node:test';
import assert from 'node:assert/strict';
import { tronToHex, evmTransfers, tronTransfers, decide, unitsToCents, TRANSFER_TOPIC, verifyTransfer } from '../api/_lib/chain.js';
import verifyHandler from '../api/verify-payment.js';

// Public, well-known addresses used only as test inputs.
const TRON_USDT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const OWNER_TRON = 'TBPuZUcRgVSjqZ1vkvRqsKSAKs24aLgNWF';
const BSC_USDT = '0x55d398326f99059fF775485246999027B3197955';
const OWNER_EVM = '0x3030c068eca3e9d104ebb005564fa7a50231f9b9';
const pad = (hex) => `0x${'0'.repeat(24)}${hex.replace(/^0x/, '').toLowerCase()}`;

test('TRON addresses decode with checksum', () => {
  assert.equal(tronToHex(TRON_USDT), 'a614f803b6fd780986a42c78ec9c7f77e6ded13c');
  assert.equal(tronToHex(OWNER_TRON).length, 40);
  assert.throws(() => tronToHex('TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6u'), /checksum/);
  assert.throws(() => tronToHex('0xabc'), /base58/);
});

test('cents from token units at 18 and 6 decimals', () => {
  assert.equal(unitsToCents(10_370000000000000000n, 18), 1037n);
  assert.equal(unitsToCents(10_370000n, 6), 1037n);
  assert.equal(unitsToCents(10_379999n, 6), 1037n);
});

const evmReceipt = (logs, status = '0x1') => ({ status, blockNumber: '0x64', logs });
const transferLog = (token, to, units) => ({ address: token, topics: [TRANSFER_TOPIC, pad('0x1234'), pad(to)], data: `0x${units.toString(16)}` });

test('EVM: only the right token to the right address counts', () => {
  const units = 10_370000000000000000n;
  const logs = [
    transferLog(BSC_USDT, OWNER_EVM, units),
    transferLog('0x06711c455c6d80a8363ee16e44457c78dfeef3bb', OWNER_EVM, units), // look-alike token
    transferLog(BSC_USDT, '0x000000000000000000000000000000000000dead', units), // someone else
    { address: BSC_USDT, topics: ['0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925', pad('0x1'), pad(OWNER_EVM)], data: `0x${units.toString(16)}` }, // Approval, not Transfer
  ];
  assert.deepEqual(evmTransfers(evmReceipt(logs), BSC_USDT, OWNER_EVM), [units]);
  assert.deepEqual(evmTransfers(evmReceipt(logs), BSC_USDT.toLowerCase(), OWNER_EVM.toUpperCase().replace('0X', '0x')), [units]);
});

test('TRON: only the right token to the right address counts', () => {
  const info = { log: [
    { address: `41${tronToHex(TRON_USDT)}`, topics: [TRANSFER_TOPIC.slice(2), '0'.repeat(64), `${'0'.repeat(24)}${tronToHex(OWNER_TRON)}`], data: (10_370000n).toString(16).padStart(64, '0') },
    { address: tronToHex(TRON_USDT), topics: [TRANSFER_TOPIC.slice(2), '0'.repeat(64), `${'0'.repeat(24)}${'ab'.repeat(20)}`], data: '1'.padStart(64, '0') },
  ] };
  assert.deepEqual(tronTransfers(info, TRON_USDT, OWNER_TRON), [10_370000n]);
});

const base = { network: 'bep20', txHash: '0xabc', success: true, decimals: 6, expectedAmount: 10.37, confirmations: 20, minConfirmations: 15, txTime: 2000, notBefore: 1000, notAfter: 3000 };

test('decision: exact amount, enough confirmations, inside the time window', () => {
  const r = decide({ ...base, transfers: [10_370000n] });
  assert.equal(r.ok, true);
  assert.equal(r.received, '10.37');
  assert.deepEqual(r.problems, []);
});

test('decision: every failure is named', () => {
  assert.match(decide({ ...base, transfers: [10_000000n] }).problems[0], /Received 10.00 USDT; this payment needs exactly 10.37/);
  assert.match(decide({ ...base, transfers: [11_370000n] }).problems[0], /exactly 10.37/, 'overpaying does not match the request either');
  assert.match(decide({ ...base, transfers: [] }).problems[0], /No USDT transfer/);
  assert.match(decide({ ...base, transfers: [10_370000n], confirmations: 3 }).problems[0], /3 of 15 confirmations/);
  assert.match(decide({ ...base, transfers: [10_370000n], success: false }).problems[0], /failed on chain/);
  assert.match(decide({ ...base, transfers: [10_370000n], txTime: 500 }).problems[0], /older than this payment request/);
  assert.match(decide({ ...base, transfers: [10_370000n], txTime: 5000 }).problems[0], /newer than allowed/);
  assert.equal(decide({ ...base, transfers: [5_000000n, 5_370000n] }).ok, true, 'two transfers in one transaction add up');
});

test('EVM check end to end against a fake node', async () => {
  const realFetch = globalThis.fetch;
  const answers = {
    eth_chainId: '0x38',
    eth_getTransactionReceipt: evmReceipt([transferLog(BSC_USDT, OWNER_EVM, 10_370000000000000000n)]),
    eth_blockNumber: '0x77', // block 0x64 + 19 more = 20 confirmations
    eth_getBlockByNumber: { timestamp: '0x2' },
  };
  globalThis.fetch = async (_url, init) => ({ json: async () => ({ result: answers[JSON.parse(init.body).method] }) });
  const r = await verifyTransfer({ network: 'bep20', txHash: '0x'.padEnd(66, '1'), tokenContract: BSC_USDT, decimals: 18, recipient: OWNER_EVM, expectedAmount: 10.37, notBefore: 1000, notAfter: 3000 });
  answers.eth_chainId = '0x1';
  await assert.rejects(verifyTransfer({ network: 'bep20', txHash: '0x1', tokenContract: BSC_USDT, decimals: 18, recipient: OWNER_EVM, expectedAmount: 10.37 }), /expected 56/);
  answers.eth_chainId = '0x38';
  answers.eth_getTransactionReceipt = null;
  const missing = await verifyTransfer({ network: 'bep20', txHash: '0x1', tokenContract: BSC_USDT, decimals: 18, recipient: OWNER_EVM, expectedAmount: 10.37 });
  globalThis.fetch = realFetch;
  assert.equal(r.ok, true, r.problems.join(' '));
  assert.equal(r.confirmations, 20);
  assert.equal(missing.ok, false);
  await assert.rejects(verifyTransfer({ network: 'aptos' }), /no automatic check/);
});

function fakeRes() {
  return { headers: {}, code: null, body: null, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, send(b) { this.body = JSON.parse(b); } };
}

test('verify endpoint is for administrators only', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ signed_in: true, plan: 'pro', is_admin: false }) });
  const res = fakeRes();
  await verifyHandler({ method: 'POST', headers: { authorization: `Bearer ${'t'.repeat(40)}` }, body: { network: 'bep20', txHash: `0x${'1'.repeat(64)}` } }, res);
  const anon = fakeRes();
  await verifyHandler({ method: 'POST', headers: {}, body: {} }, anon);
  const get = fakeRes();
  await verifyHandler({ method: 'GET', headers: {} }, get);
  globalThis.fetch = realFetch;
  assert.equal(res.code, 403);
  assert.equal(anon.code, 403);
  assert.equal(get.code, 405);
});

test('verify endpoint always pays attention to the stored address, not the request', async () => {
  const realFetch = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (u.includes('rpc/my_entitlement')) return { ok: true, json: async () => ({ signed_in: true, is_admin: true }) };
    if (u.includes('payment_networks')) return { ok: true, json: async () => ([{ id: 'bep20', auto_verify: true, token_contract: BSC_USDT, token_decimals: 18, receiving_address: OWNER_EVM }]) };
    const m = JSON.parse(init.body).method; seen.push(m);
    const answers = { eth_chainId: '0x38', eth_getTransactionReceipt: evmReceipt([transferLog(BSC_USDT, OWNER_EVM, 10_000000000000000000n)]), eth_blockNumber: '0x80', eth_getBlockByNumber: { timestamp: '0x2' } };
    return { ok: true, json: async () => ({ result: answers[m] }) };
  };
  const res = fakeRes();
  await verifyHandler({ method: 'POST', headers: { authorization: `Bearer ${'t'.repeat(40)}` }, body: { network: 'bep20', txHash: `0x${'1'.repeat(64)}`, amount: 10, recipient: '0xattacker' } }, res);
  globalThis.fetch = realFetch;
  assert.equal(res.code, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.test, true);
  assert.equal(res.body.recipient, OWNER_EVM);
  assert.equal(res.body.recorded, false);
});
