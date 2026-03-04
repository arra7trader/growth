import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { runEvolutionCycle } from '../src/lib/brain';
import tursoClient, { initializeDatabase } from '../src/lib/db';
import { getMonetizationDashboard, initializeAffiliateLinks, optimizeAdPlacement } from '../src/lib/monetization';

type OperationMode = 'free_manual' | 'free_autonomous';

interface PilotConfig {
  once: boolean;
  maxCycles: number;
  cycleIntervalMinutes: number;
  evolutionIntervalMinutes: number;
  forceFirstEvolution: boolean;
  reportDir: string;
  writeReportsToFiles: boolean;
  operationMode: OperationMode;
}

interface KpiSnapshot {
  capturedAt: string;
  latestTraffic: number;
  latestRevenue: number;
  revenue24h: number;
  revenue7d: number;
  affiliateRevenue7d: number;
  saasRevenue7d: number;
  avgCtr7d: number;
  activeFeatures: number;
  evolutions7d: number;
  lastEvolutionAt: string | null;
  topAffiliates: Array<{
    keyword: string;
    clicks: number;
    revenue: number;
    conversionRate: number;
  }>;
}

interface PilotReport {
  reportId: string;
  cycle: number;
  generatedAt: string;
  mode: OperationMode;
  actions: {
    evolutionTriggered: boolean;
    evolutionSuccess: boolean;
    evolutionUrl: string | null;
    adStrategy: string;
    adRecommendations: string[];
  };
  health: {
    status: 'healthy' | 'attention';
    issues: string[];
  };
  kpi: KpiSnapshot;
  deltaFromPreviousCycle: {
    traffic: number;
    revenue24h: number;
    revenue7d: number;
    ctr7dPercent: number;
  };
}

const args = process.argv.slice(2);

function hasFlag(flag: string): boolean {
  return args.includes(flag);
}

function getArgValue(name: string): string | undefined {
  const inline = args.find((item) => item.startsWith(`${name}=`));
  if (inline) {
    return inline.slice(name.length + 1);
  }

  const idx = args.indexOf(name);
  if (idx >= 0 && idx < args.length - 1) {
    const value = args[idx + 1];
    if (!value.startsWith('--')) {
      return value;
    }
  }

  return undefined;
}

function toNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toBoolean(value: string | undefined, fallback: boolean): boolean {
  if (!value) {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }

  return fallback;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function rowValue(rows: readonly unknown[], key: string): unknown {
  const row = rows[0] as Record<string, unknown> | undefined;
  return row?.[key];
}

function getConfig(): PilotConfig {
  const once = hasFlag('--once');

  const cycleIntervalMinutes = toNumber(
    getArgValue('--interval-minutes') || process.env.PILOT_INTERVAL_MINUTES,
    30
  );
  const evolutionIntervalMinutes = toNumber(
    getArgValue('--evolution-minutes') || process.env.PILOT_EVOLUTION_INTERVAL_MINUTES,
    180
  );

  const maxCyclesFromInput = toNumber(getArgValue('--cycles') || process.env.PILOT_MAX_CYCLES, 0);
  const maxCycles = once ? 1 : Math.max(0, maxCyclesFromInput);

  const reportDir = path.resolve(process.cwd(), process.env.PILOT_REPORT_DIR || 'reports/pilot');

  const operationModeRaw =
    (getArgValue('--mode') || process.env.PILOT_OPERATION_MODE || 'free_autonomous').trim();
  const operationMode: OperationMode =
    operationModeRaw === 'free_manual' ? 'free_manual' : 'free_autonomous';

  return {
    once,
    maxCycles,
    cycleIntervalMinutes: Math.max(1, cycleIntervalMinutes),
    evolutionIntervalMinutes: Math.max(1, evolutionIntervalMinutes),
    forceFirstEvolution: toBoolean(process.env.PILOT_FORCE_FIRST_EVOLUTION, true),
    reportDir,
    writeReportsToFiles: toBoolean(process.env.PILOT_WRITE_REPORTS, true),
    operationMode,
  };
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

async function queryScalarNumber(sql: string): Promise<number> {
  const result = await tursoClient.execute({ sql, args: [] });
  return toNumber(rowValue(result.rows, 'value'), 0);
}

async function queryLastEvolutionAt(): Promise<string | null> {
  const result = await tursoClient.execute({
    sql: 'SELECT created_at AS value FROM evolution_history ORDER BY created_at DESC LIMIT 1',
    args: [],
  });
  const raw = rowValue(result.rows, 'value');
  if (!raw) {
    return null;
  }

  const parsed = new Date(String(raw));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

async function getKpiSnapshot(): Promise<KpiSnapshot> {
  const monetization = await getMonetizationDashboard();

  const [
    latestTraffic,
    latestRevenue,
    revenue24h,
    revenue7d,
    affiliateRevenue7d,
    saasRevenue7d,
    avgCtr7d,
    activeFeatures,
    evolutions7d,
    lastEvolutionAt,
  ] = await Promise.all([
    queryScalarNumber(
      `SELECT COALESCE(value, 0) AS value
       FROM growth_metrics
       WHERE metric_type = 'traffic'
       ORDER BY created_at DESC
       LIMIT 1`
    ),
    queryScalarNumber(
      `SELECT COALESCE(value, 0) AS value
       FROM growth_metrics
       WHERE metric_type = 'revenue'
       ORDER BY created_at DESC
       LIMIT 1`
    ),
    queryScalarNumber(
      `SELECT COALESCE(SUM(value), 0) AS value
       FROM growth_metrics
       WHERE metric_type = 'revenue'
       AND created_at >= datetime('now', '-1 day')`
    ),
    queryScalarNumber(
      `SELECT COALESCE(SUM(value), 0) AS value
       FROM growth_metrics
       WHERE metric_type = 'revenue'
       AND created_at >= datetime('now', '-7 days')`
    ),
    queryScalarNumber(
      `SELECT COALESCE(SUM(value), 0) AS value
       FROM growth_metrics
       WHERE metric_type = 'affiliate_revenue'
       AND created_at >= datetime('now', '-7 days')`
    ),
    queryScalarNumber(
      `SELECT COALESCE(SUM(value), 0) AS value
       FROM growth_metrics
       WHERE metric_type = 'saas_revenue'
       AND created_at >= datetime('now', '-7 days')`
    ),
    queryScalarNumber(
      `SELECT COALESCE(AVG(value), 0) AS value
       FROM growth_metrics
       WHERE metric_type = 'ctr'
       AND created_at >= datetime('now', '-7 days')`
    ),
    queryScalarNumber(
      `SELECT COALESCE(COUNT(*), 0) AS value
       FROM dynamic_content
       WHERE content_type IN ('feature', 'locked_feature')
       AND is_active = 1`
    ),
    queryScalarNumber(
      `SELECT COALESCE(COUNT(*), 0) AS value
       FROM evolution_history
       WHERE created_at >= datetime('now', '-7 days')`
    ),
    queryLastEvolutionAt(),
  ]);

  const topAffiliates = (monetization.topAffiliates as Array<Record<string, unknown>>).slice(0, 5).map((row) => ({
    keyword: String(row.keyword ?? ''),
    clicks: toNumber(row.clicks),
    revenue: toNumber(row.revenue),
    conversionRate: toNumber(row.conversion_rate),
  }));

  return {
    capturedAt: new Date().toISOString(),
    latestTraffic,
    latestRevenue,
    revenue24h,
    revenue7d,
    affiliateRevenue7d,
    saasRevenue7d,
    avgCtr7d,
    activeFeatures,
    evolutions7d,
    lastEvolutionAt,
    topAffiliates,
  };
}

function shouldTriggerEvolution(
  snapshot: KpiSnapshot,
  config: PilotConfig
): boolean {
  if (!snapshot.lastEvolutionAt) {
    return config.forceFirstEvolution;
  }

  const elapsedMs = Date.now() - new Date(snapshot.lastEvolutionAt).getTime();
  const thresholdMs = config.evolutionIntervalMinutes * 60 * 1000;
  return elapsedMs >= thresholdMs;
}

function calculateDelta(current: number, previous: number): number {
  return Number((current - previous).toFixed(2));
}

function formatMoney(value: number): string {
  return `$${value.toFixed(2)}`;
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function timestampSlug(iso: string): string {
  return iso.replace(/[:.]/g, '-');
}

function buildMarkdownReport(report: PilotReport): string {
  const issuesText =
    report.health.issues.length > 0 ? report.health.issues.map((item) => `- ${item}`).join('\n') : '- none';

  const affiliateText =
    report.kpi.topAffiliates.length > 0
      ? report.kpi.topAffiliates
          .map(
            (item) =>
              `- ${item.keyword}: clicks=${item.clicks}, revenue=${formatMoney(item.revenue)}, cvr=${formatPercent(
                item.conversionRate
              )}`
          )
          .join('\n')
      : '- no affiliate records yet';

  return [
    `# Pilot Bot Report - Cycle ${report.cycle}`,
    '',
    `Generated: ${report.generatedAt}`,
    `Mode: ${report.mode}`,
    `Health: ${report.health.status}`,
    '',
    '## Actions',
    `- Evolution triggered: ${report.actions.evolutionTriggered}`,
    `- Evolution success: ${report.actions.evolutionSuccess}`,
    `- Evolution URL: ${report.actions.evolutionUrl ?? 'n/a'}`,
    `- Ad strategy: ${report.actions.adStrategy}`,
    '',
    '## KPI Snapshot',
    `- Latest traffic: ${report.kpi.latestTraffic.toFixed(0)} visitors`,
    `- Latest revenue: ${formatMoney(report.kpi.latestRevenue)}`,
    `- Revenue 24h: ${formatMoney(report.kpi.revenue24h)}`,
    `- Revenue 7d: ${formatMoney(report.kpi.revenue7d)}`,
    `- Affiliate revenue 7d: ${formatMoney(report.kpi.affiliateRevenue7d)}`,
    `- SaaS revenue 7d: ${formatMoney(report.kpi.saasRevenue7d)}`,
    `- Avg CTR 7d: ${formatPercent(report.kpi.avgCtr7d)}`,
    `- Active features: ${report.kpi.activeFeatures}`,
    `- Evolutions 7d: ${report.kpi.evolutions7d}`,
    '',
    '## Delta From Previous Cycle',
    `- Traffic delta: ${report.deltaFromPreviousCycle.traffic}`,
    `- Revenue 24h delta: ${report.deltaFromPreviousCycle.revenue24h}`,
    `- Revenue 7d delta: ${report.deltaFromPreviousCycle.revenue7d}`,
    `- CTR 7d delta (pp): ${report.deltaFromPreviousCycle.ctr7dPercent}`,
    '',
    '## Health Issues',
    issuesText,
    '',
    '## Top Affiliates',
    affiliateText,
    '',
    '## Ad Recommendations',
    ...report.actions.adRecommendations.map((item) => `- ${item}`),
    '',
  ].join('\n');
}

async function saveReport(report: PilotReport, config: PilotConfig): Promise<{ jsonPath: string | null; mdPath: string | null }> {
  let jsonPath: string | null = null;
  let mdPath: string | null = null;

  if (config.writeReportsToFiles) {
    await mkdir(config.reportDir, { recursive: true });
    const slug = timestampSlug(report.generatedAt);
    jsonPath = path.join(config.reportDir, `${slug}-cycle-${String(report.cycle).padStart(4, '0')}.json`);
    mdPath = path.join(config.reportDir, `${slug}-cycle-${String(report.cycle).padStart(4, '0')}.md`);

    await writeFile(jsonPath, JSON.stringify(report, null, 2), 'utf-8');
    await writeFile(mdPath, buildMarkdownReport(report), 'utf-8');
  }

  await tursoClient.execute({
    sql: `
      INSERT INTO dynamic_content (content_type, content_key, content_data, metadata)
      VALUES (?, ?, ?, ?)
    `,
    args: [
      'pilot_report',
      report.reportId,
      JSON.stringify(report),
      JSON.stringify({
        generatedBy: 'pilot-bot',
        jsonPath,
        mdPath,
      }),
    ],
  });

  await tursoClient.execute({
    sql: `
      INSERT INTO logs (level, message, context)
      VALUES (?, ?, ?)
    `,
    args: [
      'pilot',
      `Pilot cycle ${report.cycle} finished (${report.health.status})`,
      JSON.stringify({
        reportId: report.reportId,
        evolutionTriggered: report.actions.evolutionTriggered,
        evolutionSuccess: report.actions.evolutionSuccess,
        jsonPath,
        mdPath,
      }),
    ],
  });

  return { jsonPath, mdPath };
}

function buildHealthIssues(report: {
  kpi: KpiSnapshot;
  evolutionTriggered: boolean;
  evolutionSuccess: boolean;
}): string[] {
  const issues: string[] = [];

  if (report.kpi.latestTraffic <= 0) {
    issues.push('Traffic is zero.');
  }

  if (report.kpi.latestRevenue <= 0) {
    issues.push('Revenue is zero.');
  }

  if (report.evolutionTriggered && !report.evolutionSuccess) {
    issues.push('Evolution cycle failed.');
  }

  if (report.kpi.topAffiliates.length === 0) {
    issues.push('No affiliate performance data yet.');
  }

  return issues;
}

async function runCycle(
  cycle: number,
  previousSnapshot: KpiSnapshot | null,
  config: PilotConfig
): Promise<KpiSnapshot> {
  console.log(`\n[PilotBot] Cycle ${cycle} started at ${new Date().toISOString()}`);

  await initializeAffiliateLinks();
  const snapshotBefore = await getKpiSnapshot();
  const adStrategy = await optimizeAdPlacement();

  const triggerEvolution = shouldTriggerEvolution(snapshotBefore, config);
  let evolutionSuccess = true;
  let evolutionUrl: string | null = null;

  if (triggerEvolution) {
    try {
      const evolution = await runEvolutionCycle();
      evolutionSuccess = Boolean(evolution.success);
      evolutionUrl = evolution.url || null;
    } catch (error) {
      evolutionSuccess = false;
      evolutionUrl = null;
      console.error('[PilotBot] Evolution error:', error);
    }
  }

  const snapshotAfter = await getKpiSnapshot();
  const baseline = previousSnapshot || snapshotBefore;
  const issues = buildHealthIssues({
    kpi: snapshotAfter,
    evolutionTriggered: triggerEvolution,
    evolutionSuccess,
  });

  const report: PilotReport = {
    reportId: `pilot_report_${Date.now()}`,
    cycle,
    generatedAt: new Date().toISOString(),
    mode: config.operationMode,
    actions: {
      evolutionTriggered: triggerEvolution,
      evolutionSuccess,
      evolutionUrl,
      adStrategy: adStrategy.strategy,
      adRecommendations: adStrategy.recommendedChanges,
    },
    health: {
      status: issues.length === 0 ? 'healthy' : 'attention',
      issues,
    },
    kpi: snapshotAfter,
    deltaFromPreviousCycle: {
      traffic: calculateDelta(snapshotAfter.latestTraffic, baseline.latestTraffic),
      revenue24h: calculateDelta(snapshotAfter.revenue24h, baseline.revenue24h),
      revenue7d: calculateDelta(snapshotAfter.revenue7d, baseline.revenue7d),
      ctr7dPercent: calculateDelta(snapshotAfter.avgCtr7d * 100, baseline.avgCtr7d * 100),
    },
  };

  const files = await saveReport(report, config);

  console.log(
    `[PilotBot] Cycle ${cycle} done | health=${report.health.status} | evolution=${report.actions.evolutionTriggered}/${report.actions.evolutionSuccess} | revenue24h=${formatMoney(
      report.kpi.revenue24h
    )}`
  );
  if (files.mdPath) {
    console.log(`[PilotBot] Report written: ${files.mdPath}`);
  }

  return snapshotAfter;
}

async function main() {
  const config = getConfig();

  console.log('Pilot Bot - Autonomous Website Operator');
  console.log('========================================');
  console.log(
    `[PilotBot] Config: once=${config.once}, cycleInterval=${config.cycleIntervalMinutes}m, evolutionInterval=${config.evolutionIntervalMinutes}m, mode=${config.operationMode}`
  );

  await initializeDatabase();
  await initializeAffiliateLinks();
  await setSetting('operation_mode', config.operationMode);
  await setSetting('pilot_bot_status', 'running');
  await setSetting('pilot_last_started_at', new Date().toISOString());

  let cycle = 0;
  let previousSnapshot: KpiSnapshot | null = null;

  while (true) {
    cycle += 1;
    previousSnapshot = await runCycle(cycle, previousSnapshot, config);

    if (config.once) {
      break;
    }

    if (config.maxCycles > 0 && cycle >= config.maxCycles) {
      break;
    }

    await sleep(config.cycleIntervalMinutes * 60 * 1000);
  }

  await setSetting('pilot_bot_status', 'idle');
  await setSetting('pilot_last_finished_at', new Date().toISOString());
  console.log('[PilotBot] Finished.');
}

main().catch(async (error) => {
  console.error('[PilotBot] Fatal error:', error);
  try {
    await setSetting('pilot_bot_status', 'failed');
    await setSetting('pilot_last_error', String(error));
  } catch {
    // ignore secondary failure
  }
  process.exit(1);
});
