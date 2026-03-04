'use client';

import { useEffect, useMemo, useState } from 'react';
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
  lastHeartbeatAt?: string | null;
  lastError: string | null;
  runner?: {
    running: boolean;
    pid: number | null;
    runtime?: string;
  };
  autoManaged?: boolean;
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

interface AdminPayoutStatus {
  walletAddress: string;
  network: string;
  tokenSymbol: string;
  tokenContract: string;
  configured: boolean;
  lastSyncedAt: string | null;
  lastScannedBlock: number | null;
  lastError: string | null;
}

interface AdminAutopilotStatus {
  strategy: string;
  requiresTraffic: boolean;
  pulseIntervalSeconds: number;
  lastPulseAt: string | null;
  lastPulseSource: string | null;
}

interface AdminCryptoStatus {
  status: string;
  intervalMinutes: number;
  lastRunAt: string | null;
  lastError: string | null;
  lastTotal: number;
  lastNew: number;
}

interface AdminCryptoOpportunity {
  key: string;
  source?: string;
  category?: string;
  title?: string;
  url?: string;
  summary?: string;
  tags?: string[];
  rewardEstimateUsd?: number;
  score?: number;
  updatedAt?: string | null;
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
  activeContent: unknown[];
  monetization: MonetizationData;
  systemHealth: string;
  systemMode: string;
  operationMode: OperationMode;
  autoIntervalMinutes: number;
  autoEvolutionTriggered: boolean;
  cryptoTriggered?: boolean;
  lastEvolutionAt: string | null;
  nextAutoEvolutionAt: string | null;
  admin?: {
    pilotStatus: AdminPilotStatus;
    pilotReports: AdminPilotReport[];
    payoutStatus?: AdminPayoutStatus;
    autopilotStatus?: AdminAutopilotStatus;
    cryptoStatus?: AdminCryptoStatus;
    cryptoOpportunities?: AdminCryptoOpportunity[];
  };
}

function safeNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function formatCurrency(value: unknown): string {
  return `$${safeNumber(value).toFixed(2)}`;
}

function formatRelativeTime(value: string | null | undefined): string {
  if (!value) {
    return 'n/a';
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    return 'n/a';
  }
  return formatDistanceToNow(d, { addSuffix: true });
}

function labelForMode(mode?: OperationMode): string {
  if (mode === 'free_manual') {
    return 'FREE MANUAL';
  }
  return 'FREE AUTONOMOUS';
}

