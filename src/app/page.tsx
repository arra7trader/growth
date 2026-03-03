'use client';

import { useState, useEffect } from 'react';
import { formatDistanceToNow } from 'date-fns';

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

interface SystemStatus {
  lastActivity: string | null;
  recentLogs: Log[];
  latestMetrics: Metric[];
  evolutionHistory: any[];
  activeContent: any[];
  systemHealth: string;
}

export default function Home() {
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [isEvolving, setIsEvolving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'overview' | 'logs' | 'metrics' | 'evolution'>('overview');

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 5000); // Poll every 5 seconds
    return () => clearInterval(interval);
  }, []);

  async function fetchStatus() {
    try {
      const response = await fetch('/api/evolve', {
        method: 'GET',
      });
      const data = await response.json();
      if (data.success) {
        setStatus(data.data);
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
          <div className="w-16 h-16 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-muted-foreground">Initializing Autonomous System...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-3 h-3 bg-success rounded-full live-indicator"></div>
              <h1 className="text-2xl font-bold gradient-text">AETHER AUTO-SaaS</h1>
              <span className="text-xs text-muted-foreground px-2 py-1 bg-muted rounded-full">
                v1.0.0
              </span>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">System Status:</span>
                <span className={`font-medium ${
                  status?.systemHealth === 'operational' ? 'text-success' : 'text-warning'
                }`}>
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

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8">
        {/* Tabs */}
        <div className="flex gap-2 mb-6 border-b border-border">
          {(['overview', 'logs', 'metrics', 'evolution'] as const).map((tab) => (
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

        {/* Tab Content */}
        {activeTab === 'overview' && <OverviewTab status={status} />}
        {activeTab === 'logs' && <LogsTab logs={status?.recentLogs || []} />}
        {activeTab === 'metrics' && <MetricsTab metrics={status?.latestMetrics || []} />}
        {activeTab === 'evolution' && <EvolutionTab history={status?.evolutionHistory || []} />}
      </main>

      {/* Footer */}
      <footer className="border-t border-border mt-12 py-6">
        <div className="container mx-auto px-4 text-center text-sm text-muted-foreground">
          <p>Aether Auto-SaaS - Autonomous Profit-Generating Web Entity</p>
          <p className="mt-1">
            Self-coding via GitHub API • Powered by OpenAI • Deployed on Vercel
          </p>
        </div>
      </footer>
    </div>
  );
}

function OverviewTab({ status }: { status: SystemStatus | null }) {
  if (!status) return null;

  const latestMetric = status.latestMetrics[0];
  const traffic = status.latestMetrics.find((m) => m.metric_type === 'traffic');
  const revenue = status.latestMetrics.find((m) => m.metric_type === 'revenue');

  return (
    <div className="space-y-6">
      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Daily Traffic"
          value={traffic ? Math.round(traffic.value) : '0'}
          unit="visitors"
          icon="👥"
        />
        <StatCard
          title="Daily Revenue"
          value={revenue ? `$${revenue.value.toFixed(2)}` : '$0.00'}
          unit="USD"
          icon="💰"
        />
        <StatCard
          title="Active Features"
          value={status.activeContent.length}
          unit="features"
          icon="⚡"
        />
        <StatCard
          title="Evolution Cycles"
          value={status.evolutionHistory.length}
          unit="cycles"
          icon="🔄"
        />
      </div>

      {/* Recent Activity */}
      <div className="bg-card rounded-lg border border-border p-6">
        <h2 className="text-lg font-semibold mb-4">Recent Activity</h2>
        <div className="space-y-3">
          {status.recentLogs.slice(0, 5).map((log) => (
            <div key={log.id} className="flex items-start gap-3 text-sm">
              <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                log.level === 'success' ? 'bg-success/20 text-success' :
                log.level === 'error' ? 'bg-destructive/20 text-destructive' :
                log.level === 'decision' ? 'bg-primary/20 text-primary' :
                'bg-muted text-muted-foreground'
              }`}>
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

      {/* AI Thinking Status */}
      <div className="bg-gradient-to-br from-primary/10 to-success/10 rounded-lg border border-primary/20 p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-2 h-2 bg-success rounded-full live-indicator"></div>
          <h2 className="text-lg font-semibold">Autonomous Brain Status</h2>
        </div>
        <p className="text-muted-foreground">
          The AI is continuously monitoring market trends, analyzing performance metrics, 
          and making autonomous decisions to evolve the platform for maximum profit generation.
        </p>
        <div className="mt-4 flex gap-4 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Next Evolution:</span>
            <span className="text-primary font-medium">24 hours</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Last Activity:</span>
            <span className="text-primary font-medium">
              {status.lastActivity ? formatDistanceToNow(new Date(status.lastActivity), { addSuffix: true }) : 'N/A'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ title, value, unit, icon }: { title: string; value: string | number; unit: string; icon: string }) {
  return (
    <div className="bg-card rounded-lg border border-border p-4 hover:border-primary/50 transition-colors">
      <div className="flex items-center justify-between mb-2">
        <span className="text-2xl">{icon}</span>
      </div>
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
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                    log.level === 'success' ? 'bg-success/20 text-success' :
                    log.level === 'error' ? 'bg-destructive/20 text-destructive' :
                    log.level === 'decision' ? 'bg-primary/20 text-primary' :
                    'bg-muted text-muted-foreground'
                  }`}>
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
              <p className="text-2xl font-bold">{metric.value.toFixed(2)}</p>
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

function EvolutionTab({ history }: { history: any[] }) {
  return (
    <div className="space-y-4">
      {history.length === 0 ? (
        <div className="bg-card rounded-lg border border-border p-8 text-center">
          <p className="text-muted-foreground">No evolution cycles recorded yet.</p>
          <p className="text-sm text-muted-foreground mt-2">
            Click "Trigger Evolution" to start the first autonomous evolution cycle.
          </p>
        </div>
      ) : (
        history.map((evolution) => (
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
                  {JSON.stringify(JSON.parse(evolution.decision_data), null, 2)}
                </pre>
                {evolution.github_commit_hash && (
                  <a
                    href={`https://github.com/arra7trader/growth/commit/${evolution.github_commit_hash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-primary hover:underline mt-2 inline-block"
                  >
                    View Commit →
                  </a>
                )}
              </div>
              <span className="text-xs text-muted-foreground whitespace-nowrap">
                {formatDistanceToNow(new Date(evolution.created_at), { addSuffix: true })}
              </span>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
