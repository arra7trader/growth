import tursoClient from './db';

const DEFAULT_RPC_URLS = [
  'https://bsc-dataseed.binance.org',
  'https://bsc-rpc.publicnode.com',
  'https://rpc.ankr.com/bsc',
];
const DEFAULT_USDT_BSC_CONTRACT = '0x55d398326f99059fF775485246999027B3197955';
const DEFAULT_SCAN_INTERVAL_MINUTES = 30;
const DEFAULT_MAX_WALLETS = 8;
const DEFAULT_BNB_PRICE_FALLBACK_USD = 0;
const TOKEN_DECIMALS = 18;

const BUILTIN_DORMANT_WALLETS = [
  { address: '0x0000000000000000000000000000000000000000', label: 'Zero Address', category: 'burn' },
  { address: '0x000000000000000000000000000000000000dead', label: 'Dead Address', category: 'burn' },
  { address: '0x0000000000000000000000000000000000000001', label: 'Eater Address', category: 'burn' },
];

interface RpcPayload<T> {
  result?: T;
  error?: {
    code: number;
    message: string;
  };
}

export interface DormantWalletEntry {
  address: string;
  label: string;
  category: string;
  nativeBalance: number;
  usdtBalance: number;
  estimatedUsd: number;
  txCount: number;
  dormantLikely: boolean;
  collectible: false;
  reason: string;
}

export interface DormantWalletIntelSnapshot {
  generatedAt: string;
  chain: 'BSC';
  source: 'public_rpc';
  scannedWallets: number;
  totalEstimatedUsd: number;
  collectibleEstimatedUsd: number;
  inaccessibleEstimatedUsd: number;
  note: string;
  candidates: DormantWalletEntry[];
}

function toHex(value: string): string {
  return `0x${value.toLowerCase().replace(/^0x/, '').padStart(64, '0')}`;
}

function parseHexToNumber(value: string | null | undefined): number {
  if (!value) {
    return 0;
  }
  return Number.parseInt(value.replace(/^0x/i, ''), 16) || 0;
}

function parseHexBigInt(value: string | null | undefined): bigint {
  if (!value) {
    return BigInt(0);
  }
  try {
    return BigInt(value);
  } catch {
    return BigInt(0);
  }
}

function toTokenAmount(raw: bigint, decimals: number): number {
  if (raw <= BigInt(0)) {
    return 0;
  }
  const divisor = BigInt(10) ** BigInt(decimals);
  const integerPart = raw / divisor;
  const fractionPart = raw % divisor;
  const fractionText = fractionPart.toString().padStart(decimals, '0').replace(/0+$/, '');
  const normalized = fractionText ? `${integerPart.toString()}.${fractionText.slice(0, 8)}` : integerPart.toString();
  return Number.parseFloat(normalized);
}

function getRpcUrls(): string[] {
  const configured = String(process.env.BSC_RPC_URLS || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  if (configured.length > 0) {
    return configured;
  }

  const single = String(process.env.BSC_RPC_URL || '').trim();
  if (single) {
    return [single];
  }

  return DEFAULT_RPC_URLS;
}

async function rpcCall<T>(method: string, params: unknown[]): Promise<T> {
  const urls = getRpcUrls();
  let lastError = 'unknown_rpc_error';

  for (const url of urls) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: Date.now(),
          method,
          params,
        }),
        cache: 'no-store',
      });

      if (!response.ok) {
        throw new Error(`rpc_http_${response.status}`);
      }

      const payload = (await response.json()) as RpcPayload<T>;
      if (payload.error) {
        throw new Error(`rpc_error_${payload.error.code}:${payload.error.message}`);
      }

      if (payload.result === undefined) {
        throw new Error('rpc_empty_result');
      }

      return payload.result;
    } catch (error: unknown) {
      lastError = `${error instanceof Error ? error.message : String(error)} [rpc=${url}]`;
    }
  }

  throw new Error(lastError);
}

async function getSetting(key: string): Promise<string | null> {
  const result = await tursoClient.execute({
    sql: 'SELECT setting_value FROM system_settings WHERE setting_key = ? LIMIT 1',
    args: [key],
  });
  return (result.rows[0]?.setting_value as string | undefined) || null;
}

