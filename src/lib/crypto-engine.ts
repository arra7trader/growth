import { createHash } from 'node:crypto';
import tursoClient from './db';

const DEFAULT_ENGINE_INTERVAL_MINUTES = 30;
const DEFAULT_MAX_ITEMS_PER_QUERY = 20;
const DEFAULT_STORE_LIMIT = 40;
const DEFAULT_EXECUTOR_LIMIT_PER_CYCLE = 8;
const DEFAULT_EXECUTOR_MAX_ATTEMPTS = 3;
const DEFAULT_STALE_IN_PROGRESS_MINUTES = 45;
const DEFAULT_QUEUE_OVERDUE_MINUTES = 30;
const DEFAULT_TASK_RETENTION_DAYS = 14;
const DEFAULT_ACTIVE_TASK_LIMIT = 120;
const DEFAULT_CYCLE_HISTORY_LIMIT = 36;
const DEFAULT_SUBMISSION_MONITOR_INTERVAL_MINUTES = 20;
const DEFAULT_SUBMISSION_MONITOR_LIMIT = 24;

const DEFAULT_GITHUB_QUERIES = [
  'web3 bounty is:issue in:title,body state:open',
  'crypto grant is:issue in:title,body state:open',
  'solidity bug bounty is:issue in:title,body state:open',
  'blockchain quest reward is:issue in:title,body state:open',
  'remote web3 job is:issue in:title,body state:open',
  'defi bug bounty is:issue in:title,body state:open',
  'evm security bounty is:issue in:title,body state:open',
  'dao grant is:issue in:title,body state:open',
  'zk grant is:issue in:title,body state:open',
  'smart contract audit bounty is:issue in:title,body state:open',
  'ecosystem grant is:issue in:title,body state:open',
  'community quest web3 is:issue in:title,body state:open',
];

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

interface FeedOpportunityRaw {
  title: string;
  link: string;
  summary: string;
  publishedAt: string;
  source: string;
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
  monetization: {
    payableLikely: boolean;
    clearSubmissionPath: boolean;
    noCapitalFriendly: boolean;
    automationReady: boolean;
    laneEligible: boolean;
    confidence: number;
    payoutSignals: string[];
    submissionSignals: string[];
    blockers: string[];
  };
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
  execution?: {
    attempts: number;
    lastAttemptAt: string | null;
    nextAttemptAt: string | null;
    lastResult: 'submitted' | 'prepared' | 'failed' | 'skipped' | null;
    lastError: string | null;
  };
  submission?: {
    channel: 'github_issue_comment' | 'webhook' | 'outbox';
    state: 'submitted' | 'prepared' | 'failed' | 'skipped';
    externalUrl: string | null;
    submissionKey: string;
    submittedAt: string;
  };
  updatedAt: string;
}

interface SubmissionOutcome {
  state: 'submitted' | 'prepared' | 'failed' | 'skipped';
  channel: 'github_issue_comment' | 'webhook' | 'outbox';
  externalUrl: string | null;
  submissionKey: string;
  message: string;
  error?: string;
}

interface SubmissionLifecycleRecord {
  stage: 'prepared' | 'submitted' | 'reviewing' | 'accepted_signal' | 'paid_signal' | 'failed' | 'skipped';
  acceptedSignal: boolean;
  paidSignal: boolean;
  source: 'initial' | 'github_monitor';
  confidence: number;
  notes: string[];
  lastCheckedAt: string | null;
}

interface CryptoSubmissionRecord {
  submissionKey: string;
  taskKey: string;
  opportunityKey: string;
  channel: 'github_issue_comment' | 'webhook' | 'outbox';
  state: 'submitted' | 'prepared' | 'failed' | 'skipped';
  externalUrl: string | null;
  targetUrl?: string | null;
  message: string;
  error: string | null;
  createdAt: string;
  lifecycle?: SubmissionLifecycleRecord;
  monitor?: {
    issueState?: string | null;
    issueUpdatedAt?: string | null;
    issueUrl?: string | null;
    checkedAt?: string | null;
    error?: string | null;
  };
}

interface CryptoMaintenanceSummary {
  recoveredInProgress: number;
  reprioritizedQueued: number;
  prunedTasks: number;
  autoSkippedOverflow: number;
  queue: {
    queued: number;
    inProgress: number;
    completed: number;
    skipped: number;
  };
  health: 'healthy' | 'attention';
  issues: string[];
}

interface CryptoCycleSnapshot {
  at: string;
  total: number;
  newItems: number;
  actionItems: number;
  executedActions: number;
  submittedActions: number;
  preparedActions: number;
  failedActions: number;
  topScore: number;
  sources: {
    github: number;
    feed: number;
    total: number;
    laneEligible: number;
    automationReady: number;
    strictRealLane: boolean;
    queryFailures: number;
    feedFailures: number;
    usedStoredFallback: boolean;
  };
  maintenance: {
    recoveredInProgress: number;
    reprioritizedQueued: number;
    prunedTasks: number;
    autoSkippedOverflow: number;
    health: 'healthy' | 'attention';
  };
  submissionMonitor: {
    checked: number;
    acceptedSignals: number;
    paidSignals: number;
  };
}

interface SourceStatsSummary {
  github: number;
  feed: number;
  total: number;
  queries: number;
  feeds: number;
  laneEligible: number;
  automationReady: number;
  strictRealLane: boolean;
  queryFailures: number;
  feedFailures: number;
  usedStoredFallback: boolean;
}

function safeNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function safeInteger(value: unknown, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return fallback;
  }
  return Math.round(n);
}

function safeIsoOrNull(value: unknown): string | null {
  if (!value) {
    return null;
  }
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) {
    return null;
  }
  return d.toISOString();
}

