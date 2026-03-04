import { NextRequest, NextResponse } from 'next/server';
import { runEvolutionCycle } from '@/lib/brain';
import tursoClient, { initializeDatabase } from '@/lib/db';
import { getMonetizationDashboard, initializeAffiliateLinks } from '@/lib/monetization';
import { getOnchainWalletConfig, syncOnchainUsdtPayments } from '@/lib/onchain';

type OperationMode = 'free_manual' | 'free_autonomous';

let bootstrapPromise: Promise<void> | null = null;
let autonomousEvolutionPromise: Promise<void> | null = null;
let pilotEnsurePromise: Promise<void> | null = null;
let onchainSyncPromise: Promise<void> | null = null;
let onchainLastSyncMs = 0;

const SYSTEM_MODE = 'free_real';
const DEFAULT_OPERATION_MODE: OperationMode = 'free_autonomous';
const DEFAULT_AUTO_INTERVAL_MINUTES = 180;
const ADMIN_REPORT_LIMIT = 20;
const ONCHAIN_SYNC_INTERVAL_MS = 90 * 1000;
const DEFAULT_PULSE_INTERVAL_SECONDS = 45;

async function ensureSystemInitialized() {
  if (!bootstrapPromise) {
    bootstrapPromise = (async () => {
      await initializeDatabase();
      await initializeAffiliateLinks();
      await setSetting('operation_mode', DEFAULT_OPERATION_MODE);
    })().catch((error) => {
      bootstrapPromise = null;
      throw error;
    });
  }

  await bootstrapPromise;
  await ensurePilotAlwaysOn();
  await maybeSyncOnchainPayments();
}

function safeDateToISO(value: unknown): string | null {
  if (!value) {
    return null;
  }

  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString();
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

function sanitizePulseSource(value: unknown, fallback: string): string {
  const source = String(value || fallback).trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_');
  return source.slice(0, 64) || fallback;
}

async function markAutopilotPulse(source: string) {
  const now = new Date().toISOString();
  await Promise.all([
    setSetting('autopilot_last_pulse_at', now),
    setSetting('autopilot_last_pulse_source', source),
  ]);
}

async function maybeSyncOnchainPayments() {
  if (onchainSyncPromise) {
    await onchainSyncPromise;
    return;
  }

  const now = Date.now();
  if (now - onchainLastSyncMs < ONCHAIN_SYNC_INTERVAL_MS) {
    return;
  }

  onchainSyncPromise = (async () => {
    const result = await syncOnchainUsdtPayments();
    onchainLastSyncMs = Date.now();
    if (!result.synced && result.error) {
      console.error('On-chain sync failed:', result.error);
    }
  })().finally(() => {
    onchainSyncPromise = null;
  });

  await onchainSyncPromise;
}

async function getPilotRunnerState() {
  const status = await getSetting('pilot_bot_status');
  const running = status !== 'stopped' && status !== 'attention';

  return {
    running,
    pid: null as number | null,
    runtime: 'serverless',
  };
}

async function ensurePilotAlwaysOn() {
  if (!pilotEnsurePromise) {
    pilotEnsurePromise = (async () => {
      try {
        await setSetting('pilot_auto_managed', 'true');
        await setSetting('operation_mode', DEFAULT_OPERATION_MODE);
        await setSetting('autopilot_strategy', 'request_driven');
        await setSetting('autopilot_requires_traffic', 'true');
        await setSetting('autopilot_pulse_interval_seconds', String(DEFAULT_PULSE_INTERVAL_SECONDS));

        const [status, lastStarted] = await Promise.all([
          getSetting('pilot_bot_status'),
          getSetting('pilot_last_started_at'),
        ]);

        if (!status || status === 'idle' || status === 'starting' || status === 'stopped' || status === 'attention') {
          await setSetting('pilot_bot_status', 'running');
        }

        if (!lastStarted) {
          await setSetting('pilot_last_started_at', new Date().toISOString());
        }

        await setSetting('pilot_last_heartbeat_at', new Date().toISOString());
      } catch (error) {
        console.error('Failed to ensure pilot bot is always on:', error);
        await setSetting('pilot_bot_status', 'attention');
        await setSetting('pilot_last_error', String(error));
      }
    })().finally(() => {
      pilotEnsurePromise = null;
    });
  }

  await pilotEnsurePromise;
}

async function getRecentLogs() {
  const result = await tursoClient.execute({
    sql: 'SELECT * FROM logs ORDER BY created_at DESC LIMIT 50',
    args: [],
  });

  return result.rows;
}

function parseJson(value: unknown) {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(String(value));
  } catch {
    return null;
  }
}