async function fetchBnbPriceUsd(): Promise<number> {
  const fallback = Number(process.env.DORMANT_BNB_PRICE_FALLBACK_USD || DEFAULT_BNB_PRICE_FALLBACK_USD) || 0;

  try {
    const response = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=binancecoin&vs_currencies=usd',
      { cache: 'no-store' }
    );
    if (!response.ok) {
      return fallback;
    }
    const body = (await response.json()) as { binancecoin?: { usd?: number } };
    const usd = Number(body?.binancecoin?.usd);
    return Number.isFinite(usd) && usd > 0 ? usd : fallback;
  } catch {
    return fallback;
  }
}

function parseConfiguredWallets(): Array<{ address: string; label: string; category: string }> {
  const raw = String(process.env.DORMANT_WALLET_WATCHLIST || '').trim();
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as Array<{ address?: string; label?: string; category?: string }>;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .map((item) => ({
        address: String(item.address || '').toLowerCase(),
        label: String(item.label || 'Watchlist Address').slice(0, 80),
        category: String(item.category || 'watchlist').slice(0, 24),
      }))
      .filter((item) => /^0x[a-f0-9]{40}$/.test(item.address));
  } catch {
    return [];
  }
}

function mergedWalletCandidates(): Array<{ address: string; label: string; category: string }> {
  const all = [...BUILTIN_DORMANT_WALLETS, ...parseConfiguredWallets()];
  const dedup = new Map<string, { address: string; label: string; category: string }>();
  for (const item of all) {
    const key = item.address.toLowerCase();
    if (!dedup.has(key)) {
      dedup.set(key, { address: key, label: item.label, category: item.category });
    }
  }
  const maxWallets = Math.max(1, Number(process.env.DORMANT_WALLET_MAX || DEFAULT_MAX_WALLETS) || DEFAULT_MAX_WALLETS);
  return Array.from(dedup.values()).slice(0, maxWallets);
}

function encodeUsdtBalanceOfCall(address: string): string {
  // balanceOf(address) selector + padded address
  return `0x70a08231${toHex(address).replace(/^0x/, '')}`;
}

async function fetchWalletEntry(
  address: string,
  label: string,
  category: string,
  bnbPriceUsd: number
): Promise<DormantWalletEntry> {
  const [balanceHex, nonceHex, usdtRawHex] = await Promise.all([
    rpcCall<string>('eth_getBalance', [address, 'latest']),
    rpcCall<string>('eth_getTransactionCount', [address, 'latest']),
    rpcCall<string>('eth_call', [
      {
        to: process.env.USDT_BSC_CONTRACT || DEFAULT_USDT_BSC_CONTRACT,
        data: encodeUsdtBalanceOfCall(address),
      },
      'latest',
    ]),
  ]);

  const nativeBalance = toTokenAmount(parseHexBigInt(balanceHex), TOKEN_DECIMALS);
  const usdtBalance = toTokenAmount(parseHexBigInt(usdtRawHex), TOKEN_DECIMALS);
  const txCount = parseHexToNumber(nonceHex);
  const estimatedUsd = Number((usdtBalance + nativeBalance * bnbPriceUsd).toFixed(2));
  const dormantLikely = txCount === 0;
  const reason =
    category === 'burn'
      ? 'Known burn/inaccessible wallet. Funds are publicly visible but not claimable.'
      : dormantLikely
      ? 'No outgoing transaction history detected (nonce=0). Ownership unknown.'
      : 'Public wallet with low activity signals; ownership unknown.';

  return {
    address,
    label,
    category,
    nativeBalance: Number(nativeBalance.toFixed(8)),
    usdtBalance: Number(usdtBalance.toFixed(6)),
    estimatedUsd,
    txCount,
    dormantLikely,
    collectible: false,
    reason,
  };
}

async function readCachedSnapshot(): Promise<DormantWalletIntelSnapshot | null> {
  const result = await tursoClient.execute({
    sql: `
      SELECT content_data
      FROM dynamic_content
      WHERE content_type = 'dormant_wallet_intel'
        AND content_key = 'dormant_wallet_intel_latest'
      LIMIT 1
    `,
    args: [],
  });

  if (!result.rows.length) {
    return null;
  }

  try {
    return JSON.parse(String(result.rows[0]?.content_data || '{}')) as DormantWalletIntelSnapshot;
  } catch {
    return null;
  }
}

