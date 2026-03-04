import tursoClient from './db';

const DEFAULT_BSC_RPC_URL = 'https://bsc-dataseed.binance.org';
const DEFAULT_USDT_BSC_CONTRACT = '0x55d398326f99059fF775485246999027B3197955';
const DEFAULT_PAYOUT_WALLET = '0x84a06ffc26031b782c893252a769bd146bca8ad0';
const DEFAULT_NETWORK = 'BEP20';
const DEFAULT_TOKEN_SYMBOL = 'USDT';
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const TOKEN_DECIMALS = 18;

interface RpcResponse<T> {
  result?: T;
  error?: {
    code: number;
    message: string;
  };
}

interface EvmLog {
  transactionHash: string;
  blockNumber: string;
  logIndex: string;
  data: string;
}

function isEvmAddress(value: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(value);
}

function hexToNumber(value: string | null | undefined): number {
  if (!value) {
    return 0;
  }
  return Number.parseInt(value.replace(/^0x/i, ''), 16) || 0;
}

function numberToHex(value: number): string {
  return `0x${Math.max(0, value).toString(16)}`;
}

function addressTopic(address: string): string {
  return `0x${address.toLowerCase().replace(/^0x/, '').padStart(64, '0')}`;
}

function bigIntToTokenAmount(raw: bigint, decimals: number): number {
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

async function rpcCall<T>(method: string, params: unknown[]): Promise<T> {
  const rpcUrl = process.env.BSC_RPC_URL || DEFAULT_BSC_RPC_URL;
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method,
      params,
    }),
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`BSC RPC HTTP ${response.status}`);
  }

  const payload = (await response.json()) as RpcResponse<T>;
  if (payload.error) {
    throw new Error(`BSC RPC error ${payload.error.code}: ${payload.error.message}`);
  }

  if (payload.result === undefined) {
    throw new Error(`BSC RPC returned empty result for ${method}`);
  }

  return payload.result;
}

async function getSetting(key: string): Promise<string | null> {
  const result = await tursoClient.execute({
    sql: 'SELECT setting_value FROM system_settings WHERE setting_key = ? LIMIT 1',
    args: [key],
  });

  return (result.rows[0]?.setting_value as string | undefined) || null;
}

async function setSetting(key: string, value: string): Promise<void> {
  await tursoClient.execute({
    sql: `
      INSERT INTO system_settings (setting_key, setting_value)
      VALUES (?, ?)
      ON CONFLICT(setting_key) DO UPDATE SET
        setting_value = excluded.setting_value,
        updated_at = CURRENT_TIMESTAMP
    `,
    args: [key, value],
  });
}

async function alreadyRecorded(chain: string, txHash: string, logIndex: number): Promise<boolean> {
  const result = await tursoClient.execute({
    sql: `
      SELECT id
      FROM onchain_receipts
      WHERE chain = ? AND tx_hash = ? AND log_index = ?
      LIMIT 1
    `,
    args: [chain, txHash, logIndex],
  });

  return result.rows.length > 0;
}

export function getOnchainWalletConfig() {
  const address = process.env.AETHER_PAYOUT_USDT_BEP20_ADDRESS || DEFAULT_PAYOUT_WALLET;
  const tokenContract = process.env.USDT_BSC_CONTRACT || DEFAULT_USDT_BSC_CONTRACT;
  const network = process.env.AETHER_PAYOUT_NETWORK || DEFAULT_NETWORK;
  const tokenSymbol = process.env.AETHER_PAYOUT_TOKEN || DEFAULT_TOKEN_SYMBOL;
  const rpcUrl = process.env.BSC_RPC_URL || DEFAULT_BSC_RPC_URL;

  return {
    address,
    tokenContract,
    network,
    tokenSymbol,
    rpcUrl,
    configured: isEvmAddress(address) && isEvmAddress(tokenContract),
  };
}

