// On-chain payment checks. Reads public blockchain data only; never holds keys
// and never moves funds. Parsing is split from fetching so it can be tested.

import { createHash } from 'node:crypto';

export const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

export const CHAINS = Object.freeze({
  bep20: { kind: 'evm', chainId: 56, minConfirmations: 15, rpc: () => process.env.BSC_RPC_URL || 'https://bsc-dataseed.bnbchain.org' },
  plasma: { kind: 'evm', chainId: 9745, minConfirmations: 10, rpc: () => process.env.PLASMA_RPC_URL || 'https://rpc.plasma.to' },
  trc20: { kind: 'tron', minConfirmations: 19, api: () => process.env.TRON_API_URL || 'https://api.trongrid.io' },
  // Aptos has no automatic check yet, so it cannot be switched on.
});

// ---------- helpers ----------

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/** TRON base58check address -> 20-byte hex (lowercase, no 0x41 prefix). Throws on a bad checksum. */
export function tronToHex(address) {
  let n = 0n;
  for (const ch of String(address)) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) throw new Error('bad base58');
    n = n * 58n + BigInt(i);
  }
  let hex = n.toString(16);
  if (hex.length % 2) hex = `0${hex}`;
  const bytes = Buffer.from(hex, 'hex');
  if (bytes.length !== 25 || bytes[0] !== 0x41) throw new Error('bad tron address');
  const body = bytes.subarray(0, 21);
  const check = createHash('sha256').update(createHash('sha256').update(body).digest()).digest().subarray(0, 4);
  if (!check.equals(bytes.subarray(21))) throw new Error('bad checksum');
  return body.subarray(1).toString('hex');
}

const evmAddr = (a) => String(a || '').toLowerCase().replace(/^0x/, '');
const topicAddr = (t) => String(t || '').toLowerCase().replace(/^0x/, '').slice(-40);

/** Integer token units -> decimal string with exactly `decimals` places trimmed to cents for comparison. */
export function unitsToCents(units, decimals) {
  const d = BigInt(decimals);
  if (d < 2n) return units * 10n ** (2n - d);
  return units / 10n ** (d - 2n); // whole cents received (fractions of a cent dropped)
}

const centsOf = (amount) => BigInt(Math.round(Number(amount) * 100));
const fmtCents = (c) => `${c / 100n}.${String(c % 100n).padStart(2, '0')}`;

/** Common decision once transfers to the receiving address are known. */
export function decide({ network, txHash, success, transfers, decimals, expectedAmount, confirmations, minConfirmations, txTime, notBefore, notAfter }) {
  const problems = [];
  if (!success) problems.push('The transaction failed on chain.');
  const total = transfers.reduce((a, t) => a + t, 0n);
  const receivedCents = unitsToCents(total, decimals);
  if (transfers.length === 0) problems.push('No USDT transfer to the receiving address was found in this transaction.');
  else if (expectedAmount !== null && receivedCents !== centsOf(expectedAmount)) {
    problems.push(`Received ${fmtCents(receivedCents)} USDT; this payment needs exactly ${Number(expectedAmount).toFixed(2)}.`);
  }
  if (confirmations < minConfirmations) problems.push(`${confirmations} of ${minConfirmations} confirmations so far.`);
  if (txTime && notBefore && txTime < notBefore) problems.push('The transaction is older than this payment request.');
  if (txTime && notAfter && txTime > notAfter) problems.push('The transaction is newer than allowed for this payment request.');
  return {
    ok: problems.length === 0,
    network,
    txHash,
    received: transfers.length ? fmtCents(receivedCents) : '0.00',
    expected: expectedAmount === null ? null : Number(expectedAmount).toFixed(2),
    confirmations,
    minConfirmations,
    txTime: txTime ? new Date(txTime).toISOString() : null,
    problems,
    checkedAt: new Date().toISOString(),
  };
}

// ---------- EVM (BNB Smart Chain, Plasma) ----------