function compactText(value: string, max = 220): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, max);
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function extractTagValue(block: string, tag: string): string {
  const direct = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  if (direct?.[1]) {
    return decodeXmlEntities(direct[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim());
  }

  const atom = block.match(new RegExp(`<${tag}[^>]*\\s+href="([^"]+)"[^>]*/>`, 'i'));
  if (atom?.[1]) {
    return decodeXmlEntities(atom[1].trim());
  }

  return '';
}

function getFeedUrls(): string[] {
  const raw = String(process.env.CRYPTO_RSS_FEED_URLS || '').trim();
  if (!raw) {
    return [];
  }

  return raw
    .split(',')
    .map((item) => item.trim())
    .filter((item) => /^https?:\/\//i.test(item));
}

function normalizeGithubIssueQuery(query: string): string {
  let normalized = String(query || '').trim().replace(/\s+/g, ' ');
  if (!normalized) {
    return '';
  }

  if (!/\bis:(issue|pull-request)\b/i.test(normalized)) {
    normalized = `${normalized} is:issue`;
  }

  if (!/\bstate:(open|closed)\b/i.test(normalized)) {
    normalized = `${normalized} state:open`;
  }

  return normalized.trim();
}

function getGithubQueries(): string[] {
  const raw = String(process.env.CRYPTO_GITHUB_QUERIES || '').trim();
  if (!raw) {
    return DEFAULT_GITHUB_QUERIES;
  }

  const list = raw
    .split('||')
    .map((item) => normalizeGithubIssueQuery(item))
    .filter(Boolean);

  return list.length > 0 ? list : DEFAULT_GITHUB_QUERIES;
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

function parseDeadlineFromText(text: string): string | null {
  const normalized = text.replace(/\s+/g, ' ');
  const patterns = [
    /\b(?:deadline|due|ends?)\s*[:\-]?\s*(\d{4}-\d{2}-\d{2})\b/i,
    /\b(?:deadline|due|ends?)\s*[:\-]?\s*(\d{1,2}\/\d{1,2}\/\d{4})\b/i,
    /\b(?:deadline|due|ends?)\s*[:\-]?\s*([A-Za-z]{3,9}\s+\d{1,2},\s+\d{4})\b/i,
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (!match?.[1]) {
      continue;
    }

    const candidate = new Date(match[1]);
    if (!Number.isNaN(candidate.getTime())) {
      return candidate.toISOString();
    }
  }

  return null;
}

function uniqueWords(values: string[]): string[] {
  return Array.from(
    new Set(
      values
        .map((value) => String(value || '').trim().toLowerCase())
        .filter(Boolean)
    )
  );
}

function isGithubIssueLikeUrl(url: string): boolean {
  return /^https?:\/\/github\.com\/[^/]+\/[^/]+\/(?:issues|pull)\/\d+/i.test(url);
}

function evaluateMonetizationReadiness(input: {
  text: string;
  url: string;
  tags: string[];
  source: string;
  rewardEstimateUsd: number;
}): CryptoOpportunity['monetization'] {
  const lowerText = `${input.text}\n${input.tags.join(' ')}`.toLowerCase();
  const payoutSignals = uniqueWords([
    ...(lowerText.match(/\b(bounty|reward|grant|prize|payout|paid|compensation)\b/g) || []),
    ...(lowerText.match(/\b(usd|usdt|usdc|dai|token)\b/g) || []),
  ]);
  const submissionSignals = uniqueWords([
    ...(lowerText.match(/\b(submit|submission|apply|application|comment|issue|pr|pull request|form|deadline)\b/g) || []),
  ]);
  const blockers = uniqueWords([
    ...(lowerText.match(/\b(unpaid|volunteer|no compensation|internship unpaid|donation only)\b/g) || []),
  ]);

  const payableByReward = input.rewardEstimateUsd > 0;
  const payableByText = payoutSignals.length >= 2 || /\bpaid\b/.test(lowerText);
  const payableLikely = payableByReward || payableByText;

  const clearSubmissionPath =
    submissionSignals.length >= 2 ||
    isGithubIssueLikeUrl(input.url) ||
    /\bfill (the )?form\b/.test(lowerText);

  const noCapitalFriendly = /\b(no\s*cost|no\s*capital|free|open source|community|contribution)\b/.test(lowerText);
  const automationReady = isGithubIssueLikeUrl(input.url) || Boolean(String(process.env.AETHER_SUBMISSION_WEBHOOK_URL || '').trim());
  const laneEligible = payableLikely && clearSubmissionPath && blockers.length === 0;

  let confidence = 35;
  confidence += payableByReward ? 25 : 0;
  confidence += payoutSignals.length >= 2 ? 15 : 0;
  confidence += clearSubmissionPath ? 15 : 0;
  confidence += automationReady ? 8 : 0;
  confidence += noCapitalFriendly ? 6 : 0;
  confidence -= blockers.length > 0 ? 40 : 0;

  if (String(input.source || '').startsWith('feed:')) {
    confidence -= 8;
  }

  return {
    payableLikely,
    clearSubmissionPath,
    noCapitalFriendly,
    automationReady,
    laneEligible,
    confidence: Math.max(1, Math.min(100, Math.round(confidence))),
    payoutSignals,
    submissionSignals,
    blockers,
  };
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
  monetization: CryptoOpportunity['monetization'];
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

  const monetizationBonus =
    (input.monetization.payableLikely ? 18 : -6) +
    (input.monetization.clearSubmissionPath ? 14 : -8) +
    (input.monetization.automationReady ? 8 : 0) +
    (input.monetization.laneEligible ? 8 : -4) +
    Math.round(input.monetization.confidence / 12) -
    input.monetization.blockers.length * 8;

  return Math.max(1, Math.min(100, Math.round(recencyScore + rewardScore + categoryScore + noCapitalBonus + monetizationBonus)));
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

async function fetchFeedItems(feedUrl: string): Promise<FeedOpportunityRaw[]> {
  const response = await fetch(feedUrl, {
    headers: {
      'User-Agent': 'aether-auto-saas-crypto-engine',
    },
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`Feed HTTP ${response.status} for ${feedUrl}`);
  }

  const xml = await response.text();
  const blocks = [
    ...Array.from(xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)).map((match) => match[0]),
    ...Array.from(xml.matchAll(/<entry\b[\s\S]*?<\/entry>/gi)).map((match) => match[0]),
  ];

  const origin = (() => {
    try {
      return new URL(feedUrl).hostname;
    } catch {
      return 'feed';
    }
  })();

  return blocks
    .map((block) => {
      const title = extractTagValue(block, 'title');
      const link = extractTagValue(block, 'link');
      const summary =
        extractTagValue(block, 'description') ||
        extractTagValue(block, 'summary') ||
        extractTagValue(block, 'content');
      const publishedAt =
        extractTagValue(block, 'pubDate') ||
        extractTagValue(block, 'updated') ||
        extractTagValue(block, 'published') ||
        new Date().toISOString();

      return {
        title,
        link,
        summary,
        publishedAt,
        source: origin,
      };
    })
    .filter((item) => item.title && item.link);
}

function feedItemToOpportunity(item: FeedOpportunityRaw): CryptoOpportunity | null {
  if (!item.link || !item.title) {
    return null;
  }

  const combined = `${item.title}\n${item.summary}`;
  const rewardEstimateUsd = parseRewardEstimateUsd(combined);
  const category = opportunityCategoryFromText(combined);
  const monetization = evaluateMonetizationReadiness({
    text: combined,
    url: item.link,
    tags: [],
    source: `feed:${item.source}`,
    rewardEstimateUsd,
  });
  const score = estimateOpportunityScore({
    rewardEstimateUsd,
    updatedAt: item.publishedAt || new Date().toISOString(),
    category,
    text: combined,
    monetization,
  });

  return {
    key: keyFromUrl(item.link),
    source: `feed:${item.source}`,
    category,
    title: compactText(item.title, 180),
    url: item.link,
    summary: compactText(item.summary || item.title, 240),
    tags: [],
    rewardEstimateUsd,
    score,
    monetization,
    updatedAt: item.publishedAt || new Date().toISOString(),
    metadata: {
      author: null,
      repositoryUrl: null,
      deadlineAt: parseDeadlineFromText(combined),
    },
  };
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
  const deadlineAt = parseDeadlineFromText(combined);
  const labelNames = (issue.labels || []).map((label) => String(label.name || '').trim()).filter(Boolean);
  const monetization = evaluateMonetizationReadiness({
    text: combined,
    url,
    tags: labelNames,
    source: 'github',
    rewardEstimateUsd,
  });
  const summary = compactText(body || title, 240);
  const score = estimateOpportunityScore({
    rewardEstimateUsd,
    updatedAt: issue.updated_at || issue.created_at || new Date().toISOString(),
    category,
    text: combined,
    monetization,
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
    monetization,
    updatedAt: issue.updated_at || issue.created_at || new Date().toISOString(),
    metadata: {
      author: issue.user?.login || null,
      repositoryUrl: issue.repository_url || null,
      deadlineAt,
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

function dueAtFromOpportunity(opportunity: CryptoOpportunity): string {
  const scoreDueAt = dueAtFromScore(opportunity.score);
  const metadata = opportunity.metadata as { deadlineAt?: unknown } | undefined;
  const deadlineValue = metadata?.deadlineAt ? String(metadata.deadlineAt) : '';
  if (!deadlineValue) {
    return scoreDueAt;
  }

  const deadline = new Date(deadlineValue);
  if (Number.isNaN(deadline.getTime())) {
    return scoreDueAt;
  }

  const bufferDeadline = new Date(deadline.getTime() - 2 * 60 * 60 * 1000);
  const scoreDue = new Date(scoreDueAt);
  return bufferDeadline.getTime() < scoreDue.getTime() ? bufferDeadline.toISOString() : scoreDueAt;
}

function buildRunbook(opportunity: CryptoOpportunity) {
  const objective = `Submit a high-quality ${opportunity.category} response for: ${opportunity.title}`;
  const monetizationLine = `Monetization readiness: payable=${opportunity.monetization.payableLikely}, submission_path=${opportunity.monetization.clearSubmissionPath}, automation=${opportunity.monetization.automationReady}, confidence=${opportunity.monetization.confidence}`;
  const steps = [
    'Read full opportunity brief and acceptance criteria.',
    'Extract hard requirements and submission deadline.',
    `Confirm payout signal and submit-path signal. ${monetizationLine}`,
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
    `- Readiness confidence: ${opportunity.monetization.confidence}/100.`,
    '',
    `Payout signals: ${opportunity.monetization.payoutSignals.join(', ') || 'none detected'}`,
    `Submission signals: ${opportunity.monetization.submissionSignals.join(', ') || 'none detected'}`,
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
    dueAt: dueAtFromOpportunity(opportunity),
    runbook,
    execution: {
      attempts: 0,
      lastAttemptAt: null,
      nextAttemptAt: new Date().toISOString(),
      lastResult: null,
      lastError: null,
    },
    updatedAt,
  };
}

function parseGithubIssueLikeUrl(url: string): { owner: string; repo: string; number: number } | null {
  const match = url.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/(?:issues|pull)\/(\d+)/i);
  if (!match) {
    return null;
  }

  return {
    owner: match[1],
    repo: match[2],
    number: Number(match[3]),
  };
}

function buildAutoSubmissionComment(task: CryptoActionTask): string {
  const stepLines = task.runbook.steps.map((step, index) => `${index + 1}. ${step}`).join('\n');

  return [
    'Automated submission generated by AETHER Crypto Revenue Engine',
    '',
    `Task: ${task.title}`,
    `Priority: ${task.priority}`,
    `Estimated reward: $${task.rewardEstimateUsd.toFixed(2)}`,
    '',
    'Objective:',
    task.runbook.objective,
    '',
    'Execution Steps:',
    stepLines,
    '',
    'Draft:',
    '```',
    task.runbook.submissionDraft,
    '```',
  ].join('\n');
}

function priorityRank(priority: CryptoActionTask['priority']): number {
  if (priority === 'high') {
    return 3;
  }
  if (priority === 'medium') {
    return 2;
  }
  return 1;
}

function parseActionTaskRecord(contentKey: unknown, contentData: unknown, updatedAt: unknown): CryptoActionTask | null {
  try {
    const parsed = JSON.parse(String(contentData || '{}')) as CryptoActionTask;
    if (!parsed || typeof parsed !== 'object' || !parsed.key) {
      return null;
    }

    return {
      ...parsed,
      key: String(parsed.key || contentKey || ''),
      execution: {
        attempts: parsed.execution?.attempts || 0,
        lastAttemptAt: parsed.execution?.lastAttemptAt || null,
        nextAttemptAt: parsed.execution?.nextAttemptAt || null,
        lastResult: parsed.execution?.lastResult || null,
        lastError: parsed.execution?.lastError || null,
      },
      updatedAt: String(parsed.updatedAt || updatedAt || new Date().toISOString()),
    };
  } catch {
    return null;
  }
}

function parseOpportunityRecord(contentKey: unknown, contentData: unknown, updatedAt: unknown): CryptoOpportunity | null {
  try {
    const parsed = JSON.parse(String(contentData || '{}')) as Partial<CryptoOpportunity>;
    if (!parsed || typeof parsed !== 'object' || !parsed.key || !parsed.url || !parsed.title) {
      return null;
    }

    return {
      key: String(parsed.key || contentKey || ''),
      source: String(parsed.source || 'unknown'),
      category: (parsed.category as CryptoOpportunity['category']) || 'bounty',
      title: String(parsed.title || ''),
      url: String(parsed.url || ''),
      summary: String(parsed.summary || ''),
      tags: Array.isArray(parsed.tags) ? parsed.tags.map((item) => String(item)).slice(0, 12) : [],
      rewardEstimateUsd: safeNumber(parsed.rewardEstimateUsd),
      score: safeNumber(parsed.score),
      monetization: {
        payableLikely: Boolean(parsed.monetization?.payableLikely),
        clearSubmissionPath: Boolean(parsed.monetization?.clearSubmissionPath),
        noCapitalFriendly: Boolean(parsed.monetization?.noCapitalFriendly),
        automationReady: Boolean(parsed.monetization?.automationReady),
        laneEligible: Boolean(parsed.monetization?.laneEligible),
        confidence: safeNumber(parsed.monetization?.confidence, 35),
        payoutSignals: Array.isArray(parsed.monetization?.payoutSignals)
          ? parsed.monetization?.payoutSignals.map((item) => String(item)).slice(0, 8)
          : [],
        submissionSignals: Array.isArray(parsed.monetization?.submissionSignals)
          ? parsed.monetization?.submissionSignals.map((item) => String(item)).slice(0, 8)
          : [],
        blockers: Array.isArray(parsed.monetization?.blockers)
          ? parsed.monetization?.blockers.map((item) => String(item)).slice(0, 8)
          : [],
      },
      updatedAt: String(parsed.updatedAt || updatedAt || new Date().toISOString()),
      metadata: (parsed.metadata as Record<string, unknown>) || {},
    };
  } catch {
    return null;
  }
}

async function loadStoredOpportunities(limit = DEFAULT_STORE_LIMIT): Promise<CryptoOpportunity[]> {
  const result = await tursoClient.execute({
    sql: `
      SELECT content_key, content_data, updated_at
      FROM dynamic_content
      WHERE content_type = 'crypto_opportunity'
      ORDER BY updated_at DESC
      LIMIT ?
    `,
    args: [Math.max(1, Math.min(100, limit))],
  });

  return result.rows
    .map((row) => parseOpportunityRecord(row.content_key, row.content_data, row.updated_at))
    .filter((item): item is CryptoOpportunity => Boolean(item));
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
        payableLikely: item.monetization.payableLikely,
        clearSubmissionPath: item.monetization.clearSubmissionPath,
        automationReady: item.monetization.automationReady,
        laneEligible: item.monetization.laneEligible,
        confidence: item.monetization.confidence,
      }),
    ],
  });

  return existing.rows.length === 0;
}

async function upsertActionTask(item: CryptoActionTask): Promise<boolean> {
  const existing = await tursoClient.execute({
    sql: `
      SELECT id, content_data
      FROM dynamic_content
      WHERE content_type = 'crypto_action_task'
        AND content_key = ?
      LIMIT 1
    `,
    args: [item.key],
  });

  const existingTask = parseActionTaskRecord(
    item.key,
    existing.rows[0]?.content_data,
    existing.rows[0]?.updated_at
  );

  const merged: CryptoActionTask = {
    ...item,
    status:
      existingTask?.status === 'completed' || existingTask?.status === 'skipped'
        ? existingTask.status
        : item.status,
    execution: existingTask?.execution || item.execution,
    submission: existingTask?.submission || item.submission,
    updatedAt: new Date().toISOString(),
  };

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
      JSON.stringify(merged),
      JSON.stringify({
        status: merged.status,
        priority: merged.priority,
        score: merged.score,
        rewardEstimateUsd: merged.rewardEstimateUsd,
        opportunityKey: merged.opportunityKey,
        channel: merged.submission?.channel || null,
        submissionState: merged.submission?.state || null,
      }),
    ],
  });

  return existing.rows.length === 0;
}

