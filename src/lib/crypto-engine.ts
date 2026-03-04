import { createHash } from 'node:crypto';
import tursoClient from './db';

const DEFAULT_ENGINE_INTERVAL_MINUTES = 30;
const DEFAULT_MAX_ITEMS_PER_QUERY = 20;
const DEFAULT_STORE_LIMIT = 40;

interface GithubIssue {
  html_url: string;
  title: string;
  body: string | null;
  updated_at: string;
  created_at: string;
  labels?: Array<{ name?: string }>;
  repository_url?: string;
  user?: { login?: string };
}

interface GithubSearchResponse {
  items?: GithubIssue[];
}

export interface CryptoOpportunity {
  key: string;
  source: string;
  category: 'bounty' | 'grant' | 'job' | 'quest';
  title: string;
  url: string;
  summary: string;
  tags: string[];
  rewardEstimateUsd: number;
  score: number;
  updatedAt: string;
  metadata: Record<string, unknown>;
}

export interface CryptoActionTask {
  key: string;
  opportunityKey: string;
  title: string;
  status: 'queued' | 'in_progress' | 'completed' | 'skipped';
  priority: 'low' | 'medium' | 'high';
  category: CryptoOpportunity['category'];
  score: number;
  rewardEstimateUsd: number;
  targetUrl: string;
  dueAt: string;
  runbook: {
    objective: string;
    steps: string[];
    submissionDraft: string;
  };
  updatedAt: string;
}

function safeNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function compactText(value: string, max = 220): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, max);
}

function keyFromUrl(url: string): string {
  const digest = createHash('sha1').update(url).digest('hex');
  return `crypto_${digest.slice(0, 20)}`;
}

function getJsonHeaders() {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'aether-auto-saas-crypto-engine',
  };

  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  return headers;
}

function parseRewardEstimateUsd(text: string): number {
  const normalized = text.toUpperCase();
  const dollarMatch = normalized.match(/\$([0-9][0-9,]*(?:\.[0-9]+)?)/);
  if (dollarMatch?.[1]) {
    return safeNumber(dollarMatch[1].replace(/,/g, ''), 0);
  }

  const stableMatch = normalized.match(/([0-9][0-9,]*(?:\.[0-9]+)?)\s*(USDT|USDC|DAI|USD)\b/);
  if (stableMatch?.[1]) {
    return safeNumber(stableMatch[1].replace(/,/g, ''), 0);
  }

  const genericKMatch = normalized.match(/([0-9]+)\s*K\b/);
  if (genericKMatch?.[1]) {
    return safeNumber(genericKMatch[1], 0) * 1000;
  }

  return 0;
}

function opportunityCategoryFromText(text: string): CryptoOpportunity['category'] {
  const t = text.toLowerCase();
  if (t.includes('grant')) {
    return 'grant';
  }
  if (t.includes('job') || t.includes('hiring')) {
    return 'job';
  }
  if (t.includes('quest') || t.includes('campaign')) {
    return 'quest';
  }
  return 'bounty';
}

