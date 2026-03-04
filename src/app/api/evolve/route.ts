import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { runEvolutionCycle } from '@/lib/brain';
import tursoClient, { initializeDatabase } from '@/lib/db';
import { getMonetizationDashboard, initializeAffiliateLinks } from '@/lib/monetization';

type OperationMode = 'free_manual' | 'free_autonomous';

let bootstrapPromise: Promise<void> | null = null;
let autonomousEvolutionPromise: Promise<void> | null = null;
let pilotEnsurePromise: Promise<void> | null = null;

const SYSTEM_MODE = 'free';
const DEFAULT_OPERATION_MODE: OperationMode = 'free_autonomous';
const DEFAULT_AUTO_INTERVAL_MINUTES = 180;
const ADMIN_REPORT_LIMIT = 20;
const PILOT_RUNNER_PID_KEY = 'pilot_runner_pid';
const PILOT_SCRIPT_PATH = path.join(process.cwd(), 'scripts', 'pilot-bot.ts');
const PILOT_TSX_CLI_PATH = path.join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs');

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

function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function getPilotRunnerState() {
  const pidValue = await getSetting(PILOT_RUNNER_PID_KEY);
  const pid = Number(pidValue);

  if (!Number.isInteger(pid) || pid <= 0) {
    return {
      running: false,
      pid: null as number | null,
    };
  }

  const running = isProcessAlive(pid);

  if (!running) {
    await setSetting(PILOT_RUNNER_PID_KEY, '');
  }

  return {
    running,
    pid: running ? pid : null,
  };
}

async function startPilotBotProcess() {
  const runner = await getPilotRunnerState();
  if (runner.running) {
    return {
      started: false,
      alreadyRunning: true,
      pid: runner.pid,
      message: 'Pilot bot is already running',
    };
  }

  if (!existsSync(PILOT_SCRIPT_PATH)) {
    throw new Error(`Pilot script not found: ${PILOT_SCRIPT_PATH}`);
  }

  if (!existsSync(PILOT_TSX_CLI_PATH)) {
    throw new Error(`tsx CLI not found: ${PILOT_TSX_CLI_PATH}`);
  }

  const child = spawn(process.execPath, [PILOT_TSX_CLI_PATH, PILOT_SCRIPT_PATH], {
    cwd: process.cwd(),
    env: process.env,
    detached: true,
    stdio: 'ignore',
  });

  child.unref();

  if (!child.pid) {
    throw new Error('Failed to start pilot bot process');
  }

  await setSetting(PILOT_RUNNER_PID_KEY, String(child.pid));
  await setSetting('pilot_bot_status', 'starting');
  await setSetting('pilot_last_started_at', new Date().toISOString());

  return {
    started: true,
    alreadyRunning: false,
    pid: child.pid,
    message: 'Pilot bot started',
  };
}

async function ensurePilotAlwaysOn() {
  if (!pilotEnsurePromise) {
    pilotEnsurePromise = (async () => {
      try {
        await setSetting('pilot_auto_managed', 'true');
        const runner = await getPilotRunnerState();
        if (runner.running) {
          return;
        }

        await startPilotBotProcess();
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
  const [status, lastStarted, lastFinished, lastError, runner, autoManaged] = await Promise.all([
    getSetting('pilot_bot_status'),
    getSetting('pilot_last_started_at'),
    getSetting('pilot_last_finished_at'),
    getSetting('pilot_last_error'),
    getPilotRunnerState(),
    getSetting('pilot_auto_managed'),
  ]);

  return {
    status: status || 'idle',
    lastStartedAt: safeDateToISO(lastStarted),
    lastFinishedAt: safeDateToISO(lastFinished),
    lastError: lastError || null,
    runner,
    autoManaged: autoManaged !== 'false',
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
      const status = await getSystemStatus();
      return NextResponse.json({
        success: true,
        data: status,
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