async function persistActionTask(item: CryptoActionTask): Promise<void> {
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
        channel: item.submission?.channel || null,
        submissionState: item.submission?.state || null,
      }),
    ],
  });
}

async function persistSubmission(task: CryptoActionTask, outcome: SubmissionOutcome): Promise<void> {
  const createdAt = new Date().toISOString();
  const lifecycle: SubmissionLifecycleRecord =
    outcome.state === 'submitted'
      ? {
          stage: 'reviewing',
          acceptedSignal: false,
          paidSignal: false,
          source: 'initial',
          confidence: 52,
          notes: ['Submission delivered, waiting for external review.'],
          lastCheckedAt: createdAt,
        }
      : outcome.state === 'prepared'
      ? {
          stage: 'prepared',
          acceptedSignal: false,
          paidSignal: false,
          source: 'initial',
          confidence: 30,
          notes: ['Draft prepared but not delivered to target channel.'],
          lastCheckedAt: createdAt,
        }
      : outcome.state === 'failed'
      ? {
          stage: 'failed',
          acceptedSignal: false,
          paidSignal: false,
          source: 'initial',
          confidence: 10,
          notes: [outcome.error || 'Submission failed.'],
          lastCheckedAt: createdAt,
        }
      : {
          stage: 'skipped',
          acceptedSignal: false,
          paidSignal: false,
          source: 'initial',
          confidence: 10,
          notes: ['Submission skipped by execution rules.'],
          lastCheckedAt: createdAt,
        };

  await tursoClient.execute({
    sql: `
      INSERT INTO dynamic_content (content_type, content_key, content_data, metadata)
      VALUES ('crypto_submission', ?, ?, ?)
      ON CONFLICT(content_key) DO UPDATE SET
        content_data = excluded.content_data,
        metadata = excluded.metadata,
        updated_at = CURRENT_TIMESTAMP
    `,
    args: [
      outcome.submissionKey,
      JSON.stringify({
        submissionKey: outcome.submissionKey,
        taskKey: task.key,
        opportunityKey: task.opportunityKey,
        channel: outcome.channel,
        state: outcome.state,
        externalUrl: outcome.externalUrl,
        targetUrl: task.targetUrl,
        message: outcome.message,
        error: outcome.error || null,
        lifecycle,
        createdAt,
      }),
      JSON.stringify({
        taskKey: task.key,
        channel: outcome.channel,
        state: outcome.state,
        stage: lifecycle.stage,
        acceptedSignal: lifecycle.acceptedSignal,
        paidSignal: lifecycle.paidSignal,
      }),
    ],
  });
}

function parseSubmissionRecord(contentKey: unknown, contentData: unknown, updatedAt: unknown): CryptoSubmissionRecord | null {
  try {
    const parsed = JSON.parse(String(contentData || '{}')) as Partial<CryptoSubmissionRecord>;
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }

    const lifecycle = parsed.lifecycle;
    return {
      submissionKey: String(parsed.submissionKey || contentKey || ''),
      taskKey: String(parsed.taskKey || ''),
      opportunityKey: String(parsed.opportunityKey || ''),
      channel: (parsed.channel as CryptoSubmissionRecord['channel']) || 'outbox',
      state: (parsed.state as CryptoSubmissionRecord['state']) || 'prepared',
      externalUrl: parsed.externalUrl ? String(parsed.externalUrl) : null,
      targetUrl: parsed.targetUrl ? String(parsed.targetUrl) : null,
      message: String(parsed.message || ''),
      error: parsed.error ? String(parsed.error) : null,
      createdAt: String(parsed.createdAt || updatedAt || new Date().toISOString()),
      lifecycle: lifecycle
        ? {
            stage: (lifecycle.stage as SubmissionLifecycleRecord['stage']) || 'reviewing',
            acceptedSignal: Boolean(lifecycle.acceptedSignal),
            paidSignal: Boolean(lifecycle.paidSignal),
            source: (lifecycle.source as SubmissionLifecycleRecord['source']) || 'initial',
            confidence: safeNumber(lifecycle.confidence, 50),
            notes: Array.isArray(lifecycle.notes) ? lifecycle.notes.map((item) => String(item)).slice(0, 5) : [],
            lastCheckedAt: safeIsoOrNull(lifecycle.lastCheckedAt),
          }
        : undefined,
      monitor: parsed.monitor
        ? {
            issueState: parsed.monitor.issueState ? String(parsed.monitor.issueState) : null,
            issueUpdatedAt: safeIsoOrNull(parsed.monitor.issueUpdatedAt),
            issueUrl: parsed.monitor.issueUrl ? String(parsed.monitor.issueUrl) : null,
            checkedAt: safeIsoOrNull(parsed.monitor.checkedAt),
            error: parsed.monitor.error ? String(parsed.monitor.error) : null,
          }
        : undefined,
    };
  } catch {
    return null;
  }
}

interface GithubIssueSnapshot {
  html_url?: string;
  state?: string;
  title?: string;
  body?: string | null;
  updated_at?: string;
  labels?: Array<{ name?: string }>;
}

async function fetchGithubIssueSnapshot(url: string): Promise<GithubIssueSnapshot> {
  const parsed = parseGithubIssueLikeUrl(url);
  if (!parsed) {
    throw new Error('Target URL is not a GitHub issue/pull URL');
  }

  const endpoint = `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/issues/${parsed.number}`;
  const response = await fetch(endpoint, {
    headers: getJsonHeaders(),
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`GitHub issue status HTTP ${response.status}`);
  }

  return (await response.json()) as GithubIssueSnapshot;
}