async function getPilotReports() {
  const result = await tursoClient.execute({
    sql: `
      SELECT id, content_key, content_data, metadata, created_at, updated_at
      FROM dynamic_content
      WHERE content_type = 'pilot_report'
      ORDER BY updated_at DESC
      LIMIT ?
    `,
    args: [ADMIN_REPORT_LIMIT],
  });

  return result.rows.map((row) => {
    const report = parseJson(row.content_data) as Record<string, any> | null;
    const metadata = parseJson(row.metadata) as Record<string, any> | null;

    return {
      id: row.id,
      key: row.content_key,
      createdAt: safeDateToISO(row.created_at),
      updatedAt: safeDateToISO(row.updated_at),
      report: report
        ? {
            reportId: report.reportId,
            cycle: report.cycle,
            generatedAt: report.generatedAt,
            mode: report.mode,
            health: report.health,
            actions: report.actions,
            kpi: report.kpi,
          }
        : null,
      metadata: metadata
        ? {
            mdPath: metadata.mdPath || null,
            jsonPath: metadata.jsonPath || null,
          }
        : null,
    };
  });
}

async function getPilotStatus() {
  const [status, lastStarted, lastFinished, lastError, runner, autoManaged, lastHeartbeat] = await Promise.all([
    getSetting('pilot_bot_status'),
    getSetting('pilot_last_started_at'),
    getSetting('pilot_last_finished_at'),
    getSetting('pilot_last_error'),
    getPilotRunnerState(),
    getSetting('pilot_auto_managed'),
    getSetting('pilot_last_heartbeat_at'),
  ]);

  return {
    status: status || 'running',
    lastStartedAt: safeDateToISO(lastStarted),
    lastFinishedAt: safeDateToISO(lastFinished),
    lastHeartbeatAt: safeDateToISO(lastHeartbeat),
    lastError: lastError || null,
    runner,
    autoManaged: autoManaged !== 'false',
  };
}

async function getPayoutStatus() {
  const wallet = getOnchainWalletConfig();
  const [lastSyncedAt, lastScannedBlock, lastError] = await Promise.all([
    getSetting('onchain_last_synced_at'),
    getSetting('onchain_last_scanned_block'),
    getSetting('onchain_last_error'),
  ]);

  return {
    walletAddress: wallet.address,
    network: wallet.network,
    tokenSymbol: wallet.tokenSymbol,
    tokenContract: wallet.tokenContract,
    configured: wallet.configured,
    lastSyncedAt: safeDateToISO(lastSyncedAt),
    lastScannedBlock: Number(lastScannedBlock || 0) || null,
    lastError: lastError || null,
  };
}

async function getAutopilotStatus() {
  const [strategy, requiresTraffic, pulseInterval, lastPulseAt, lastPulseSource] = await Promise.all([
    getSetting('autopilot_strategy'),
    getSetting('autopilot_requires_traffic'),
    getSetting('autopilot_pulse_interval_seconds'),
    getSetting('autopilot_last_pulse_at'),
    getSetting('autopilot_last_pulse_source'),
  ]);

  return {
    strategy: strategy || 'request_driven',
    requiresTraffic: requiresTraffic !== 'false',
    pulseIntervalSeconds: Number(pulseInterval || DEFAULT_PULSE_INTERVAL_SECONDS) || DEFAULT_PULSE_INTERVAL_SECONDS,
    lastPulseAt: safeDateToISO(lastPulseAt),
    lastPulseSource: lastPulseSource || null,
  };
}