export async function syncOnchainUsdtPayments(): Promise<{
  synced: boolean;
  newTransfers: number;
  amount: number;
  fromBlock: number | null;
  toBlock: number | null;
  error?: string;
}> {
  const wallet = getOnchainWalletConfig();
  if (!wallet.configured) {
    const message = 'Wallet or token contract is invalid';
    await setSetting('onchain_last_error', message);
    return {
      synced: false,
      newTransfers: 0,
      amount: 0,
      fromBlock: null,
      toBlock: null,
      error: message,
    };
  }

  try {
    const latestBlockHex = await rpcCall<string>('eth_blockNumber', []);
    const latestBlock = hexToNumber(latestBlockHex);
    const lastScannedBlock = Number(await getSetting('onchain_last_scanned_block')) || 0;
    const fromBlock = lastScannedBlock > 0 ? lastScannedBlock + 1 : Math.max(1, latestBlock - 2000);
    const toBlock = latestBlock;

    if (fromBlock > toBlock) {
      await setSetting('onchain_last_synced_at', new Date().toISOString());
      return {
        synced: true,
        newTransfers: 0,
        amount: 0,
        fromBlock,
        toBlock,
      };
    }

    const logs = await rpcCall<EvmLog[]>('eth_getLogs', [
      {
        address: wallet.tokenContract,
        fromBlock: numberToHex(fromBlock),
        toBlock: numberToHex(toBlock),
        topics: [TRANSFER_TOPIC, null, addressTopic(wallet.address)],
      },
    ]);

    let newTransfers = 0;
    let totalAmount = 0;

    for (const entry of logs) {
      const txHash = String(entry.transactionHash || '').toLowerCase();
      const logIndex = hexToNumber(entry.logIndex);
      if (!txHash) {
        continue;
      }

      const exists = await alreadyRecorded(wallet.network, txHash, logIndex);
      if (exists) {
        continue;
      }

      const rawValue = BigInt(entry.data || '0x0');
      const amount = bigIntToTokenAmount(rawValue, TOKEN_DECIMALS);
      const blockNumber = hexToNumber(entry.blockNumber);

      await tursoClient.execute({
        sql: `
          INSERT INTO onchain_receipts (chain, token_symbol, tx_hash, log_index, block_number, amount, metadata)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
        args: [
          wallet.network,
          wallet.tokenSymbol,
          txHash,
          logIndex,
          blockNumber,
          amount,
          JSON.stringify({
            tokenContract: wallet.tokenContract,
            wallet: wallet.address,
          }),
        ],
      });

      await tursoClient.execute({
        sql: `
          INSERT INTO tracking_events (event_type, value, source, metadata)
          VALUES ('saas_sale', ?, 'onchain_bep20', ?)
        `,
        args: [
          amount,
          JSON.stringify({
            txHash,
            logIndex,
            blockNumber,
            network: wallet.network,
            token: wallet.tokenSymbol,
            tokenContract: wallet.tokenContract,
            payoutAddress: wallet.address,
          }),
        ],
      });

      newTransfers += 1;
      totalAmount += amount;
    }

    await Promise.all([
      setSetting('onchain_last_scanned_block', String(toBlock)),
      setSetting('onchain_last_synced_at', new Date().toISOString()),
      setSetting('onchain_last_error', ''),
    ]);

    if (newTransfers > 0) {
      await tursoClient.execute({
        sql: `
          INSERT INTO logs (level, message, context)
          VALUES ('success', ?, ?)
        `,
        args: [
          `Detected ${newTransfers} on-chain ${wallet.tokenSymbol} transfer(s)`,
          JSON.stringify({
            network: wallet.network,
            totalAmount: Number(totalAmount.toFixed(6)),
            toBlock,
          }),
        ],
      });
    }

    return {
      synced: true,
      newTransfers,
      amount: Number(totalAmount.toFixed(6)),
      fromBlock,
      toBlock,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    await setSetting('onchain_last_error', message);
    return {
      synced: false,
      newTransfers: 0,
      amount: 0,
      fromBlock: null,
      toBlock: null,
      error: message,
    };
  }
}