function inferLifecycleFromGithubIssue(snapshot: GithubIssueSnapshot): {
  lifecycle: SubmissionLifecycleRecord;
  issueState: string | null;
  issueUpdatedAt: string | null;
  issueUrl: string | null;
} {
  const title = String(snapshot.title || '');
  const body = String(snapshot.body || '');
  const labels = (snapshot.labels || []).map((item) => String(item.name || '').toLowerCase()).filter(Boolean);
  const state = String(snapshot.state || '').toLowerCase();
  const combined = `${title}\n${body}\n${labels.join(' ')}`.toLowerCase();

  const paidSignal = /\b(paid|payment sent|reward sent|payout sent|distributed|funds sent|sent to wallet)\b/.test(combined);
  const acceptedSignal =
    paidSignal ||
    /\b(accepted|approved|winner|awarded|selected|completed|resolved|merged|bounty complete)\b/.test(combined) ||
    labels.some((label) => /(winner|paid|accepted|completed|resolved|awarded)/.test(label));
  const rejectedSignal = /\b(rejected|not selected|declined|disqualified)\b/.test(combined);

  let stage: SubmissionLifecycleRecord['stage'] = 'reviewing';
  let confidence = state === 'closed' ? 62 : 54;
  const notes: string[] = [];

  if (rejectedSignal) {
    stage = 'failed';
    confidence = 75;
    notes.push('Negative review signal detected from issue text/labels.');
  } else if (paidSignal) {
    stage = 'paid_signal';
    confidence = 92;
    notes.push('Payment-related signal detected from issue text/labels.');
  } else if (acceptedSignal) {
    stage = 'accepted_signal';
    confidence = state === 'closed' ? 88 : 78;
    notes.push('Acceptance/winner signal detected from issue text/labels.');
  } else if (state === 'closed') {
    stage = 'reviewing';
    confidence = 64;
    notes.push('Issue closed, but no explicit accepted/paid signal yet.');
  } else {
    notes.push('Issue still under review (open/no payout signal yet).');
  }

  return {
    lifecycle: {
      stage,
      acceptedSignal,
      paidSignal,
      source: 'github_monitor',
      confidence,
      notes: notes.slice(0, 3),
      lastCheckedAt: new Date().toISOString(),
    },
    issueState: state || null,
    issueUpdatedAt: safeIsoOrNull(snapshot.updated_at),
    issueUrl: snapshot.html_url ? String(snapshot.html_url) : null,
  };
}

function shouldRunMonitorByInterval(lastRunAt: string | null, intervalMinutes: number): boolean {
  if (!lastRunAt) {
    return true;
  }
  const last = new Date(lastRunAt).getTime();
  if (!Number.isFinite(last)) {
    return true;
  }
  return Date.now() - last >= intervalMinutes * 60 * 1000;
}

async function runSubmissionLifecycleMonitor() {
  const intervalMinutes = Math.max(
    5,
    safeInteger(process.env.CRYPTO_SUBMISSION_MONITOR_INTERVAL_MINUTES, DEFAULT_SUBMISSION_MONITOR_INTERVAL_MINUTES)
  );
  const monitorLimit = Math.max(4, safeInteger(process.env.CRYPTO_SUBMISSION_MONITOR_LIMIT, DEFAULT_SUBMISSION_MONITOR_LIMIT));
  const lastRunAt = await getSetting('crypto_submission_monitor_last_run_at');
  const due = shouldRunMonitorByInterval(lastRunAt, intervalMinutes);
  const nowIso = new Date().toISOString();

  if (!due) {
    const [lastChecked, acceptedSignals, paidSignals, lastError] = await Promise.all([
      getSetting('crypto_submission_monitor_last_checked'),
      getSetting('crypto_submission_monitor_last_accepted_signals'),
      getSetting('crypto_submission_monitor_last_paid_signals'),
      getSetting('crypto_submission_monitor_last_error'),
    ]);
    return {
      due: false,
      checked: Number(lastChecked || 0) || 0,
      acceptedSignals: Number(acceptedSignals || 0) || 0,
      paidSignals: Number(paidSignals || 0) || 0,
      errors: 0,
      lastError: lastError || null,
      lastRunAt,
      intervalMinutes,
      limit: monitorLimit,
    };
  }

  const submissionsResult = await tursoClient.execute({
    sql: `
      SELECT content_key, content_data, updated_at
      FROM dynamic_content
      WHERE content_type = 'crypto_submission'
      ORDER BY updated_at DESC
      LIMIT ?
    `,
    args: [Math.max(10, monitorLimit * 3)],
  });

  const records = submissionsResult.rows
    .map((row) => parseSubmissionRecord(row.content_key, row.content_data, row.updated_at))
    .filter((row): row is CryptoSubmissionRecord => Boolean(row))
    .filter((row) => row.channel === 'github_issue_comment' && row.state === 'submitted');

  let checked = 0;
  let acceptedSignals = 0;
  let paidSignals = 0;
  let errors = 0;
  let lastError = '';

  for (const record of records.slice(0, monitorLimit)) {
    const target = record.targetUrl || record.externalUrl || '';
    if (!isGithubIssueLikeUrl(target)) {
      continue;
    }

    try {
      const issue = await fetchGithubIssueSnapshot(target);
      const inferred = inferLifecycleFromGithubIssue(issue);
      const nextRecord: CryptoSubmissionRecord = {
        ...record,
        lifecycle: inferred.lifecycle,
        monitor: {
          issueState: inferred.issueState,
          issueUpdatedAt: inferred.issueUpdatedAt,
          issueUrl: inferred.issueUrl,
          checkedAt: nowIso,
          error: null,
        },
      };

      if (inferred.lifecycle.acceptedSignal) {
        acceptedSignals += 1;
      }
      if (inferred.lifecycle.paidSignal) {
        paidSignals += 1;
      }

      await tursoClient.execute({
        sql: `
          INSERT INTO dynamic_content (content_type, content_key, content_data, metadata)
          VALUES ('crypto_submission', ?, ?, ?)
          ON CONFLICT(content_key) DO UPDATE SET
            content_data = excluded.content_data,
            metadata = excluded.metadata,
            updated_at = CURRENT_TIMESTAMP
        `,
        args: [
          nextRecord.submissionKey,
          JSON.stringify(nextRecord),
          JSON.stringify({
            taskKey: nextRecord.taskKey,
            channel: nextRecord.channel,
            state: nextRecord.state,
            stage: nextRecord.lifecycle?.stage || null,
            acceptedSignal: Boolean(nextRecord.lifecycle?.acceptedSignal),
            paidSignal: Boolean(nextRecord.lifecycle?.paidSignal),
          }),
        ],
      });

      checked += 1;
    } catch (error: unknown) {
      errors += 1;
      lastError = error instanceof Error ? error.message : String(error);
    }
  }

  await Promise.all([
    setSetting('crypto_submission_monitor_last_run_at', nowIso),
    setSetting('crypto_submission_monitor_interval_minutes', String(intervalMinutes)),
    setSetting('crypto_submission_monitor_limit', String(monitorLimit)),
    setSetting('crypto_submission_monitor_last_checked', String(checked)),
    setSetting('crypto_submission_monitor_last_accepted_signals', String(acceptedSignals)),
    setSetting('crypto_submission_monitor_last_paid_signals', String(paidSignals)),
    setSetting('crypto_submission_monitor_last_errors', String(errors)),
    setSetting('crypto_submission_monitor_last_error', lastError),
  ]);

  if (checked > 0 || errors > 0) {
    await logCrypto('crypto', 'Crypto submission lifecycle monitor completed', {
      checked,
      acceptedSignals,
      paidSignals,
      errors,
      lastError: lastError || null,
    });
  }

  return {
    due: true,
    checked,
    acceptedSignals,
    paidSignals,
    errors,
    lastError: lastError || null,
    lastRunAt: nowIso,
    intervalMinutes,
    limit: monitorLimit,
  };
}

async function submitToGithubIssueComment(task: CryptoActionTask): Promise<SubmissionOutcome> {
  const parsed = parseGithubIssueLikeUrl(task.targetUrl);
  const submissionKey = `submission_${task.key}_${Date.now()}`;

  if (!parsed) {
    return {
      state: 'prepared',
      channel: 'outbox',
      externalUrl: null,
      submissionKey,
      message: 'Target is not a supported GitHub issue URL. Draft stored in outbox.',
    };
  }

  if (!process.env.GITHUB_TOKEN) {
    return {
      state: 'prepared',
      channel: 'outbox',
      externalUrl: null,
      submissionKey,
      message: 'GITHUB_TOKEN is not set. Draft stored in outbox.',
    };
  }

  const endpoint = `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/issues/${parsed.number}/comments`;
  const payload = {
    body: buildAutoSubmissionComment(task),
  };

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        ...getJsonHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      cache: 'no-store',
    });

    if (!response.ok) {
      const text = await response.text();
      return {
        state: 'failed',
        channel: 'github_issue_comment',
        externalUrl: null,
        submissionKey,
        message: `GitHub submission failed (${response.status})`,
        error: text.slice(0, 400),
      };
    }

    const body = (await response.json()) as { html_url?: string };

    return {
      state: 'submitted',
      channel: 'github_issue_comment',
      externalUrl: body.html_url || task.targetUrl,
      submissionKey,
      message: 'Submission posted to GitHub issue comment.',
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      state: 'failed',
      channel: 'github_issue_comment',
      externalUrl: null,
      submissionKey,
      message: 'GitHub submission request failed.',
      error: message,
    };
  }
}

