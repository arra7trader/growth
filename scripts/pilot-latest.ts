import tursoClient from '../src/lib/db';

interface PilotReportSummary {
  reportId: string;
  cycle: number;
  generatedAt: string;
  mode: string;
  health: { status: string; issues: string[] };
  actions: {
    evolutionTriggered: boolean;
    evolutionSuccess: boolean;
    evolutionUrl: string | null;
    adStrategy: string;
  };
  kpi: {
    latestTraffic: number;
    latestRevenue: number;
    revenue24h: number;
    revenue7d: number;
    avgCtr7d: number;
    evolutions7d: number;
  };
}

function toNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

async function main() {
  const result = await tursoClient.execute({
    sql: `
      SELECT content_data, metadata, updated_at
      FROM dynamic_content
      WHERE content_type = 'pilot_report'
      ORDER BY updated_at DESC
      LIMIT 1
    `,
    args: [],
  });

  if (result.rows.length === 0) {
    console.log('No pilot report found yet. Run: npm run pilot:once');
    process.exit(0);
  }

  const row = result.rows[0] as Record<string, unknown>;
  const report = JSON.parse(String(row.content_data || '{}')) as PilotReportSummary;
  const metadata = JSON.parse(String(row.metadata || '{}')) as { mdPath?: string; jsonPath?: string };

  console.log('Pilot Bot Latest Report');
  console.log('=======================');
  console.log(`Report ID: ${report.reportId}`);
  console.log(`Cycle: ${report.cycle}`);
  console.log(`Generated: ${report.generatedAt}`);
  console.log(`Mode: ${report.mode}`);
  console.log(`Health: ${report.health?.status || 'unknown'}`);
  console.log(`Evolution: ${report.actions?.evolutionTriggered}/${report.actions?.evolutionSuccess}`);
  console.log(`Ad strategy: ${report.actions?.adStrategy || 'n/a'}`);
  console.log(`Traffic: ${toNumber(report.kpi?.latestTraffic).toFixed(0)}`);
  console.log(`Revenue (latest): $${toNumber(report.kpi?.latestRevenue).toFixed(2)}`);
  console.log(`Revenue (24h): $${toNumber(report.kpi?.revenue24h).toFixed(2)}`);
  console.log(`Revenue (7d): $${toNumber(report.kpi?.revenue7d).toFixed(2)}`);
  console.log(`CTR (7d): ${(toNumber(report.kpi?.avgCtr7d) * 100).toFixed(2)}%`);
  console.log(`Evolutions (7d): ${toNumber(report.kpi?.evolutions7d).toFixed(0)}`);

  if (report.health?.issues?.length > 0) {
    console.log('Issues:');
    for (const issue of report.health.issues) {
      console.log(`- ${issue}`);
    }
  }

  if (metadata.mdPath) {
    console.log(`Markdown report: ${metadata.mdPath}`);
  }
  if (metadata.jsonPath) {
    console.log(`JSON report: ${metadata.jsonPath}`);
  }
}

main().catch((error) => {
  console.error('Failed to read latest pilot report:', error);
  process.exit(1);
});