function estimateOpportunityScore(input: {
  rewardEstimateUsd: number;
  updatedAt: string;
  category: CryptoOpportunity['category'];
  text: string;
}): number {
  const now = Date.now();
  const updated = new Date(input.updatedAt).getTime();
  const ageDays = Number.isFinite(updated) ? (now - updated) / (1000 * 60 * 60 * 24) : 14;
  const recencyScore = Math.max(0, 30 - ageDays * 2);
  const rewardScore = Math.min(40, input.rewardEstimateUsd > 0 ? 10 + Math.log10(input.rewardEstimateUsd + 1) * 10 : 8);

  let categoryScore = 10;
  if (input.category === 'grant') {
    categoryScore = 18;
  } else if (input.category === 'bounty') {
    categoryScore = 16;
  } else if (input.category === 'job') {
    categoryScore = 12;
  }

  let noCapitalBonus = 0;
  if (/\b(no\s*cost|no\s*capital|free|open source|documentation|content|community)\b/i.test(input.text)) {
    noCapitalBonus = 12;
  }

  return Math.max(1, Math.min(100, Math.round(recencyScore + rewardScore + categoryScore + noCapitalBonus)));
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

async function logCrypto(level: string, message: string, context: Record<string, unknown>) {
  await tursoClient.execute({
    sql: `
      INSERT INTO logs (level, message, context)
      VALUES (?, ?, ?)
    `,
    args: [level, message, JSON.stringify(context)],
  });
}

async function fetchGithubIssues(query: string): Promise<GithubIssue[]> {
  const url = `https://api.github.com/search/issues?q=${encodeURIComponent(query)}&sort=updated&order=desc&per_page=${DEFAULT_MAX_ITEMS_PER_QUERY}`;
  const response = await fetch(url, {
    headers: getJsonHeaders(),
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`GitHub search HTTP ${response.status} for query: ${query}`);
  }

  const data = (await response.json()) as GithubSearchResponse;
  return Array.isArray(data.items) ? data.items : [];
}

function issueToOpportunity(issue: GithubIssue): CryptoOpportunity | null {
  const url = String(issue.html_url || '').trim();
  const title = compactText(String(issue.title || '').trim(), 180);
  if (!url || !title) {
    return null;
  }

  const body = String(issue.body || '');
  const combined = `${title}\n${body}`;
  const category = opportunityCategoryFromText(combined);
  const rewardEstimateUsd = parseRewardEstimateUsd(combined);
  const labelNames = (issue.labels || []).map((label) => String(label.name || '').trim()).filter(Boolean);
  const summary = compactText(body || title, 240);
  const score = estimateOpportunityScore({
    rewardEstimateUsd,
    updatedAt: issue.updated_at || issue.created_at || new Date().toISOString(),
    category,
    text: combined,
  });

  return {
    key: keyFromUrl(url),
    source: 'github',
    category,
    title,
    url,
    summary,
    tags: labelNames.slice(0, 8),
    rewardEstimateUsd,
    score,
    updatedAt: issue.updated_at || issue.created_at || new Date().toISOString(),
    metadata: {
      author: issue.user?.login || null,
      repositoryUrl: issue.repository_url || null,
    },
  };
}

function actionPriority(score: number): CryptoActionTask['priority'] {
  if (score >= 75) {
    return 'high';
  }
  if (score >= 45) {
    return 'medium';
  }
  return 'low';
}

function dueAtFromScore(score: number): string {
  const hours = score >= 75 ? 6 : score >= 45 ? 18 : 36;
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

function buildRunbook(opportunity: CryptoOpportunity) {
  const objective = `Submit a high-quality ${opportunity.category} response for: ${opportunity.title}`;
  const steps = [
    'Read full opportunity brief and acceptance criteria.',
    'Extract hard requirements and submission deadline.',
    'Produce concise technical proposal aligned to requirements.',
    'Prepare proof artifacts (links, screenshots, code references).',
    'Submit through official channel and log submission reference.',
  ];

  const submissionDraft = [
    `Title: ${opportunity.title}`,
    '',
    'Summary:',
    `${opportunity.summary}`,
    '',
    'Execution Plan:',
    '- Scope: Deliver requirements exactly as requested.',
    '- Approach: Prioritize high-impact items with clear proof.',
    '- Deliverables: Structured report + references + evidence.',
    '',
    'Why this submission should win:',
    '- Directly aligned to success criteria.',
    '- Fast execution timeline with verification-ready output.',
    '- Risk controls and clear communication.',
    '',
    `Target URL: ${opportunity.url}`,
  ].join('\n');

  return {
    objective,
    steps,
    submissionDraft,
  };
}

function opportunityToActionTask(opportunity: CryptoOpportunity): CryptoActionTask {
  const key = `action_${opportunity.key}`;
  const runbook = buildRunbook(opportunity);
  const updatedAt = new Date().toISOString();

  return {
    key,
    opportunityKey: opportunity.key,
    title: `Execute ${opportunity.category}: ${opportunity.title}`.slice(0, 180),
    status: 'queued',
    priority: actionPriority(opportunity.score),
    category: opportunity.category,
    score: opportunity.score,
    rewardEstimateUsd: opportunity.rewardEstimateUsd,
    targetUrl: opportunity.url,
    dueAt: dueAtFromScore(opportunity.score),
    runbook,
    updatedAt,
  };
}

async function upsertOpportunity(item: CryptoOpportunity): Promise<boolean> {
  const existing = await tursoClient.execute({
    sql: `
      SELECT id
      FROM dynamic_content
      WHERE content_type = 'crypto_opportunity'
        AND content_key = ?
      LIMIT 1
    `,
    args: [item.key],
  });

  await tursoClient.execute({
    sql: `
      INSERT INTO dynamic_content (content_type, content_key, content_data, metadata)
      VALUES ('crypto_opportunity', ?, ?, ?)
      ON CONFLICT(content_key) DO UPDATE SET
        content_data = excluded.content_data,
        metadata = excluded.metadata,
        updated_at = CURRENT_TIMESTAMP
    `,
    args: [
      item.key,
      JSON.stringify(item),
      JSON.stringify({
        source: item.source,
        category: item.category,
        score: item.score,
        rewardEstimateUsd: item.rewardEstimateUsd,
      }),
    ],
  });

  return existing.rows.length === 0;
}

async function upsertActionTask(item: CryptoActionTask): Promise<boolean> {
  const existing = await tursoClient.execute({
    sql: `
      SELECT id
      FROM dynamic_content
      WHERE content_type = 'crypto_action_task'
        AND content_key = ?
      LIMIT 1
    `,
    args: [item.key],
  });

  await tursoClient.execute({
    sql: `
      INSERT INTO dynamic_content (content_type, content_key, content_data, metadata)
      VALUES ('crypto_action_task', ?, ?, ?)
      ON CONFLICT(content_key) DO UPDATE SET
        content_data = excluded.content_data,
        metadata = excluded.metadata,
        updated_at = CURRENT_TIMESTAMP
    `,
    args: [
      item.key,
      JSON.stringify(item),
      JSON.stringify({
        status: item.status,
        priority: item.priority,
        score: item.score,
        rewardEstimateUsd: item.rewardEstimateUsd,
        opportunityKey: item.opportunityKey,
      }),
    ],
  });

  return existing.rows.length === 0;
}

async function collectCryptoOpportunities(): Promise<CryptoOpportunity[]> {
  const queries = [
    'web3 bounty in:title,body state:open',
    'crypto grant in:title,body state:open',
    'solidity bug bounty in:title,body state:open',
    'blockchain quest reward in:title,body state:open',
    'remote web3 job in:title,body state:open',
  ];

  const issuesByQuery = await Promise.all(
    queries.map(async (query) => {
      try {
        return await fetchGithubIssues(query);
      } catch {
        return [];
      }
    })
  );

  const flattened = issuesByQuery.flat();
  const seen = new Set<string>();
  const opportunities: CryptoOpportunity[] = [];

  for (const issue of flattened) {
    const candidate = issueToOpportunity(issue);
    if (!candidate) {
      continue;
    }

    if (seen.has(candidate.url)) {
      continue;
    }

    seen.add(candidate.url);
    opportunities.push(candidate);
  }

  opportunities.sort((a, b) => b.score - a.score || b.rewardEstimateUsd - a.rewardEstimateUsd);
  return opportunities.slice(0, DEFAULT_STORE_LIMIT);
}

export async function getCryptoEngineStatus() {
  const [lastRunAt, lastError, lastTotal, lastNew, lastActions, intervalValue, status] = await Promise.all([
    getSetting('crypto_engine_last_run_at'),
    getSetting('crypto_engine_last_error'),
    getSetting('crypto_engine_last_total'),
    getSetting('crypto_engine_last_new'),
    getSetting('crypto_engine_last_actions'),
    getSetting('crypto_engine_interval_minutes'),
    getSetting('crypto_engine_status'),
  ]);

  return {
    status: status || 'idle',
    intervalMinutes: Number(intervalValue || DEFAULT_ENGINE_INTERVAL_MINUTES) || DEFAULT_ENGINE_INTERVAL_MINUTES,
    lastRunAt: lastRunAt || null,
    lastError: lastError || null,
    lastTotal: Number(lastTotal || 0) || 0,
    lastNew: Number(lastNew || 0) || 0,
    lastActions: Number(lastActions || 0) || 0,
  };
}

export async function getCryptoOpportunities(limit = 12) {
  const result = await tursoClient.execute({
    sql: `
      SELECT content_key, content_data, updated_at
      FROM dynamic_content
      WHERE content_type = 'crypto_opportunity'
      ORDER BY updated_at DESC
      LIMIT ?
    `,
    args: [Math.max(1, Math.min(50, limit))],
  });

  return result.rows.map((row) => {
    let data: Record<string, unknown> = {};
    try {
      data = JSON.parse(String(row.content_data || '{}'));
    } catch {
      data = {};
    }

    return {
      key: row.content_key,
      updatedAt: row.updated_at,
      ...data,
    };
  });
}

export async function getCryptoActionTasks(limit = 12) {
  const result = await tursoClient.execute({
    sql: `
      SELECT content_key, content_data, updated_at
      FROM dynamic_content
      WHERE content_type = 'crypto_action_task'
      ORDER BY updated_at DESC
      LIMIT ?
    `,
    args: [Math.max(1, Math.min(50, limit))],
  });

  return result.rows.map((row) => {
    let data: Record<string, unknown> = {};
    try {
      data = JSON.parse(String(row.content_data || '{}'));
    } catch {
      data = {};
    }

    return {
      key: row.content_key,
      updatedAt: row.updated_at,
      ...data,
    };
  });
}

export async function runCryptoRevenueCycle(): Promise<{
  success: boolean;
  total: number;
  newItems: number;
  actionItems: number;
  topScore: number;
  error?: string;
}> {
  try {
    await setSetting('crypto_engine_status', 'running');
    const opportunities = await collectCryptoOpportunities();

    let newItems = 0;
    let newActions = 0;
    for (const item of opportunities) {
      const inserted = await upsertOpportunity(item);
      if (inserted) {
        newItems += 1;
      }
    }

    const topForExecution = opportunities.slice(0, 12);
    for (const opportunity of topForExecution) {
      const task = opportunityToActionTask(opportunity);
      const inserted = await upsertActionTask(task);
      if (inserted) {
        newActions += 1;
      }
    }

    const topScore = opportunities[0]?.score || 0;
    await Promise.all([
      setSetting('crypto_engine_status', 'running'),
      setSetting('crypto_engine_last_run_at', new Date().toISOString()),
      setSetting('crypto_engine_last_total', String(opportunities.length)),
      setSetting('crypto_engine_last_new', String(newItems)),
      setSetting('crypto_engine_last_actions', String(newActions)),
      setSetting('crypto_engine_interval_minutes', String(DEFAULT_ENGINE_INTERVAL_MINUTES)),
      setSetting('crypto_engine_last_error', ''),
    ]);

    await logCrypto('crypto', 'Crypto revenue engine cycle completed', {
      total: opportunities.length,
      newItems,
      newActions,
      topScore,
      mode: 'no_capital',
    });

    return {
      success: true,
      total: opportunities.length,
      newItems,
      actionItems: newActions,
      topScore,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    await Promise.all([
      setSetting('crypto_engine_status', 'attention'),
      setSetting('crypto_engine_last_error', message),
    ]);

    await logCrypto('error', 'Crypto revenue engine failed', {
      error: message,
    });

    return {
      success: false,
      total: 0,
      newItems: 0,
      actionItems: 0,
      topScore: 0,
      error: message,
    };
  }
}