async function submitToWebhook(task: CryptoActionTask): Promise<SubmissionOutcome | null> {
  const webhookUrl = String(process.env.AETHER_SUBMISSION_WEBHOOK_URL || '').trim();
  if (!webhookUrl) {
    return null;
  }

  const submissionKey = `submission_${task.key}_${Date.now()}`;
  const payload = {
    submissionKey,
    task,
    generatedAt: new Date().toISOString(),
    mode: 'autonomous',
  };

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      cache: 'no-store',
    });

    if (!response.ok) {
      const text = await response.text();
      return {
        state: 'failed',
        channel: 'webhook',
        externalUrl: null,
        submissionKey,
        message: `Webhook submission failed (${response.status})`,
        error: text.slice(0, 400),
      };
    }

    return {
      state: 'submitted',
      channel: 'webhook',
      externalUrl: webhookUrl,
      submissionKey,
      message: 'Submission sent to webhook endpoint.',
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      state: 'failed',
      channel: 'webhook',
      externalUrl: null,
      submissionKey,
      message: 'Webhook submission request failed.',
      error: message,
    };
  }
}

async function runSubmissionAdapter(task: CryptoActionTask): Promise<SubmissionOutcome> {
  const targetIsGithub = isGithubIssueLikeUrl(task.targetUrl);

  if (targetIsGithub) {
    const githubOutcome = await submitToGithubIssueComment(task);
    if (githubOutcome.state === 'submitted' || githubOutcome.state === 'prepared') {
      return githubOutcome;
    }

    const webhookOutcome = await submitToWebhook(task);
    if (webhookOutcome?.state === 'submitted') {
      return webhookOutcome;
    }

    if (webhookOutcome?.state === 'failed') {
      return {
        ...githubOutcome,
        message: `${githubOutcome.message} | ${webhookOutcome.message}`,
        error: [githubOutcome.error, webhookOutcome.error].filter(Boolean).join(' | ') || githubOutcome.error,
      };
    }

    return githubOutcome;
  }

  const webhookOutcome = await submitToWebhook(task);
  if (webhookOutcome?.state === 'submitted') {
    return webhookOutcome;
  }

  const githubOutcome = await submitToGithubIssueComment(task);
  if (githubOutcome.state === 'submitted' || githubOutcome.state === 'prepared') {
    return githubOutcome;
  }

  if (webhookOutcome?.state === 'failed') {
    return {
      ...webhookOutcome,
      message: `${webhookOutcome.message} | ${githubOutcome.message}`,
      error: [webhookOutcome.error, githubOutcome.error].filter(Boolean).join(' | ') || webhookOutcome.error,
    };
  }

  return githubOutcome;
}

async function loadExecutableActionTasks(limit: number): Promise<CryptoActionTask[]> {
  const maxAttempts = Number(process.env.CRYPTO_EXECUTOR_MAX_ATTEMPTS || DEFAULT_EXECUTOR_MAX_ATTEMPTS) || DEFAULT_EXECUTOR_MAX_ATTEMPTS;
  const now = Date.now();

  const result = await tursoClient.execute({
    sql: `
      SELECT content_key, content_data, updated_at
      FROM dynamic_content
      WHERE content_type = 'crypto_action_task'
      ORDER BY updated_at DESC
      LIMIT 80
    `,
    args: [],
  });

  const tasks = result.rows
    .map((row) => parseActionTaskRecord(row.content_key, row.content_data, row.updated_at))
    .filter((item): item is CryptoActionTask => Boolean(item))
    .filter((task) => task.status === 'queued' || task.status === 'in_progress')
    .filter((task) => (task.execution?.attempts || 0) < maxAttempts)
    .filter((task) => {
      const nextAttemptAt = task.execution?.nextAttemptAt;
      if (!nextAttemptAt) {
        return true;
      }
      const next = new Date(nextAttemptAt).getTime();
      return Number.isFinite(next) ? next <= now : true;
    });

  tasks.sort((a, b) => {
    const dueA = new Date(a.dueAt || 0).getTime() || Number.MAX_SAFE_INTEGER;
    const dueB = new Date(b.dueAt || 0).getTime() || Number.MAX_SAFE_INTEGER;
    return priorityRank(b.priority) - priorityRank(a.priority) || dueA - dueB || b.score - a.score;
  });
  return tasks.slice(0, Math.max(1, limit));
}

async function getActionQueueSnapshot() {
  const result = await tursoClient.execute({
    sql: `
      SELECT content_data
      FROM dynamic_content
      WHERE content_type = 'crypto_action_task'
      ORDER BY updated_at DESC
      LIMIT 300
    `,
    args: [],
  });

  let queued = 0;
  let inProgress = 0;
  let completed = 0;
  let skipped = 0;

  for (const row of result.rows) {
    const task = parseActionTaskRecord('', row.content_data, null);
    if (!task) {
      continue;
    }
    if (task.status === 'queued') {
      queued += 1;
    } else if (task.status === 'in_progress') {
      inProgress += 1;
    } else if (task.status === 'completed') {
      completed += 1;
    } else if (task.status === 'skipped') {
      skipped += 1;
    }
  }

  return {
    queued,
    inProgress,
    completed,
    skipped,
  };
}

async function persistQueueSnapshot(snapshot: { queued: number; inProgress: number; completed: number; skipped: number }) {
  await Promise.all([
    setSetting('crypto_executor_queue_queued', String(snapshot.queued)),
    setSetting('crypto_executor_queue_in_progress', String(snapshot.inProgress)),
    setSetting('crypto_executor_queue_completed', String(snapshot.completed)),
    setSetting('crypto_executor_queue_skipped', String(snapshot.skipped)),
  ]);
}

async function getRecentActionTasks(limit = 300): Promise<CryptoActionTask[]> {
  const result = await tursoClient.execute({
    sql: `
      SELECT content_key, content_data, updated_at
      FROM dynamic_content
      WHERE content_type = 'crypto_action_task'
      ORDER BY updated_at DESC
      LIMIT ?
    `,
    args: [Math.max(20, Math.min(1000, limit))],
  });

  return result.rows
    .map((row) => parseActionTaskRecord(row.content_key, row.content_data, row.updated_at))
    .filter((task): task is CryptoActionTask => Boolean(task));
}

async function deleteActionTask(contentKey: string): Promise<void> {
  await tursoClient.execute({
    sql: `
      DELETE FROM dynamic_content
      WHERE content_type = 'crypto_action_task'
        AND content_key = ?
    `,
    args: [contentKey],
  });
}

async function executeActionTask(task: CryptoActionTask): Promise<SubmissionOutcome> {
  const maxAttempts = Number(process.env.CRYPTO_EXECUTOR_MAX_ATTEMPTS || DEFAULT_EXECUTOR_MAX_ATTEMPTS) || DEFAULT_EXECUTOR_MAX_ATTEMPTS;
  const previousAttempts = task.execution?.attempts || 0;
  const currentAttempts = previousAttempts + 1;

  const processing: CryptoActionTask = {
    ...task,
    status: 'in_progress',
    updatedAt: new Date().toISOString(),
    execution: {
      attempts: currentAttempts,
      lastAttemptAt: new Date().toISOString(),
      nextAttemptAt: null,
      lastResult: task.execution?.lastResult || null,
      lastError: null,
    },
  };
  await persistActionTask(processing);

  const outcome = await runSubmissionAdapter(processing);

  const finished: CryptoActionTask = {
    ...processing,
    status:
      outcome.state === 'failed'
        ? currentAttempts >= maxAttempts
          ? 'skipped'
          : 'queued'
        : outcome.state === 'skipped'
        ? 'skipped'
        : 'completed',
    submission: {
      channel: outcome.channel,
      state: outcome.state,
      externalUrl: outcome.externalUrl,
      submissionKey: outcome.submissionKey,
      submittedAt: new Date().toISOString(),
    },
    execution: {
      attempts: currentAttempts,
      lastAttemptAt: new Date().toISOString(),
      nextAttemptAt:
        outcome.state === 'failed' && currentAttempts < maxAttempts
          ? new Date(Date.now() + Math.min(60, 5 * currentAttempts) * 60 * 1000).toISOString()
          : null,
      lastResult: outcome.state,
      lastError: outcome.error || null,
    },
    updatedAt: new Date().toISOString(),
  };

  await Promise.all([
    persistActionTask(finished),
    persistSubmission(finished, outcome),
  ]);

  return outcome;
}

async function runCryptoActionExecutor(limit = DEFAULT_EXECUTOR_LIMIT_PER_CYCLE) {
  let processed = 0;
  let submitted = 0;
  let prepared = 0;
  let failed = 0;
  let executorError = '';

  try {
    const executable = await loadExecutableActionTasks(limit);

    for (const task of executable) {
      try {
        const outcome = await executeActionTask(task);
        processed += 1;

        if (outcome.state === 'submitted') {
          submitted += 1;
        } else if (outcome.state === 'prepared') {
          prepared += 1;
        } else if (outcome.state === 'failed') {
          failed += 1;
        }
      } catch (error: unknown) {
        failed += 1;
        executorError = error instanceof Error ? error.message : String(error);
      }
    }
  } catch (error: unknown) {
    executorError = error instanceof Error ? error.message : String(error);
  }

  const queueSnapshot = await getActionQueueSnapshot();
  await persistQueueSnapshot(queueSnapshot);

  await Promise.all([
    setSetting('crypto_executor_last_run_at', new Date().toISOString()),
    setSetting('crypto_executor_last_processed', String(processed)),
    setSetting('crypto_executor_last_submitted', String(submitted)),
    setSetting('crypto_executor_last_prepared', String(prepared)),
    setSetting('crypto_executor_last_failed', String(failed)),
    setSetting('crypto_executor_last_error', executorError),
  ]);

  await logCrypto('crypto', 'Crypto action executor cycle completed', {
    processed,
    submitted,
    prepared,
    failed,
    queue: queueSnapshot,
    error: executorError || null,
  });

  return {
    processed,
    submitted,
    prepared,
    failed,
    queue: queueSnapshot,
    error: executorError || null,
  };
}

