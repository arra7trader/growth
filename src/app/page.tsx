'use client';

import { useEffect, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';

type OperationMode = 'free_manual' | 'free_autonomous';
type Tab = 'overview' | 'logs' | 'metrics' | 'monetization' | 'evolution' | 'admin';

interface Log {
  id: number;
  level: string;
  message: string;
  context: string;
  created_at: string;
}

interface Metric {
  id: number;
  metric_type: string;
  metric_name: string;
  value: number;
  unit: string;
  created_at: string;
}

interface RevenuePoint {
  day: string;
  revenue: number;
  affiliate_revenue: number;
  saas_revenue: number;
  visitors: number;
}

interface TopAffiliate {
  keyword: string;
  clicks: number;
  revenue: number;
  conversion_rate: number;
}

interface MonetizationData {
  totalRevenue: number;
  affiliateRevenue: number;
  saasRevenue: number;
  topAffiliates: TopAffiliate[];
  lockedFeatures: Array<{ content_key: string; content_data: string }>;
  revenueTrend: RevenuePoint[];
}

interface AdminPilotStatus {
  status: string;
  lastStartedAt: string | null;
  lastFinishedAt: string | null;
  lastError: string | null;
  runner?: {
    running: boolean;
    pid: number | null;
  };
}

interface AdminPilotReport {
  id: number;
  key: string;
  createdAt: string | null;
  updatedAt: string | null;
  report: {
    reportId: string;
    cycle: number;
    generatedAt: string;
    mode: string;
    health?: {
      status?: string;
      issues?: string[];
    };
    actions?: {
      evolutionTriggered?: boolean;
      evolutionSuccess?: boolean;
      evolutionUrl?: string | null;
      adStrategy?: string;
    };
    kpi?: {
      latestTraffic?: number;
      latestRevenue?: number;
      revenue24h?: number;
      revenue7d?: number;
      avgCtr7d?: number;
      evolutions7d?: number;
    };
  } | null;
  metadata?: {
    mdPath?: string | null;
    jsonPath?: string | null;
  } | null;
}

interface SystemStatus {
  lastActivity: string | null;
  recentLogs: Log[];
  latestMetrics: Metric[];
  evolutionHistory: Array<{
    id: number;
    decision_type: string;
    implementation_status: string;
    decision_data: string;
    github_commit_hash: string | null;
    created_at: string;
  }>;
  activeContent: any[];
  monetization: MonetizationData;
  systemHealth: string;
  systemMode: 'free';
  operationMode: OperationMode;
  autoIntervalMinutes: number;
  autoEvolutionTriggered: boolean;
  lastEvolutionAt: string | null;
  nextAutoEvolutionAt: string | null;
  admin?: {
    pilotStatus: AdminPilotStatus;
    pilotReports: AdminPilotReport[];
  };
}

function safeNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatCurrency(value: unknown): string {
  return `$${safeNumber(value).toFixed(2)}`;
}

function labelForMode(mode?: OperationMode): string {
  if (mode === 'free_manual') {
    return 'FREE MANUAL';
  }

  return 'FREE AUTONOMOUS';
}

export default function Home() {
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [isEvolving, setIsEvolving] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>('overview');

  useEffect(() => {
    void fetchStatus();
    const interval = setInterval(() => {
      void fetchStatus();
    }, 10000);

    return () => clearInterval(interval);
  }, []);

  async function fetchStatus() {
    try {
      const response = await fetch('/api/evolve', { method: 'GET' });
      const data = await response.json();
      if (data.success) {
        setStatus(data.data as SystemStatus);
      }
    } catch (error) {
      console.error('Failed to fetch status:', error);
    } finally {
      setLoading(false);
    }
  }

  async function triggerEvolution() {
    setIsEvolving(true);
    try {
      const response = await fetch('/api/evolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'evolve' }),
      });
      const data = await response.json();
      if (data.success) {
        await fetchStatus();
      }
    } catch (error) {
      console.error('Evolution failed:', error);
    } finally {
      setIsEvolving(false);
    }
  }


  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-muted-foreground">Initializing autonomous free system...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-3 flex-wrap">
              <div className="w-3 h-3 bg-success rounded-full live-indicator" />
              <h1 className="text-2xl font-bold gradient-text">AETHER AUTO-SaaS</h1>
              <span className="text-xs text-muted-foreground px-2 py-1 bg-muted rounded-full">v1.1.0</span>
              <span className="text-xs px-2 py-1 rounded-full bg-success/20 text-success">100% FREE</span>
              <span className="text-xs px-2 py-1 rounded-full bg-primary/20 text-primary">
                {labelForMode(status?.operationMode)}
              </span>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">System:</span>
                <span
                  className={`font-medium ${
                    status?.systemHealth === 'operational' ? 'text-success' : 'text-warning'
                  }`}
                >
                  {status?.systemHealth || 'Unknown'}
                </span>
              </div>

              <button
                onClick={triggerEvolution}
                disabled={isEvolving}
                className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all glow-primary"
              >
                {isEvolving ? 'Evolving...' : 'Trigger Evolution'}
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <div className="flex flex-wrap gap-2 mb-6 border-b border-border">
          {(['overview', 'logs', 'metrics', 'monetization', 'evolution', 'admin'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 ${
                activeTab === tab
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>

        {activeTab === 'overview' && <OverviewTab status={status} />}
        {activeTab === 'logs' && <LogsTab logs={status?.recentLogs || []} />}
        {activeTab === 'metrics' && <MetricsTab metrics={status?.latestMetrics || []} />}
        {activeTab === 'monetization' && <MonetizationTab monetization={status?.monetization} />}
        {activeTab === 'evolution' && <EvolutionTab history={status?.evolutionHistory || []} />}
        {activeTab === 'admin' && <AdminTab admin={status?.admin} />}
      </main>
    </div>
  );
}

function OverviewTab({ status }: { status: SystemStatus | null }) {
  if (!status) {
    return null;
  }

  const traffic = status.latestMetrics.find((m) => m.metric_type === 'traffic');
  const revenue = status.latestMetrics.find((m) => m.metric_type === 'revenue');

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Traffic" value={Math.round(safeNumber(traffic?.value))} unit="visitors/day" />
        <StatCard title="Revenue" value={formatCurrency(revenue?.value)} unit="USD/day" />
        <StatCard title="Evolution Cycles" value={status.evolutionHistory.length} unit="cycles" />
        <StatCard
          title="Autonomous Interval"
          value={`${status.autoIntervalMinutes}m`}
          unit="auto-cycle cadence"
        />
      </div>

      <div className="bg-card rounded-lg border border-border p-6">
        <h2 className="text-lg font-semibold mb-4">Autonomous Control</h2>
        <div className="space-y-2 text-sm">
          <p>
            Mode: <span className="text-primary font-medium">{labelForMode(status.operationMode)}</span>
          </p>
          <p>
            Last evolution:{' '}
            <span className="text-primary font-medium">
              {status.lastEvolutionAt
                ? formatDistanceToNow(new Date(status.lastEvolutionAt), { addSuffix: true })
                : 'not yet'}
            </span>
          </p>
          <p>
            Next autonomous run:{' '}
            <span className="text-primary font-medium">
              {status.nextAutoEvolutionAt
                ? formatDistanceToNow(new Date(status.nextAutoEvolutionAt), { addSuffix: true })
                : 'pending'}
            </span>
          </p>
          {status.autoEvolutionTriggered && (
            <p className="text-success">Autonomous cycle was just triggered automatically.</p>
          )}
        </div>
      </div>

      <div className="bg-card rounded-lg border border-border p-6">
        <h2 className="text-lg font-semibold mb-4">Recent Activity</h2>
        <div className="space-y-3">
          {status.recentLogs.slice(0, 6).map((log) => (
            <div key={log.id} className="flex items-start gap-3 text-sm">
              <span
                className={`px-2 py-0.5 rounded text-xs font-medium ${
                  log.level === 'success'
                    ? 'bg-success/20 text-success'
                    : log.level === 'error'
                    ? 'bg-destructive/20 text-destructive'
                    : log.level === 'decision'
                    ? 'bg-primary/20 text-primary'
                    : 'bg-muted text-muted-foreground'
                }`}
              >
                {log.level}
              </span>
              <span className="flex-1">{log.message}</span>
              <span className="text-muted-foreground text-xs">
                {formatDistanceToNow(new Date(log.created_at), { addSuffix: true })}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function StatCard({ title, value, unit }: { title: string; value: string | number; unit: string }) {
  return (
    <div className="bg-card rounded-lg border border-border p-4 hover:border-primary/50 transition-colors">
      <p className="text-2xl font-bold text-foreground">{value}</p>
      <p className="text-sm text-muted-foreground">{title}</p>
      <p className="text-xs text-muted-foreground mt-1">{unit}</p>
    </div>
  );
}

function LogsTab({ logs }: { logs: Log[] }) {
  return (
    <div className="bg-card rounded-lg border border-border">
      <div className="p-4 border-b border-border">
        <h2 className="text-lg font-semibold">System Logs</h2>
      </div>
      <div className="divide-y divide-border">
        {logs.map((log) => (
          <div key={log.id} className="p-4 hover:bg-muted/50 transition-colors">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-2">
                  <span
                    className={`px-2 py-0.5 rounded text-xs font-medium ${
                      log.level === 'success'
                        ? 'bg-success/20 text-success'
                        : log.level === 'error'
                        ? 'bg-destructive/20 text-destructive'
                        : log.level === 'decision'
                        ? 'bg-primary/20 text-primary'
                        : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    {log.level}
                  </span>
                  <span className="text-sm font-medium">{log.message}</span>
                </div>
                {log.context && (
                  <pre className="text-xs text-muted-foreground bg-muted/50 p-2 rounded overflow-auto max-h-32">
                    {log.context}
                  </pre>
                )}
              </div>
              <span className="text-xs text-muted-foreground whitespace-nowrap">
                {formatDistanceToNow(new Date(log.created_at), { addSuffix: true })}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function MetricsTab({ metrics }: { metrics: Metric[] }) {
  return (
    <div className="space-y-4">
      {metrics.map((metric) => (
        <div key={metric.id} className="bg-card rounded-lg border border-border p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-muted-foreground">{metric.metric_name}</p>
              <p className="text-xs text-muted-foreground mt-1">{metric.metric_type}</p>
            </div>
            <div className="text-right">
              <p className="text-2xl font-bold">{safeNumber(metric.value).toFixed(2)}</p>
              <p className="text-xs text-muted-foreground">{metric.unit}</p>
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-3">
            Recorded {formatDistanceToNow(new Date(metric.created_at), { addSuffix: true })}
          </p>
        </div>
      ))}
    </div>
  );
}

function MonetizationTab({ monetization }: { monetization?: MonetizationData }) {
  if (!monetization) {
    return null;
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard title="Total Revenue (30d)" value={formatCurrency(monetization.totalRevenue)} unit="USD" />
        <StatCard
          title="Affiliate Revenue (30d)"
          value={formatCurrency(monetization.affiliateRevenue)}
          unit="USD"
        />
        <StatCard title="Micro-SaaS Revenue (30d)" value={formatCurrency(monetization.saasRevenue)} unit="USD" />
      </div>

      <div className="bg-card rounded-lg border border-border p-6">
        <h2 className="text-lg font-semibold mb-4">Revenue Trend (14 days)</h2>
        <div className="space-y-2">
          {monetization.revenueTrend.length === 0 && (
            <p className="text-sm text-muted-foreground">No revenue trend data yet.</p>
          )}
          {monetization.revenueTrend.map((point) => (
            <div key={point.day} className="flex items-center justify-between text-sm border-b border-border/60 py-2">
              <span>{point.day}</span>
              <span className="text-muted-foreground">
                Visitors: {safeNumber(point.visitors).toFixed(0)} | Affiliate:{' '}
                {formatCurrency(point.affiliate_revenue)} | SaaS: {formatCurrency(point.saas_revenue)} | Total:{' '}
                {formatCurrency(point.revenue)}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-card rounded-lg border border-border p-6">
        <h2 className="text-lg font-semibold mb-4">Top Affiliate Opportunities</h2>
        <div className="space-y-2">
          {monetization.topAffiliates.length === 0 && (
            <p className="text-sm text-muted-foreground">No affiliate data available yet.</p>
          )}
          {monetization.topAffiliates.map((item) => (
            <div key={item.keyword} className="flex items-center justify-between text-sm border-b border-border/60 py-2">
              <span className="font-medium">{item.keyword}</span>
              <span className="text-muted-foreground">
                Clicks: {safeNumber(item.clicks)} | Revenue: {formatCurrency(item.revenue)} | CVR:{' '}
                {(safeNumber(item.conversion_rate) * 100).toFixed(2)}%
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function formatRelativeTime(value: string | null | undefined): string {
  if (!value) {
    return 'n/a';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'n/a';
  }

  return formatDistanceToNow(date, { addSuffix: true });
}

function AdminTab({ admin }: { admin?: SystemStatus['admin'] }) {
  if (!admin) {
    return (
      <div className="bg-card rounded-lg border border-border p-6">
        <p className="text-sm text-muted-foreground">Admin data not available yet.</p>
      </div>
    );
  }

  const { pilotStatus, pilotReports } = admin;
  const isPilotRunning = Boolean(pilotStatus.runner?.running);

  return (
    <div className="space-y-6">
      <div className="bg-card rounded-lg border border-border p-6">
        <h2 className="text-lg font-semibold mb-4">Pilot Bot Status</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
          <div className="bg-muted/30 rounded p-3">
            <p className="text-muted-foreground">Status</p>
            <p className="font-medium text-primary">{pilotStatus.status || 'unknown'}</p>
          </div>
          <div className="bg-muted/30 rounded p-3">
            <p className="text-muted-foreground">Last Started</p>
            <p className="font-medium">{formatRelativeTime(pilotStatus.lastStartedAt)}</p>
          </div>
          <div className="bg-muted/30 rounded p-3">
            <p className="text-muted-foreground">Last Finished</p>
            <p className="font-medium">{formatRelativeTime(pilotStatus.lastFinishedAt)}</p>
          </div>
          <div className="bg-muted/30 rounded p-3">
            <p className="text-muted-foreground">Last Error</p>
            <p className="font-medium text-destructive">{pilotStatus.lastError || 'none'}</p>
          </div>
        </div>
        <div className="mt-4 flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="text-sm text-muted-foreground">
            Runner: {isPilotRunning ? `running (PID ${pilotStatus.runner?.pid ?? 'n/a'})` : 'stopped'}
          </div>
          <div className="text-xs px-2 py-1 rounded-md bg-primary/10 text-primary">
            always-on automation enabled
          </div>
        </div>
      </div>

      <div className="bg-card rounded-lg border border-border p-6">
        <h2 className="text-lg font-semibold mb-4">Pilot Reports</h2>
        <div className="space-y-4">
          {pilotReports.length === 0 && (
            <p className="text-sm text-muted-foreground">No pilot reports yet. Pilot will publish automatically.</p>
          )}

          {pilotReports.map((item) => {
            const report = item.report;

            return (
              <div key={item.id} className="border border-border rounded-lg p-4">
                <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="px-2 py-0.5 rounded text-xs font-medium bg-primary/20 text-primary">
                      {report?.reportId || item.key}
                    </span>
                    <span className="px-2 py-0.5 rounded text-xs font-medium bg-success/20 text-success">
                      health: {report?.health?.status || 'unknown'}
                    </span>
                    <span className="px-2 py-0.5 rounded text-xs font-medium bg-muted text-muted-foreground">
                      cycle: {report?.cycle ?? 'n/a'}
                    </span>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {formatRelativeTime(report?.generatedAt || item.updatedAt)}
                  </span>
                </div>

                <div className="mt-3 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
                  <div className="bg-muted/30 rounded p-2">
                    <p className="text-muted-foreground">Revenue 24h</p>
                    <p className="font-medium">{formatCurrency(report?.kpi?.revenue24h)}</p>
                  </div>
                  <div className="bg-muted/30 rounded p-2">
                    <p className="text-muted-foreground">Revenue 7d</p>
                    <p className="font-medium">{formatCurrency(report?.kpi?.revenue7d)}</p>
                  </div>
                  <div className="bg-muted/30 rounded p-2">
                    <p className="text-muted-foreground">Traffic</p>
                    <p className="font-medium">{safeNumber(report?.kpi?.latestTraffic).toFixed(0)}</p>
                  </div>
                  <div className="bg-muted/30 rounded p-2">
                    <p className="text-muted-foreground">CTR 7d</p>
                    <p className="font-medium">{(safeNumber(report?.kpi?.avgCtr7d) * 100).toFixed(2)}%</p>
                  </div>
                </div>

                <div className="mt-3 text-sm text-muted-foreground">
                  <p>
                    Evolution: {String(report?.actions?.evolutionTriggered)} /{' '}
                    {String(report?.actions?.evolutionSuccess)} | Strategy:{' '}
                    {report?.actions?.adStrategy || 'n/a'}
                  </p>
                  {item.metadata?.mdPath && <p>Markdown: {item.metadata.mdPath}</p>}
                  {item.metadata?.jsonPath && <p>JSON: {item.metadata.jsonPath}</p>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function EvolutionTab({ history }: { history: SystemStatus['evolutionHistory'] }) {
  const isGitCommitHash = (value: unknown) => typeof value === 'string' && /^[0-9a-f]{7,40}$/i.test(value);

  return (
    <div className="space-y-4">
      {history.length === 0 ? (
        <div className="bg-card rounded-lg border border-border p-8 text-center">
          <p className="text-muted-foreground">No evolution cycles recorded yet.</p>
          <p className="text-sm text-muted-foreground mt-2">
            Click "Trigger Evolution" or wait for always-on pilot automation.
          </p>
        </div>
      ) : (
        history.map((evolution) => {
          let prettyDecision = evolution.decision_data;
          try {
            prettyDecision = JSON.stringify(JSON.parse(evolution.decision_data), null, 2);
          } catch {
            prettyDecision = evolution.decision_data;
          }

          return (
            <div key={evolution.id} className="bg-card rounded-lg border border-border p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="px-2 py-0.5 rounded text-xs font-medium bg-primary/20 text-primary">
                      {evolution.decision_type}
                    </span>
                    <span className="px-2 py-0.5 rounded text-xs font-medium bg-success/20 text-success">
                      {evolution.implementation_status}
                    </span>
                  </div>
                  <pre className="text-sm text-muted-foreground bg-muted/50 p-3 rounded overflow-auto max-h-48">
                    {prettyDecision}
                  </pre>
                  {isGitCommitHash(evolution.github_commit_hash) && (
                    <a
                      href={`https://github.com/arra7trader/growth/commit/${evolution.github_commit_hash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-primary hover:underline mt-2 inline-block"
                    >
                      View Commit
                    </a>
                  )}
                  {!isGitCommitHash(evolution.github_commit_hash) && (
                    <p className="text-xs text-muted-foreground mt-2">
                      Local free evolution simulation saved to database.
                    </p>
                  )}
                </div>
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  {formatDistanceToNow(new Date(evolution.created_at), { addSuffix: true })}
                </span>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