function normalizeTrend(points: RevenuePoint[]): RevenuePoint[] {
  return [...points].reverse();
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function ensureSessionId(): string {
  if (typeof window === 'undefined') {
    return 'server-session';
  }

  const existing = window.sessionStorage.getItem('aether_session_id');
  if (existing) {
    return existing;
  }

  const sessionId = `sid_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  window.sessionStorage.setItem('aether_session_id', sessionId);
  return sessionId;
}

export default function Home() {
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('overview');

  useEffect(() => {
    void fetchStatus();
    void fetch('/api/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventType: 'page_view',
        value: 1,
        source: 'dashboard',
        sessionId: ensureSessionId(),
        metadata: {
          page: 'home',
        },
      }),
    }).catch(() => {
      // Tracking is best-effort and must not break UI.
    });

    void sendAutopilotPulse();

    const statusInterval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        void fetchStatus();
      }
    }, 30000);

    const pulseInterval = setInterval(() => {
      void sendAutopilotPulse();
    }, 45000);

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void fetchStatus();
        void sendAutopilotPulse();
      }
    };

    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      clearInterval(statusInterval);
      clearInterval(pulseInterval);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);

  async function sendAutopilotPulse() {
    try {
      await fetch('/api/evolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        keepalive: true,
        body: JSON.stringify({
          action: 'pulse',
          source: 'browser_heartbeat',
        }),
      });
    } catch {
      // Pulse is best-effort and should stay silent on failures.
    }
  }

  async function fetchStatus() {
    try {
      const response = await fetch('/api/evolve', { method: 'GET', cache: 'no-store' });
      const data = (await response.json()) as { success?: boolean; data?: SystemStatus; error?: string };

      if (response.ok && data.success && data.data) {
        setStatus(data.data as SystemStatus);
        setStatusError(null);
      } else {
        setStatusError(data.error || `Status API failed (${response.status})`);
      }
    } catch (error) {
      console.error('Failed to fetch status:', error);
      setStatusError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center aurora-bg">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-muted-foreground">Booting autonomous growth engine...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen aurora-bg">
      <div className="bg-grid min-h-screen">
        <header className="border-b border-border/70 bg-card/40 backdrop-blur-md sticky top-0 z-50">
          <div className="container mx-auto px-4 py-4">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex items-center gap-3 flex-wrap">
                <div className="w-3 h-3 bg-success rounded-full live-indicator" />
                <h1 className="text-2xl font-black tracking-tight gradient-text">AETHER AUTO-SaaS</h1>
                <span className="text-xs text-muted-foreground px-2 py-1 bg-muted rounded-full">v1.2.0</span>
                <span className="text-xs px-2 py-1 rounded-full bg-success/20 text-success">100% FREE</span>
                <span className="text-xs px-2 py-1 rounded-full bg-primary/20 text-primary">
                  {labelForMode(status?.operationMode)}
                </span>
              </div>

              <div className="flex items-center gap-3">
                <div className="text-sm text-muted-foreground">
                  System:{' '}
                  <span
                    className={`font-medium ${
                      statusError ? 'text-warning' : status?.systemHealth === 'operational' ? 'text-success' : 'text-warning'
                    }`}
                  >
                    {statusError ? 'degraded' : status?.systemHealth || 'unknown'}
                  </span>
                </div>
                <span className="px-3 py-1.5 rounded-lg bg-success/20 text-success text-xs font-semibold tracking-wide uppercase">
                  Autopilot Always On
                </span>
              </div>
            </div>
          </div>
        </header>

        <main className="container mx-auto px-4 py-8">
          <div className="flex flex-wrap gap-2 mb-8">
            {(['overview', 'logs', 'metrics', 'monetization', 'evolution', 'admin'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${
                  activeTab === tab
                    ? 'bg-primary/20 text-primary border border-primary/40'
                    : 'bg-card/50 border border-border/70 text-muted-foreground hover:text-foreground'
                }`}
              >
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>

          {statusError && (
            <div className="mb-6 rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm text-warning">
              Autopilot server reported issue: {statusError}
            </div>
          )}

          {activeTab === 'overview' && <OverviewTab status={status} />}
          {activeTab === 'logs' && <LogsTab logs={status?.recentLogs || []} />}
          {activeTab === 'metrics' && <MetricsTab metrics={status?.latestMetrics || []} />}
          {activeTab === 'monetization' && <MonetizationTab monetization={status?.monetization} />}
          {activeTab === 'evolution' && <EvolutionTab history={status?.evolutionHistory || []} />}
          {activeTab === 'admin' && <AdminTab admin={status?.admin} />}
        </main>
      </div>
    </div>
  );
}