function taskSortScore(task: CryptoActionTask): number {
  const due = safeIsoOrNull(task.dueAt);
  const dueTime = due ? new Date(due).getTime() : Number.MAX_SAFE_INTEGER;
  return priorityRank(task.priority) * 1_000_000 + safeNumber(task.score) * 1_000 - Math.floor(dueTime / 1000);
}

function mergeTaskExecution(task: CryptoActionTask): NonNullable<CryptoActionTask['execution']> {
  return {
    attempts: task.execution?.attempts || 0,
    lastAttemptAt: safeIsoOrNull(task.execution?.lastAttemptAt),
    nextAttemptAt: safeIsoOrNull(task.execution?.nextAttemptAt),
    lastResult: task.execution?.lastResult || null,
    lastError: task.execution?.lastError || null,
  };
}

async function runCryptoMaintenance(): Promise<CryptoMaintenanceSummary> {
  const nowIso = new Date().toISOString();
  const now = Date.now();
  const staleInProgressMinutes = Math.max(
    5,
    safeInteger(process.env.CRYPTO_STALE_IN_PROGRESS_MINUTES, DEFAULT_STALE_IN_PROGRESS_MINUTES)
  );
  const overdueQueuedMinutes = Math.max(
    5,
    safeInteger(process.env.CRYPTO_QUEUE_OVERDUE_MINUTES, DEFAULT_QUEUE_OVERDUE_MINUTES)
  );
  const retentionDays = Math.max(1, safeInteger(process.env.CRYPTO_TASK_RETENTION_DAYS, DEFAULT_TASK_RETENTION_DAYS));
  const activeTaskLimit = Math.max(20, safeInteger(process.env.CRYPTO_ACTIVE_TASK_LIMIT, DEFAULT_ACTIVE_TASK_LIMIT));

  const staleInProgressMs = staleInProgressMinutes * 60 * 1000;
  const overdueQueuedMs = overdueQueuedMinutes * 60 * 1000;
  const pruneBefore = now - retentionDays * 24 * 60 * 60 * 1000;
  const changed = new Map<string, CryptoActionTask>();
  const toDelete: string[] = [];
  let recoveredInProgress = 0;
  let reprioritizedQueued = 0;
  let prunedTasks = 0;
  let autoSkippedOverflow = 0;

  const tasks = await getRecentActionTasks(400);

  for (const rawTask of tasks) {
    const task: CryptoActionTask = {
      ...rawTask,
      execution: mergeTaskExecution(rawTask),
    };
    let mutated = false;

    if (task.status === 'in_progress') {
      const lastAttemptMs = safeIsoOrNull(task.execution?.lastAttemptAt)
        ? new Date(String(task.execution?.lastAttemptAt)).getTime()
        : safeIsoOrNull(task.updatedAt)
        ? new Date(String(task.updatedAt)).getTime()
        : 0;

      if (!Number.isFinite(lastAttemptMs) || now - lastAttemptMs >= staleInProgressMs) {
        task.status = 'queued';
        task.execution = {
          ...mergeTaskExecution(task),
          nextAttemptAt: nowIso,
          lastResult: 'failed',
          lastError: `Auto-recovered from stale in_progress at ${nowIso}`,
        };
        task.updatedAt = nowIso;
        recoveredInProgress += 1;
        mutated = true;
      }
    }

    if (task.status === 'queued') {
      const dueMs = safeIsoOrNull(task.dueAt) ? new Date(String(task.dueAt)).getTime() : 0;
      const nextAttemptMs = safeIsoOrNull(task.execution?.nextAttemptAt)
        ? new Date(String(task.execution?.nextAttemptAt)).getTime()
        : 0;

      if ((Number.isFinite(dueMs) && now - dueMs >= overdueQueuedMs) || (Number.isFinite(nextAttemptMs) && now - nextAttemptMs >= overdueQueuedMs)) {
        if (task.priority !== 'high') {
          task.priority = 'high';
        }
        task.execution = {
          ...mergeTaskExecution(task),
          nextAttemptAt: nowIso,
        };
        task.dueAt = new Date(now + 20 * 60 * 1000).toISOString();
        task.updatedAt = nowIso;
        reprioritizedQueued += 1;
        mutated = true;
      }
    }

    const updatedMs = safeIsoOrNull(task.updatedAt) ? new Date(String(task.updatedAt)).getTime() : now;
    if ((task.status === 'completed' || task.status === 'skipped') && Number.isFinite(updatedMs) && updatedMs <= pruneBefore) {
      toDelete.push(task.key);
      continue;
    }

    if (mutated) {
      changed.set(task.key, task);
    }
  }

  const activePool = tasks
    .map((task) => changed.get(task.key) || task)
    .filter((task) => task.status === 'queued' || task.status === 'in_progress')
    .sort((a, b) => taskSortScore(b) - taskSortScore(a));

  if (activePool.length > activeTaskLimit) {
    const overflow = activePool.slice(activeTaskLimit);
    for (const task of overflow) {
      const next = changed.get(task.key) || task;
      if (next.status !== 'queued') {
        continue;
      }

      const skippedTask: CryptoActionTask = {
        ...next,
        status: 'skipped',
        execution: {
          ...mergeTaskExecution(next),
          nextAttemptAt: null,
          lastResult: 'skipped',
          lastError: `Auto-skipped by queue guard at ${nowIso}`,
        },
        updatedAt: nowIso,
      };
      changed.set(skippedTask.key, skippedTask);
      autoSkippedOverflow += 1;
    }
  }

  if (changed.size > 0) {
    await Promise.all(Array.from(changed.values()).map((task) => persistActionTask(task)));
  }

  if (toDelete.length > 0) {
    await Promise.all(toDelete.map((key) => deleteActionTask(key)));
    prunedTasks = toDelete.length;
  }

  const queueSnapshot = await getActionQueueSnapshot();
  await persistQueueSnapshot(queueSnapshot);

  const issues: string[] = [];
  if (recoveredInProgress > 0) {
    issues.push(`Recovered ${recoveredInProgress} stale in-progress tasks`);
  }
  if (autoSkippedOverflow > 0) {
    issues.push(`Auto-skipped ${autoSkippedOverflow} overflow tasks`);
  }
  if (queueSnapshot.queued >= Math.floor(activeTaskLimit * 0.85)) {
    issues.push(`Queue backlog high (${queueSnapshot.queued}/${activeTaskLimit})`);
  }
  const health: 'healthy' | 'attention' = issues.length > 0 ? 'attention' : 'healthy';

  await Promise.all([
    setSetting('crypto_maintenance_last_run_at', nowIso),
    setSetting('crypto_maintenance_last_recovered_in_progress', String(recoveredInProgress)),
    setSetting('crypto_maintenance_last_reprioritized_queued', String(reprioritizedQueued)),
    setSetting('crypto_maintenance_last_pruned_tasks', String(prunedTasks)),
    setSetting('crypto_maintenance_last_auto_skipped_overflow', String(autoSkippedOverflow)),
    setSetting('crypto_maintenance_health', health),
    setSetting('crypto_maintenance_issues', JSON.stringify(issues)),
    setSetting('crypto_maintenance_stale_minutes', String(staleInProgressMinutes)),
    setSetting('crypto_maintenance_overdue_minutes', String(overdueQueuedMinutes)),
    setSetting('crypto_maintenance_retention_days', String(retentionDays)),
    setSetting('crypto_maintenance_active_task_limit', String(activeTaskLimit)),
  ]);

  await logCrypto('crypto', 'Crypto engine self-healing maintenance completed', {
    recoveredInProgress,
    reprioritizedQueued,
    prunedTasks,
    autoSkippedOverflow,
    queue: queueSnapshot,
    health,
    issues,
  });

  return {
    recoveredInProgress,
    reprioritizedQueued,
    prunedTasks,
    autoSkippedOverflow,
    queue: queueSnapshot,
    health,
    issues,
  };
}

async function appendCycleHistory(snapshot: CryptoCycleSnapshot) {
  const historyLimit = Math.max(
    8,
    safeInteger(process.env.CRYPTO_ENGINE_CYCLE_HISTORY_LIMIT, DEFAULT_CYCLE_HISTORY_LIMIT)
  );
  const raw = await getSetting('crypto_engine_cycle_history');
  let history: CryptoCycleSnapshot[] = [];

  if (raw) {
    try {
      const parsed = JSON.parse(raw) as CryptoCycleSnapshot[];
      if (Array.isArray(parsed)) {
        history = parsed.filter((item) => item && typeof item === 'object' && Boolean(item.at));
      }
    } catch {
      history = [];
    }
  }

  history.unshift(snapshot);
  history = history.slice(0, historyLimit);

  await Promise.all([
    setSetting('crypto_engine_cycle_history', JSON.stringify(history)),
    setSetting('crypto_engine_cycle_history_limit', String(historyLimit)),
  ]);
}