async function runAutonomousCheck() {
  const [intervalValue, evolutionResult] = await Promise.all([
    getSetting('auto_interval_minutes'),
    tursoClient.execute({
      sql: 'SELECT created_at FROM evolution_history ORDER BY created_at DESC LIMIT 1',
      args: [],
    }),
  ]);

  const operationMode = DEFAULT_OPERATION_MODE;
  const autoIntervalMinutes = Number(intervalValue || DEFAULT_AUTO_INTERVAL_MINUTES) || DEFAULT_AUTO_INTERVAL_MINUTES;
  const lastEvolutionAt = safeDateToISO(evolutionResult.rows[0]?.created_at);
  const autoEvolutionTriggered = maybeTriggerAutonomousEvolution(operationMode, autoIntervalMinutes, lastEvolutionAt);
  const nextAutoEvolutionAt = lastEvolutionAt
    ? new Date(new Date(lastEvolutionAt).getTime() + autoIntervalMinutes * 60 * 1000).toISOString()
    : new Date(Date.now() + autoIntervalMinutes * 60 * 1000).toISOString();

  return {
    operationMode,
    autoIntervalMinutes,
    lastEvolutionAt,
    nextAutoEvolutionAt,
    autoEvolutionTriggered,
  };
}

async function getRevenueTrend() {
  const result = await tursoClient.execute({
    sql: `
      SELECT
        date(created_at) AS day,
        ROUND(SUM(CASE WHEN metric_type = 'revenue' THEN value ELSE 0 END), 2) AS revenue,
        ROUND(SUM(CASE WHEN metric_type = 'affiliate_revenue' THEN value ELSE 0 END), 2) AS affiliate_revenue,
        ROUND(SUM(CASE WHEN metric_type = 'saas_revenue' THEN value ELSE 0 END), 2) AS saas_revenue,
        ROUND(SUM(CASE WHEN metric_type = 'traffic' THEN value ELSE 0 END), 0) AS visitors
      FROM growth_metrics
      WHERE created_at >= datetime('now', '-14 days')
      GROUP BY date(created_at)
      ORDER BY day DESC
      LIMIT 14
    `,
    args: [],
  });

  return result.rows;
}

function shouldRunAutonomousEvolution(
  operationMode: OperationMode,
  autoIntervalMinutes: number,
  lastEvolutionAt: string | null
) {
  if (operationMode !== 'free_autonomous') {
    return false;
  }

  if (autonomousEvolutionPromise) {
    return false;
  }

  if (!lastEvolutionAt) {
    return true;
  }

  const last = new Date(lastEvolutionAt).getTime();
  const elapsed = Date.now() - last;
  return elapsed >= autoIntervalMinutes * 60 * 1000;
}

function maybeTriggerAutonomousEvolution(
  operationMode: OperationMode,
  autoIntervalMinutes: number,
  lastEvolutionAt: string | null
) {
  const shouldRun = shouldRunAutonomousEvolution(operationMode, autoIntervalMinutes, lastEvolutionAt);

  if (!shouldRun) {
    return false;
  }

  autonomousEvolutionPromise = (async () => {
    try {
      await runEvolutionCycle();
    } catch (error) {
      console.error('Autonomous evolution failed:', error);
    }
  })().finally(() => {
    autonomousEvolutionPromise = null;
  });

  return true;
}