function OverviewTab({ status }: { status: SystemStatus | null }) {
  if (!status) {
    return null;
  }

  const trend = normalizeTrend(status.monetization?.revenueTrend || []);
  const revenueSeries = trend.map((item) => safeNumber(item.revenue));
  const trafficSeries = trend.map((item) => safeNumber(item.visitors));
  const latestTraffic = safeNumber(status.latestMetrics.find((m) => m.metric_type === 'traffic')?.value);
  const latestRevenue = safeNumber(status.latestMetrics.find((m) => m.metric_type === 'revenue')?.value);
  const growthScore = clamp(
    Math.round(
      safeNumber(status.monetization?.totalRevenue) * 0.8 +
        status.evolutionHistory.length * 2 +
        status.activeContent.length * 1.5 +
        latestTraffic / 20
    ),
    0,
    100
  );

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="panel-glow bg-card/70 border border-border rounded-xl p-5 lg:col-span-2">
          <p className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Growth Pulse</p>
          <h2 className="text-2xl font-bold">Autonomous Website Progress</h2>
          <p className="text-sm text-muted-foreground mt-2">
            Pilot berjalan terus, memproses evolusi, dan menaikkan metrik revenue/traffic otomatis.
          </p>
          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
            <TrendPanel
              title="Revenue Momentum"
              value={formatCurrency(latestRevenue)}
              subtitle="Latest daily revenue"
              values={revenueSeries}
              color="hsl(var(--success))"
            />
            <TrendPanel
              title="Traffic Momentum"
              value={`${Math.round(latestTraffic)} visitors`}
              subtitle="Latest daily traffic"
              values={trafficSeries}
              color="hsl(var(--primary))"
            />
          </div>
        </div>

        <div className="bg-card/70 border border-border rounded-xl p-5">
          <p className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Growth Score</p>
          <GrowthScore score={growthScore} />
          <div className="mt-4 space-y-2 text-sm">
            <p>
              Last evolution:{' '}
              <span className="text-primary font-medium">{formatRelativeTime(status.lastEvolutionAt)}</span>
            </p>
            <p>
              Next cycle:{' '}
              <span className="text-primary font-medium">{formatRelativeTime(status.nextAutoEvolutionAt)}</span>
            </p>
            <p>
              Auto interval:{' '}
              <span className="text-primary font-medium">{status.autoIntervalMinutes}m</span>
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Traffic" value={Math.round(latestTraffic)} unit="visitors/day" tone="primary" />
        <StatCard title="Revenue" value={formatCurrency(latestRevenue)} unit="USD/day" tone="success" />
        <StatCard title="Evolution Cycles" value={status.evolutionHistory.length} unit="cycles" tone="primary" />
        <StatCard
          title="30d Revenue"
          value={formatCurrency(status.monetization?.totalRevenue)}
          unit="USD / 30 days"
          tone="success"
        />
      </div>

      <div className="bg-card/70 border border-border rounded-xl p-6">
        <h3 className="text-lg font-semibold mb-4">Recent Autonomous Activity</h3>
        <div className="space-y-3">
          {status.recentLogs.slice(0, 8).map((log) => (
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
              <span className="text-muted-foreground text-xs">{formatRelativeTime(log.created_at)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function StatCard({
  title,
  value,
  unit,
  tone,
}: {
  title: string;
  value: string | number;
  unit: string;
  tone: 'primary' | 'success';
}) {
  return (
    <div
      className={`bg-card/70 border rounded-xl p-4 transition-all ${
        tone === 'success' ? 'border-success/30 hover:border-success/50' : 'border-primary/30 hover:border-primary/50'
      }`}
    >
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-sm text-muted-foreground">{title}</p>
      <p className="text-xs text-muted-foreground mt-1">{unit}</p>
    </div>
  );
}

function TrendPanel({
  title,
  value,
  subtitle,
  values,
  color,
}: {
  title: string;
  value: string;
  subtitle: string;
  values: number[];
  color: string;
}) {
  return (
    <div className="rounded-lg border border-border/80 bg-muted/30 p-3">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{title}</p>
      <p className="text-lg font-semibold mt-1">{value}</p>
      <p className="text-xs text-muted-foreground">{subtitle}</p>
      <div className="mt-3">
        <MiniLineChart values={values} color={color} />
      </div>
    </div>
  );
}

function MiniLineChart({ values, color }: { values: number[]; color: string }) {
  const width = 320;
  const height = 90;
  const pad = 8;
  const points = values.length > 0 ? values : [0];
  const max = Math.max(...points, 1);
  const min = Math.min(...points, 0);
  const range = max - min || 1;
  const stepX = points.length > 1 ? (width - pad * 2) / (points.length - 1) : 0;

  const coords = points.map((v, i) => {
    const x = pad + i * stepX;
    const y = height - pad - ((v - min) / range) * (height - pad * 2);
    return { x, y };
  });

  const path = coords.map((c, i) => `${i === 0 ? 'M' : 'L'} ${c.x} ${c.y}`).join(' ');
  const areaPath =
    coords.length > 1
      ? `${path} L ${coords[coords.length - 1].x} ${height - pad} L ${coords[0].x} ${height - pad} Z`
      : '';

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-20">
      <defs>
        <linearGradient id={`g-${color.replace(/[^a-z0-9]/gi, '')}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      {areaPath && (
        <path fill={`url(#g-${color.replace(/[^a-z0-9]/gi, '')})`} d={areaPath} />
      )}
      <path d={path} fill="none" stroke={color} strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

function GrowthScore({ score }: { score: number }) {
  const clamped = clamp(score, 0, 100);
  const ringStyle = {
    background: `conic-gradient(hsl(var(--success)) ${clamped * 3.6}deg, hsl(var(--muted)) 0deg)`,
  };

  return (
    <div className="flex items-center justify-center">
      <div className="relative w-36 h-36 rounded-full p-2" style={ringStyle}>
        <div className="w-full h-full rounded-full bg-card flex items-center justify-center">
          <div className="text-center">
            <p className="text-3xl font-black">{clamped}</p>
            <p className="text-xs text-muted-foreground uppercase tracking-wider">Growth</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function LogsTab({ logs }: { logs: Log[] }) {
  return (
    <div className="bg-card/70 rounded-xl border border-border overflow-hidden">
      <div className="p-4 border-b border-border">
        <h2 className="text-lg font-semibold">System Logs</h2>
      </div>
      <div className="divide-y divide-border">
        {logs.map((log) => (
          <div key={log.id} className="p-4 hover:bg-muted/40 transition-colors">
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
                  <pre className="text-xs text-muted-foreground bg-muted/40 p-2 rounded overflow-auto max-h-32">
                    {log.context}
                  </pre>
                )}
              </div>
              <span className="text-xs text-muted-foreground whitespace-nowrap">{formatRelativeTime(log.created_at)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function MetricsTab({ metrics }: { metrics: Metric[] }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {metrics.map((metric) => (
        <div key={metric.id} className="bg-card/70 rounded-xl border border-border p-4">
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
          <p className="text-xs text-muted-foreground mt-3">Recorded {formatRelativeTime(metric.created_at)}</p>
        </div>
      ))}
    </div>
  );
}

function MonetizationTab({ monetization }: { monetization?: MonetizationData }) {
  if (!monetization) {
    return null;
  }

  const trend = normalizeTrend(monetization.revenueTrend || []).slice(-7);
  const maxRevenue = Math.max(...trend.map((item) => safeNumber(item.revenue)), 1);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard title="Total Revenue (30d)" value={formatCurrency(monetization.totalRevenue)} unit="USD" tone="success" />
        <StatCard title="Affiliate Revenue (30d)" value={formatCurrency(monetization.affiliateRevenue)} unit="USD" tone="success" />
        <StatCard title="Micro-SaaS Revenue (30d)" value={formatCurrency(monetization.saasRevenue)} unit="USD" tone="primary" />
      </div>

      <div className="bg-card/70 border border-border rounded-xl p-6">
        <h2 className="text-lg font-semibold mb-4">Revenue Growth Graph (Last 7 Days)</h2>
        <div className="space-y-3">
          {trend.length === 0 && <p className="text-sm text-muted-foreground">No trend data yet.</p>}
          {trend.map((point) => {
            const widthPercent = (safeNumber(point.revenue) / maxRevenue) * 100;
            return (
              <div key={point.day}>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="text-muted-foreground">{point.day}</span>
                  <span className="text-foreground font-medium">{formatCurrency(point.revenue)}</span>
                </div>
                <div className="h-2 bg-muted/60 rounded-full overflow-hidden">
                  <div className="h-full rounded-full bg-gradient-to-r from-primary to-success" style={{ width: `${widthPercent}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="bg-card/70 border border-border rounded-xl p-6">
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

function AdminTab({ admin }: { admin?: SystemStatus['admin'] }) {
  if (!admin) {
    return (
      <div className="bg-card/70 rounded-xl border border-border p-6">
        <p className="text-sm text-muted-foreground">Admin data not available yet.</p>
      </div>
    );
  }

  const { pilotStatus, pilotReports } = admin;
  const isPilotRunning = Boolean(pilotStatus.runner?.running);
  const payoutStatus = admin.payoutStatus;
  const autopilotStatus = admin.autopilotStatus;
  const cryptoStatus = admin.cryptoStatus;
  const cryptoOpportunities = admin.cryptoOpportunities || [];

  return (
    <div className="space-y-6">
      <div className="bg-card/70 rounded-xl border border-border p-6">
        <h2 className="text-lg font-semibold mb-4">Pilot Bot Status</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
          <InfoBox label="Status" value={pilotStatus.status || 'unknown'} accent="primary" />
          <InfoBox label="Last Started" value={formatRelativeTime(pilotStatus.lastStartedAt)} />
          <InfoBox label="Last Finished" value={formatRelativeTime(pilotStatus.lastFinishedAt)} />
          <InfoBox label="Last Error" value={pilotStatus.lastError || 'none'} accent="destructive" />
        </div>
        <div className="mt-4 text-sm text-muted-foreground">
          Runner: {isPilotRunning ? 'running' : 'degraded'} {pilotStatus.runner?.runtime ? `(${pilotStatus.runner.runtime})` : ''}
          {' | '}
          Last heartbeat: {formatRelativeTime(pilotStatus.lastHeartbeatAt)}
        </div>
      </div>

      <div className="bg-card/70 rounded-xl border border-border p-6">
        <h2 className="text-lg font-semibold mb-4">Autopilot Mode</h2>
        {!autopilotStatus && <p className="text-sm text-muted-foreground">Autopilot status not available yet.</p>}
        {autopilotStatus && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
              <InfoBox label="Strategy" value={autopilotStatus.strategy} accent="primary" />
              <InfoBox label="Requires Traffic" value={autopilotStatus.requiresTraffic ? 'yes' : 'no'} />
              <InfoBox label="Pulse Interval" value={`${autopilotStatus.pulseIntervalSeconds}s`} />
              <InfoBox label="Last Pulse" value={formatRelativeTime(autopilotStatus.lastPulseAt)} />
            </div>
            <div className="text-sm text-muted-foreground">
              Pulse source: <span className="text-foreground">{autopilotStatus.lastPulseSource || 'n/a'}</span>
            </div>
          </div>
        )}
      </div>

      <div className="bg-card/70 rounded-xl border border-border p-6">
        <h2 className="text-lg font-semibold mb-4">USDT Payout Monitor</h2>
        {!payoutStatus && <p className="text-sm text-muted-foreground">Payout monitor not available yet.</p>}
        {payoutStatus && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
              <InfoBox label="Network" value={payoutStatus.network || 'n/a'} accent="primary" />
              <InfoBox label="Token" value={payoutStatus.tokenSymbol || 'n/a'} />
              <InfoBox label="Sync Status" value={payoutStatus.configured ? 'configured' : 'not configured'} />
              <InfoBox label="Last Synced" value={formatRelativeTime(payoutStatus.lastSyncedAt)} />
            </div>
            <div className="text-sm text-muted-foreground break-all">
              Wallet: <span className="text-foreground">{payoutStatus.walletAddress || 'n/a'}</span>
              {' | '}Contract: <span className="text-foreground">{payoutStatus.tokenContract || 'n/a'}</span>
              {' | '}Last block: <span className="text-foreground">{payoutStatus.lastScannedBlock ?? 'n/a'}</span>
            </div>
            {payoutStatus.lastError && (
              <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
                On-chain sync issue: {payoutStatus.lastError}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="bg-card/70 rounded-xl border border-border p-6">
        <h2 className="text-lg font-semibold mb-4">Crypto Revenue Engine</h2>
        {!cryptoStatus && <p className="text-sm text-muted-foreground">Crypto engine status not available yet.</p>}
        {cryptoStatus && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
              <InfoBox label="Engine Status" value={cryptoStatus.status || 'unknown'} accent="primary" />
              <InfoBox label="Interval" value={`${safeNumber(cryptoStatus.intervalMinutes)}m`} />
              <InfoBox label="Last Run" value={formatRelativeTime(cryptoStatus.lastRunAt)} />
              <InfoBox label="New / Last Cycle" value={`${safeNumber(cryptoStatus.lastNew)} / ${safeNumber(cryptoStatus.lastTotal)}`} />
            </div>
            {cryptoStatus.lastError && (
              <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
                Crypto engine issue: {cryptoStatus.lastError}
              </div>
            )}
            <div className="space-y-2">
              {cryptoOpportunities.length === 0 && (
                <p className="text-sm text-muted-foreground">No crypto opportunities indexed yet.</p>
              )}
              {cryptoOpportunities.slice(0, 6).map((opportunity) => (
                <div key={String(opportunity.key)} className="rounded-lg border border-border/70 p-3">
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <span className="px-2 py-0.5 rounded text-xs bg-primary/20 text-primary">
                      {String(opportunity.category || 'opportunity')}
                    </span>
                    <span className="px-2 py-0.5 rounded text-xs bg-success/20 text-success">
                      score: {safeNumber(opportunity.score)}
                    </span>
                    <span className="ml-auto text-xs text-muted-foreground">
                      {formatRelativeTime(opportunity.updatedAt || null)}
                    </span>
                  </div>
                  <p className="text-sm font-medium">{String(opportunity.title || 'Untitled')}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Est. reward: {formatCurrency(opportunity.rewardEstimateUsd)} | Source: {String(opportunity.source || 'n/a')}
                  </p>
                  {opportunity.url && (
                    <a
                      href={String(opportunity.url)}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-primary hover:underline mt-1 inline-block break-all"
                    >
                      {String(opportunity.url)}
                    </a>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="bg-card/70 rounded-xl border border-border p-6">
        <h2 className="text-lg font-semibold mb-4">Pilot Reports</h2>
        <div className="space-y-4">
          {pilotReports.length === 0 && (
            <p className="text-sm text-muted-foreground">No pilot reports yet. Pilot will publish automatically.</p>
          )}
          {pilotReports.map((item) => {
            const report = item.report;
            return (
              <div key={item.id} className="border border-border/70 rounded-lg p-4">
                <div className="flex flex-wrap items-center gap-2 mb-3">
                  <span className="px-2 py-0.5 rounded text-xs font-medium bg-primary/20 text-primary">
                    {report?.reportId || item.key}
                  </span>
                  <span className="px-2 py-0.5 rounded text-xs font-medium bg-success/20 text-success">
                    health: {report?.health?.status || 'unknown'}
                  </span>
                  <span className="px-2 py-0.5 rounded text-xs font-medium bg-muted text-muted-foreground">
                    cycle: {report?.cycle ?? 'n/a'}
                  </span>
                  <span className="text-xs text-muted-foreground ml-auto">
                    {formatRelativeTime(report?.generatedAt || item.updatedAt)}
                  </span>
                </div>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
                  <InfoBox label="Revenue 24h" value={formatCurrency(report?.kpi?.revenue24h)} />
                  <InfoBox label="Revenue 7d" value={formatCurrency(report?.kpi?.revenue7d)} />
                  <InfoBox label="Traffic" value={safeNumber(report?.kpi?.latestTraffic).toFixed(0)} />
                  <InfoBox label="CTR 7d" value={`${(safeNumber(report?.kpi?.avgCtr7d) * 100).toFixed(2)}%`} />
                </div>
                <p className="text-sm text-muted-foreground mt-3">
                  Evolution: {String(report?.actions?.evolutionTriggered)} / {String(report?.actions?.evolutionSuccess)}
                  {' | '}Strategy: {report?.actions?.adStrategy || 'n/a'}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function InfoBox({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: 'primary' | 'destructive';
}) {
  return (
    <div className="bg-muted/30 rounded p-3">
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className={`font-medium ${accent === 'primary' ? 'text-primary' : accent === 'destructive' ? 'text-destructive' : ''}`}>
        {value}
      </p>
    </div>
  );
}

function EvolutionTab({ history }: { history: SystemStatus['evolutionHistory'] }) {
  const parsed = useMemo(() => {
    return history.map((evolution) => {
      let decisionPreview = evolution.decision_data;
      try {
        const obj = JSON.parse(evolution.decision_data);
        decisionPreview = JSON.stringify(obj, null, 2);
      } catch {
        decisionPreview = evolution.decision_data;
      }
      return { ...evolution, decisionPreview };
    });
  }, [history]);

  return (
    <div className="space-y-4">
      {parsed.length === 0 && (
        <div className="bg-card/70 rounded-xl border border-border p-8 text-center">
          <p className="text-muted-foreground">No evolution cycles recorded yet.</p>
          <p className="text-sm text-muted-foreground mt-2">
            Always-on pilot automation will run evolution cycles automatically.
          </p>
        </div>
      )}

      {parsed.map((evolution) => (
        <div key={evolution.id} className="bg-card/70 rounded-xl border border-border p-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="px-2 py-0.5 rounded text-xs font-medium bg-primary/20 text-primary">
              {evolution.decision_type}
            </span>
            <span className="px-2 py-0.5 rounded text-xs font-medium bg-success/20 text-success">
              {evolution.implementation_status}
            </span>
            <span className="ml-auto text-xs text-muted-foreground">{formatRelativeTime(evolution.created_at)}</span>
          </div>
          <pre className="text-sm text-muted-foreground bg-muted/40 p-3 rounded overflow-auto max-h-48">
            {evolution.decisionPreview}
          </pre>
        </div>
      ))}
    </div>
  );
}