async function collectCryptoOpportunities(): Promise<{
  opportunities: CryptoOpportunity[];
  sourceStats: SourceStatsSummary;
}> {
  const queries = getGithubQueries();
  const feedUrls = getFeedUrls();

  const issuesByQuery = await Promise.all(
    queries.map(async (query) => {
      try {
        return {
          ok: true,
          items: await fetchGithubIssues(query),
        };
      } catch {
        return {
          ok: false,
          items: [] as GithubIssue[],
        };
      }
    })
  );
  const queryFailures = issuesByQuery.filter((item) => !item.ok).length;

  const githubCandidates = issuesByQuery
    .flat()
    .flatMap((item) => item.items)
    .map((issue) => issueToOpportunity(issue))
    .filter((item): item is CryptoOpportunity => Boolean(item));

  const feedItemsByUrl = await Promise.all(
    feedUrls.map(async (feedUrl) => {
      try {
        return {
          ok: true,
          items: await fetchFeedItems(feedUrl),
        };
      } catch {
        return {
          ok: false,
          items: [] as FeedOpportunityRaw[],
        };
      }
    })
  );
  const feedFailures = feedItemsByUrl.filter((item) => !item.ok).length;

  const feedCandidates = feedItemsByUrl
    .flat()
    .flatMap((item) => item.items)
    .map((item) => feedItemToOpportunity(item))
    .filter((candidate): candidate is CryptoOpportunity => Boolean(candidate));

  const seen = new Set<string>();
  const opportunities: CryptoOpportunity[] = [];

  for (const candidate of [...githubCandidates, ...feedCandidates]) {
    if (seen.has(candidate.url)) {
      continue;
    }

    seen.add(candidate.url);
    opportunities.push(candidate);
  }

  const strictRealLane = String(process.env.CRYPTO_REAL_LANE_STRICT || 'true').toLowerCase() !== 'false';
  const laneEligible = opportunities.filter((item) => item.monetization.laneEligible);
  const automationReadyCount = opportunities.filter((item) => item.monetization.automationReady).length;
  const selectedPool = strictRealLane && laneEligible.length > 0 ? laneEligible : opportunities;
  let usedStoredFallback = false;

  selectedPool.sort((a, b) => b.score - a.score || b.rewardEstimateUsd - a.rewardEstimateUsd);
  let limited = selectedPool.slice(0, DEFAULT_STORE_LIMIT);

  if (
    limited.length === 0 &&
    opportunities.length === 0 &&
    (queryFailures >= Math.max(1, queries.length) || feedFailures >= Math.max(1, feedUrls.length))
  ) {
    const stored = await loadStoredOpportunities(DEFAULT_STORE_LIMIT);
    if (stored.length > 0) {
      usedStoredFallback = true;
      limited = stored;
    }
  }

  return {
    opportunities: limited,
    sourceStats: {
      github: githubCandidates.length,
      feed: feedCandidates.length,
      total: limited.length,
      queries: queries.length,
      feeds: feedUrls.length,
      laneEligible: laneEligible.length,
      automationReady: automationReadyCount,
      strictRealLane,
      queryFailures,
      feedFailures,
      usedStoredFallback,
    },
  };
}