async function getSystemStatus() {
  try {
    const [
      logsResult,
      metricsResult,
      evolutionResult,
      contentResult,
      monetization,
      revenueTrend,
      intervalValue,
      pilotStatus,
      pilotReports,
      payoutStatus,
      autopilotStatus,
    ] =
      await Promise.all([
        tursoClient.execute({
          sql: 'SELECT * FROM logs ORDER BY created_at DESC LIMIT 10',
          args: [],
        }),
        tursoClient.execute({
          sql: 'SELECT * FROM growth_metrics ORDER BY created_at DESC LIMIT 20',
          args: [],
        }),
        tursoClient.execute({
          sql: 'SELECT * FROM evolution_history ORDER BY created_at DESC LIMIT 10',
          args: [],
        }),
        tursoClient.execute({
          sql: 'SELECT * FROM dynamic_content WHERE is_active = 1 ORDER BY updated_at DESC',
          args: [],
        }),
        getMonetizationDashboard(),
        getRevenueTrend(),
        getSetting('auto_interval_minutes'),
        getPilotStatus(),
        getPilotReports(),
        getPayoutStatus(),
        getAutopilotStatus(),
      ]);

    const operationMode = DEFAULT_OPERATION_MODE;
    const autoIntervalMinutes = Number(intervalValue || DEFAULT_AUTO_INTERVAL_MINUTES) || DEFAULT_AUTO_INTERVAL_MINUTES;
    const lastEvolutionAt = safeDateToISO(evolutionResult.rows[0]?.created_at);
    const autoEvolutionTriggered = maybeTriggerAutonomousEvolution(operationMode, autoIntervalMinutes, lastEvolutionAt);
    const nextAutoEvolutionAt = lastEvolutionAt
      ? new Date(new Date(lastEvolutionAt).getTime() + autoIntervalMinutes * 60 * 1000).toISOString()
      : new Date(Date.now() + autoIntervalMinutes * 60 * 1000).toISOString();

    return {
      lastActivity: safeDateToISO(logsResult.rows[0]?.created_at),
      recentLogs: logsResult.rows,
      latestMetrics: metricsResult.rows,
      evolutionHistory: evolutionResult.rows,
      activeContent: contentResult.rows,
      monetization: {
        ...monetization,
        revenueTrend,
      },
      systemHealth: 'operational',
      systemMode: SYSTEM_MODE,
      operationMode,
      autoIntervalMinutes,
      autoEvolutionTriggered,
      lastEvolutionAt,
      nextAutoEvolutionAt,
      admin: {
        pilotStatus,
        pilotReports,
        payoutStatus,
        autopilotStatus,
      },
    };
  } catch (error) {
    return {
      systemHealth: 'degraded',
      systemMode: SYSTEM_MODE,
      operationMode: DEFAULT_OPERATION_MODE,
      error: String(error),
    };
  }
}

export async function POST(request: NextRequest) {
  try {
    await ensureSystemInitialized();

    const body = await request.json();
    const { action } = body;

    if (action === 'evolve') {
      const result = await runEvolutionCycle();
      return NextResponse.json({
        success: true,
        message: 'Evolution cycle completed',
        data: result,
      });
    }

    if (action === 'set_mode' || action === 'start_pilot' || action === 'stop_pilot') {
      return NextResponse.json({
        success: false,
        error: 'Pilot bot is always-on and managed automatically. Manual control is disabled.',
      }, { status: 409 });
    }

    if (action === 'status') {
      await markAutopilotPulse(sanitizePulseSource(body.source, 'status_post'));
      const status = await getSystemStatus();
      return NextResponse.json({
        success: true,
        data: status,
      });
    }

    if (action === 'pulse') {
      const source = sanitizePulseSource(body.source, 'browser_heartbeat');
      await markAutopilotPulse(source);

      const autonomous = await runAutonomousCheck();
      const [pilotStatus, payoutStatus, autopilotStatus] = await Promise.all([
        getPilotStatus(),
        getPayoutStatus(),
        getAutopilotStatus(),
      ]);

      return NextResponse.json({
        success: true,
        data: {
          ...autonomous,
          admin: {
            pilotStatus,
            payoutStatus,
            autopilotStatus,
          },
        },
      });
    }

    if (action === 'logs') {
      const logs = await getRecentLogs();
      return NextResponse.json({
        success: true,
        data: logs,
      });
    }

    return NextResponse.json(
      { success: false, error: 'Invalid action' },
      { status: 400 }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('API error:', error);

    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}

export async function GET() {
  try {
    await ensureSystemInitialized();
    await markAutopilotPulse('status_get');
    const status = await getSystemStatus();
    return NextResponse.json({
      success: true,
      data: status,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