export function evmTransfers(receipt, tokenContract, recipient) {
  const token = evmAddr(tokenContract);
  const to = evmAddr(recipient);
  return (receipt.logs || [])
    .filter((l) => evmAddr(l.address) === token && Array.isArray(l.topics) && String(l.topics[0]).toLowerCase() === TRANSFER_TOPIC && l.topics.length === 3 && topicAddr(l.topics[2]) === to)
    .map((l) => BigInt(l.data && l.data !== '0x' ? l.data : '0x0'));
}

async function rpc(url, method, params) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(8000),
  });
  const body = await res.json();
  if (body.error) throw new Error(`${method}: ${body.error.message || 'rpc error'}`);
  return body.result;
}

async function checkEvm(cfg, args) {
  const url = cfg.rpc();
  const chainId = parseInt(await rpc(url, 'eth_chainId', []), 16);
  if (chainId !== cfg.chainId) throw new Error(`Connected to chain ${chainId}, expected ${cfg.chainId}.`);
  const receipt = await rpc(url, 'eth_getTransactionReceipt', [args.txHash]);
  if (!receipt) return decide({ ...args, success: false, transfers: [], confirmations: 0, minConfirmations: cfg.minConfirmations, problemsExtra: true });
  const [head, block] = await Promise.all([
    rpc(url, 'eth_blockNumber', []),
    rpc(url, 'eth_getBlockByNumber', [receipt.blockNumber, false]),
  ]);
  return decide({
    ...args,
    success: receipt.status === '0x1',
    transfers: evmTransfers(receipt, args.tokenContract, args.recipient),
    confirmations: parseInt(head, 16) - parseInt(receipt.blockNumber, 16) + 1,
    minConfirmations: cfg.minConfirmations,
    txTime: block ? parseInt(block.timestamp, 16) * 1000 : null,
  });
}

// ---------- TRON ----------

export function tronTransfers(info, tokenContract, recipient) {
  const token = tronToHex(tokenContract);
  const to = tronToHex(recipient);
  return (info.log || [])
    .filter((l) => String(l.address).toLowerCase().replace(/^41/, '') === token && Array.isArray(l.topics) && `0x${l.topics[0]}`.toLowerCase() === TRANSFER_TOPIC && l.topics.length === 3 && topicAddr(l.topics[2]) === to)
    .map((l) => BigInt(`0x${l.data || '0'}`));
}

async function tronPost(base, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (process.env.TRONGRID_API_KEY) headers['TRON-PRO-API-KEY'] = process.env.TRONGRID_API_KEY;
  const res = await fetch(`${base}${path}`, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(8000) });
  return res.json();
}

async function checkTron(cfg, args) {
  const base = cfg.api();
  const hash = args.txHash.toLowerCase();
  // The solidity node only returns transactions that can no longer be reversed.
  const [solid, latest] = await Promise.all([
    tronPost(base, '/walletsolidity/gettransactioninfobyid', { value: hash }),
    tronPost(base, '/wallet/getnowblock', {}),
  ]);
  const head = latest?.block_header?.raw_data?.number ?? 0;
  let info = solid && solid.id ? solid : null;
  if (!info) {
    const pending = await tronPost(base, '/wallet/gettransactioninfobyid', { value: hash });
    info = pending && pending.id ? pending : null;
  }
  if (!info) return decide({ ...args, success: false, transfers: [], confirmations: 0, minConfirmations: cfg.minConfirmations });
  const confirmations = head && info.blockNumber ? head - info.blockNumber + 1 : 0;
  return decide({
    ...args,
    success: (info.receipt?.result || 'SUCCESS') === 'SUCCESS' && !info.result,
    transfers: tronTransfers(info, args.tokenContract, args.recipient),
    confirmations: solid && solid.id ? Math.max(confirmations, cfg.minConfirmations) : Math.min(confirmations, cfg.minConfirmations - 1),
    minConfirmations: cfg.minConfirmations,
    txTime: info.blockTimeStamp || null,
  });
}

/**
 * Checks one transaction against a network's settings.
 * args: { network, txHash, tokenContract, decimals, recipient, expectedAmount, notBefore, notAfter }
 */
export async function verifyTransfer(args) {
  const cfg = CHAINS[args.network];
  if (!cfg) throw new Error('This network has no automatic check.');
  return cfg.kind === 'evm' ? checkEvm(cfg, args) : checkTron(cfg, args);
}