export async function getCryptoEngineStatus() {
  const [
    lastRunAt,
    lastError,
    lastTotal,
    lastNew,
    lastActions,
    intervalValue,
    status,
    executorLastRunAt,
    executorLastProcessed,
    executorLastSubmitted,
    executorLastPrepared,
    executorLastFailed,
    executorLastError,
    executorQueueQueued,
    executorQueueInProgress,
    executorQueueCompleted,
    executorQueueSkipped,
    sourceGithubCount,
    sourceFeedCount,
    sourceQueryCount,
    sourceFeedSourceCount,
    sourceLaneEligible,
    sourceAutomationReady,
    sourceStrictRealLane,
    sourceQueryFailures,
    sourceFeedFailures,
    sourceUsedStoredFallback,
    maintenanceLastRunAt,
    maintenanceRecovered,
    maintenanceReprioritized,
    maintenancePruned,
    maintenanceAutoSkipped,
    maintenanceHealth,
    maintenanceIssues,
    maintenanceStaleMinutes,
    maintenanceOverdueMinutes,
    maintenanceRetentionDays,
    maintenanceActiveTaskLimit,
    cycleHistoryRaw,
    cycleHistoryLimit,
    submissionMonitorLastRunAt,
    submissionMonitorInterval,
    submissionMonitorLimit,
    submissionMonitorLastChecked,
    submissionMonitorAcceptedSignals,
    submissionMonitorPaidSignals,
    submissionMonitorLastErrors,
    submissionMonitorLastError,
  ] = await Promise.all([
    getSetting('crypto_engine_last_run_at'),
    getSetting('crypto_engine_last_error'),
    getSetting('crypto_engine_last_total'),
    getSetting('crypto_engine_last_new'),
    getSetting('crypto_engine_last_actions'),
    getSetting('crypto_engine_interval_minutes'),
    getSetting('crypto_engine_status'),
    getSetting('crypto_executor_last_run_at'),
    getSetting('crypto_executor_last_processed'),
    getSetting('crypto_executor_last_submitted'),
    getSetting('crypto_executor_last_prepared'),
    getSetting('crypto_executor_last_failed'),
    getSetting('crypto_executor_last_error'),
    getSetting('crypto_executor_queue_queued'),
    getSetting('crypto_executor_queue_in_progress'),
    getSetting('crypto_executor_queue_completed'),
    getSetting('crypto_executor_queue_skipped'),
    getSetting('crypto_engine_last_github_count'),
    getSetting('crypto_engine_last_feed_count'),
    getSetting('crypto_engine_last_query_count'),
    getSetting('crypto_engine_last_feed_source_count'),
    getSetting('crypto_engine_last_lane_eligible_count'),
    getSetting('crypto_engine_last_automation_ready_count'),
    getSetting('crypto_engine_strict_real_lane'),
    getSetting('crypto_engine_last_query_failures'),
    getSetting('crypto_engine_last_feed_failures'),
    getSetting('crypto_engine_last_used_stored_fallback'),
    getSetting('crypto_maintenance_last_run_at'),
    getSetting('crypto_maintenance_last_recovered_in_progress'),
    getSetting('crypto_maintenance_last_reprioritized_queued'),
    getSetting('crypto_maintenance_last_pruned_tasks'),
    getSetting('crypto_maintenance_last_auto_skipped_overflow'),
    getSetting('crypto_maintenance_health'),
    getSetting('crypto_maintenance_issues'),
    getSetting('crypto_maintenance_stale_minutes'),
    getSetting('crypto_maintenance_overdue_minutes'),
    getSetting('crypto_maintenance_retention_days'),
    getSetting('crypto_maintenance_active_task_limit'),
    getSetting('crypto_engine_cycle_history'),
    getSetting('crypto_engine_cycle_history_limit'),
    getSetting('crypto_submission_monitor_last_run_at'),
    getSetting('crypto_submission_monitor_interval_minutes'),
    getSetting('crypto_submission_monitor_limit'),
    getSetting('crypto_submission_monitor_last_checked'),
    getSetting('crypto_submission_monitor_last_accepted_signals'),
    getSetting('crypto_submission_monitor_last_paid_signals'),
    getSetting('crypto_submission_monitor_last_errors'),
    getSetting('crypto_submission_monitor_last_error'),
  ]);

  let maintenanceIssuesList: string[] = [];
  if (maintenanceIssues) {
    try {
      const parsed = JSON.parse(maintenanceIssues) as string[];
      if (Array.isArray(parsed)) {
        maintenanceIssuesList = parsed.map((item) => String(item)).slice(0, 10);
      }
    } catch {
      maintenanceIssuesList = [];
    }
  }

  let cycleHistory: CryptoCycleSnapshot[] = [];
  if (cycleHistoryRaw) {
    try {
      const parsed = JSON.parse(cycleHistoryRaw) as CryptoCycleSnapshot[];
      if (Array.isArray(parsed)) {
        cycleHistory = parsed
          .filter((item) => item && typeof item === 'object' && Boolean(item.at))
          .slice(0, 24);
      }
    } catch {
      cycleHistory = [];
    }
  }

  return {
    status: status || 'idle',
    intervalMinutes: Number(intervalValue || DEFAULT_ENGINE_INTERVAL_MINUTES) || DEFAULT_ENGINE_INTERVAL_MINUTES,
    lastRunAt: lastRunAt || null,
    lastError: lastError || null,
    lastTotal: Number(lastTotal || 0) || 0,
    lastNew: Number(lastNew || 0) || 0,
    lastActions: Number(lastActions || 0) || 0,
    executor: {
      lastRunAt: executorLastRunAt || null,
      lastProcessed: Number(executorLastProcessed || 0) || 0,
      lastSubmitted: Number(executorLastSubmitted || 0) || 0,
      lastPrepared: Number(executorLastPrepared || 0) || 0,
      lastFailed: Number(executorLastFailed || 0) || 0,
      lastError: executorLastError || null,
      maxAttempts: Number(process.env.CRYPTO_EXECUTOR_MAX_ATTEMPTS || DEFAULT_EXECUTOR_MAX_ATTEMPTS) || DEFAULT_EXECUTOR_MAX_ATTEMPTS,
      queue: {
        queued: Number(executorQueueQueued || 0) || 0,
        inProgress: Number(executorQueueInProgress || 0) || 0,
        completed: Number(executorQueueCompleted || 0) || 0,
        skipped: Number(executorQueueSkipped || 0) || 0,
      },
    },
    sources: {
      github: Number(sourceGithubCount || 0) || 0,
      feed: Number(sourceFeedCount || 0) || 0,
      queries: Number(sourceQueryCount || 0) || 0,
      feedSources: Number(sourceFeedSourceCount || 0) || 0,
      laneEligible: Number(sourceLaneEligible || 0) || 0,
      automationReady: Number(sourceAutomationReady || 0) || 0,
      strictRealLane: sourceStrictRealLane !== 'false',
      queryFailures: Number(sourceQueryFailures || 0) || 0,
      feedFailures: Number(sourceFeedFailures || 0) || 0,
      usedStoredFallback: sourceUsedStoredFallback === 'true',
    },
    maintenance: {
      lastRunAt: maintenanceLastRunAt || null,
      recoveredInProgress: Number(maintenanceRecovered || 0) || 0,
      reprioritizedQueued: Number(maintenanceReprioritized || 0) || 0,
      prunedTasks: Number(maintenancePruned || 0) || 0,
      autoSkippedOverflow: Number(maintenanceAutoSkipped || 0) || 0,
      health: maintenanceHealth === 'attention' ? 'attention' : 'healthy',
      issues: maintenanceIssuesList,
      staleInProgressMinutes:
        Number(maintenanceStaleMinutes || DEFAULT_STALE_IN_PROGRESS_MINUTES) || DEFAULT_STALE_IN_PROGRESS_MINUTES,
      overdueQueuedMinutes:
        Number(maintenanceOverdueMinutes || DEFAULT_QUEUE_OVERDUE_MINUTES) || DEFAULT_QUEUE_OVERDUE_MINUTES,
      retentionDays: Number(maintenanceRetentionDays || DEFAULT_TASK_RETENTION_DAYS) || DEFAULT_TASK_RETENTION_DAYS,
      activeTaskLimit: Number(maintenanceActiveTaskLimit || DEFAULT_ACTIVE_TASK_LIMIT) || DEFAULT_ACTIVE_TASK_LIMIT,
    },
    cycleHistory,
    cycleHistoryLimit: Number(cycleHistoryLimit || DEFAULT_CYCLE_HISTORY_LIMIT) || DEFAULT_CYCLE_HISTORY_LIMIT,
    submissionMonitor: {
      lastRunAt: submissionMonitorLastRunAt || null,
      intervalMinutes:
        Number(submissionMonitorInterval || DEFAULT_SUBMISSION_MONITOR_INTERVAL_MINUTES) ||
        DEFAULT_SUBMISSION_MONITOR_INTERVAL_MINUTES,
      limit: Number(submissionMonitorLimit || DEFAULT_SUBMISSION_MONITOR_LIMIT) || DEFAULT_SUBMISSION_MONITOR_LIMIT,
      checked: Number(submissionMonitorLastChecked || 0) || 0,
      acceptedSignals: Number(submissionMonitorAcceptedSignals || 0) || 0,
      paidSignals: Number(submissionMonitorPaidSignals || 0) || 0,
      errors: Number(submissionMonitorLastErrors || 0) || 0,
      lastError: submissionMonitorLastError || null,
    },
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

export async function getCryptoSubmissions(limit = 12) {
  const result = await tursoClient.execute({
    sql: `
      SELECT content_key, content_data, updated_at
      FROM dynamic_content
      WHERE content_type = 'crypto_submission'
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
  executedActions: number;
  submittedActions: number;
  preparedActions: number;
  failedActions: number;
  sourceStats: {
    github: number;
    feed: number;
    total: number;
    queries: number;
    feeds: number;
    laneEligible: number;
    automationReady: number;
    strictRealLane: boolean;
    queryFailures: number;
    feedFailures: number;
    usedStoredFallback: boolean;
  };
  topScore: number;
  maintenance: {
    recoveredInProgress: number;
    reprioritizedQueued: number;
    prunedTasks: number;
    autoSkippedOverflow: number;
    health: 'healthy' | 'attention';
    queue: {
      queued: number;
      inProgress: number;
      completed: number;
      skipped: number;
    };
    issues: string[];
  };
  submissionMonitor: {
    due: boolean;
    checked: number;
    acceptedSignals: number;
    paidSignals: number;
    errors: number;
    lastError: string | null;
    lastRunAt: string | null;
    intervalMinutes: number;
    limit: number;
  };
  error?: string;
}> {
  try {
    await setSetting('crypto_engine_status', 'running');
    const collected = await collectCryptoOpportunities();
    const opportunities = collected.opportunities;

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

    const execution = await runCryptoActionExecutor(DEFAULT_EXECUTOR_LIMIT_PER_CYCLE);
    const maintenance = await runCryptoMaintenance();
    const submissionMonitor = await runSubmissionLifecycleMonitor();
    const topScore = opportunities[0]?.score || 0;
    const cycleSnapshot: CryptoCycleSnapshot = {
      at: new Date().toISOString(),
      total: opportunities.length,
      newItems,
      actionItems: newActions,
      executedActions: execution.processed,
      submittedActions: execution.submitted,
      preparedActions: execution.prepared,
      failedActions: execution.failed,
      topScore,
      sources: {
        github: collected.sourceStats.github,
        feed: collected.sourceStats.feed,
        total: collected.sourceStats.total,
        laneEligible: collected.sourceStats.laneEligible,
        automationReady: collected.sourceStats.automationReady,
        strictRealLane: collected.sourceStats.strictRealLane,
        queryFailures: collected.sourceStats.queryFailures,
        feedFailures: collected.sourceStats.feedFailures,
        usedStoredFallback: collected.sourceStats.usedStoredFallback,
      },
      maintenance: {
        recoveredInProgress: maintenance.recoveredInProgress,
        reprioritizedQueued: maintenance.reprioritizedQueued,
        prunedTasks: maintenance.prunedTasks,
        autoSkippedOverflow: maintenance.autoSkippedOverflow,
        health: maintenance.health,
      },
      submissionMonitor: {
        checked: submissionMonitor.checked,
        acceptedSignals: submissionMonitor.acceptedSignals,
        paidSignals: submissionMonitor.paidSignals,
      },
    };

    await Promise.all([
      setSetting('crypto_engine_status', 'running'),
      setSetting('crypto_engine_last_run_at', cycleSnapshot.at),
      setSetting('crypto_engine_last_total', String(opportunities.length)),
      setSetting('crypto_engine_last_new', String(newItems)),
      setSetting('crypto_engine_last_actions', String(newActions)),
      setSetting('crypto_engine_last_github_count', String(collected.sourceStats.github)),
      setSetting('crypto_engine_last_feed_count', String(collected.sourceStats.feed)),
      setSetting('crypto_engine_last_query_count', String(collected.sourceStats.queries)),
      setSetting('crypto_engine_last_feed_source_count', String(collected.sourceStats.feeds)),
      setSetting('crypto_engine_last_lane_eligible_count', String(collected.sourceStats.laneEligible)),
      setSetting('crypto_engine_last_automation_ready_count', String(collected.sourceStats.automationReady)),
      setSetting('crypto_engine_strict_real_lane', String(collected.sourceStats.strictRealLane)),
      setSetting('crypto_engine_last_query_failures', String(collected.sourceStats.queryFailures)),
      setSetting('crypto_engine_last_feed_failures', String(collected.sourceStats.feedFailures)),
      setSetting('crypto_engine_last_used_stored_fallback', String(collected.sourceStats.usedStoredFallback)),
      setSetting('crypto_engine_interval_minutes', String(DEFAULT_ENGINE_INTERVAL_MINUTES)),
      setSetting('crypto_engine_last_error', ''),
    ]);
    await appendCycleHistory(cycleSnapshot);

    await logCrypto('crypto', 'Crypto revenue engine cycle completed', {
      total: opportunities.length,
      newItems,
      newActions,
      executedActions: execution.processed,
      submittedActions: execution.submitted,
      preparedActions: execution.prepared,
      failedActions: execution.failed,
      sourceStats: collected.sourceStats,
      topScore,
      maintenance,
      submissionMonitor,
      mode: 'real_lane_a',
    });

    if (collected.sourceStats.usedStoredFallback) {
      await logCrypto('warn', 'Crypto engine used stored opportunities fallback', {
        queryFailures: collected.sourceStats.queryFailures,
        feedFailures: collected.sourceStats.feedFailures,
      });
    }

    return {
      success: true,
      total: opportunities.length,
      newItems,
      actionItems: newActions,
      executedActions: execution.processed,
      submittedActions: execution.submitted,
      preparedActions: execution.prepared,
      failedActions: execution.failed,
      sourceStats: collected.sourceStats,
      topScore,
      maintenance,
      submissionMonitor,
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
      executedActions: 0,
      submittedActions: 0,
      preparedActions: 0,
      failedActions: 0,
      sourceStats: {
        github: 0,
        feed: 0,
        total: 0,
        queries: 0,
        feeds: 0,
        laneEligible: 0,
        automationReady: 0,
        strictRealLane: true,
        queryFailures: 0,
        feedFailures: 0,
        usedStoredFallback: false,
      },
      topScore: 0,
      maintenance: {
        recoveredInProgress: 0,
        reprioritizedQueued: 0,
        prunedTasks: 0,
        autoSkippedOverflow: 0,
        health: 'attention',
        queue: {
          queued: 0,
          inProgress: 0,
          completed: 0,
          skipped: 0,
        },
        issues: [message],
      },
      submissionMonitor: {
        due: false,
        checked: 0,
        acceptedSignals: 0,
        paidSignals: 0,
        errors: 1,
        lastError: message,
        lastRunAt: null,
        intervalMinutes: DEFAULT_SUBMISSION_MONITOR_INTERVAL_MINUTES,
        limit: DEFAULT_SUBMISSION_MONITOR_LIMIT,
      },
      error: message,
    };
  }
}