async function writeSnapshot(snapshot: DormantWalletIntelSnapshot): Promise<void> {
  await tursoClient.execute({
    sql: `
      INSERT INTO dynamic_content (content_type, content_key, content_data, metadata)
      VALUES ('dormant_wallet_intel', 'dormant_wallet_intel_latest', ?, ?)
      ON CONFLICT(content_key) DO UPDATE SET
        content_data = excluded.content_data,
        metadata = excluded.metadata,
        updated_at = CURRENT_TIMESTAMP
    `,
    args: [
      JSON.stringify(snapshot),
      JSON.stringify({
        chain: snapshot.chain,
        scannedWallets: snapshot.scannedWallets,
        totalEstimatedUsd: snapshot.totalEstimatedUsd,
        generatedAt: snapshot.generatedAt,
      }),
    ],
  });
}

export async function getDormantWalletIntel(forceRefresh = false): Promise<DormantWalletIntelSnapshot> {
  const intervalMinutes =
    Number(process.env.DORMANT_WALLET_SCAN_INTERVAL_MINUTES || DEFAULT_SCAN_INTERVAL_MINUTES) ||
    DEFAULT_SCAN_INTERVAL_MINUTES;
  const cached = await readCachedSnapshot();

  if (!forceRefresh && cached?.generatedAt) {
    const ageMs = Date.now() - new Date(cached.generatedAt).getTime();
    if (Number.isFinite(ageMs) && ageMs >= 0 && ageMs < intervalMinutes * 60 * 1000) {
      return cached;
    }
  }

  const candidates = mergedWalletCandidates();
  const bnbPriceUsd = await fetchBnbPriceUsd();
  const entries: DormantWalletEntry[] = [];

  for (const candidate of candidates) {
    try {
      const entry = await fetchWalletEntry(candidate.address, candidate.label, candidate.category, bnbPriceUsd);
      entries.push(entry);
    } catch (error: unknown) {
      entries.push({
        address: candidate.address,
        label: candidate.label,
        category: candidate.category,
        nativeBalance: 0,
        usdtBalance: 0,
        estimatedUsd: 0,
        txCount: 0,
        dormantLikely: false,
        collectible: false,
        reason: `Scan failed: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  entries.sort((a, b) => b.estimatedUsd - a.estimatedUsd);

  const totalEstimatedUsd = Number(entries.reduce((sum, item) => sum + item.estimatedUsd, 0).toFixed(2));
  const snapshot: DormantWalletIntelSnapshot = {
    generatedAt: new Date().toISOString(),
    chain: 'BSC',
    source: 'public_rpc',
    scannedWallets: entries.length,
    totalEstimatedUsd,
    collectibleEstimatedUsd: 0,
    inaccessibleEstimatedUsd: totalEstimatedUsd,
    note: 'Wallet intel is analytics-only. No private-key access, no fund claiming, no illegal transfer.',
    candidates: entries,
  };

  await writeSnapshot(snapshot);
  await tursoClient.execute({
    sql: `
      INSERT INTO logs (level, message, context)
      VALUES ('intel', ?, ?)
    `,
    args: [
      'Dormant wallet intel scan completed',
      JSON.stringify({
        scannedWallets: snapshot.scannedWallets,
        totalEstimatedUsd: snapshot.totalEstimatedUsd,
      }),
    ],
  });
  await tursoClient.execute({
    sql: `
      INSERT INTO system_settings (setting_key, setting_value)
      VALUES ('dormant_wallet_intel_last_run_at', ?)
      ON CONFLICT(setting_key) DO UPDATE SET
        setting_value = excluded.setting_value,
        updated_at = CURRENT_TIMESTAMP
    `,
    args: [snapshot.generatedAt],
  });

  return snapshot;
}

export async function getDormantWalletIntelLastRunAt(): Promise<string | null> {
  return await getSetting('dormant_wallet_intel_last_run_at');
}
