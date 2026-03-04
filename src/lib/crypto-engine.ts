import { createHash } from 'node:crypto';
import tursoClient from './db';

const DEFAULT_ENGINE_INTERVAL_MINUTES = 30;
const DEFAULT_MAX_ITEMS_PER_QUERY = 20;
const DEFAULT_STORE_LIMIT = 40;
const DEFAULT_EXECUTOR_LIMIT_PER_CYCLE = 5;
const DEFAULT_EXECUTOR_MAX_ATTEMPTS = 3;

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
  execution?: {
    attempts: number;
    lastAttemptAt: string | null;
    nextAttemptAt: string | null;
    lastResult: 'submitted' | 'prepared' | 'failed' | 'skipped' | null;
    lastError: string | null;
  };
  submission?: {
    channel: 'github_issue_comment' | 'outbox';
    state: 'submitted' | 'prepared' | 'failed' | 'skipped';
    externalUrl: string | null;
    submissionKey: string;
    submittedAt: string;
  };
  updatedAt: string;
}

interface SubmissionOutcome {
  state: 'submitted' | 'prepared' | 'failed' | 'skipped';
  channel: 'github_issue_comment' | 'outbox';
  externalUrl: string | null;
  submissionKey: string;
  message: string;
  error?: string;
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
  const deadlineAt = parseDeadlineFromText(combined);
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
        message: outcome.message,
        error: outcome.error || null,
        createdAt: new Date().toISOString(),
      }),
      JSON.stringify({
        taskKey: task.key,
        channel: outcome.channel,
        state: outcome.state,
      }),
    ],
  });
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

  const outcome = await submitToGithubIssueComment(processing);

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

  await Promise.all([
    setSetting('crypto_executor_last_run_at', new Date().toISOString()),
    setSetting('crypto_executor_last_processed', String(processed)),
    setSetting('crypto_executor_last_submitted', String(submitted)),
    setSetting('crypto_executor_last_prepared', String(prepared)),
    setSetting('crypto_executor_last_failed', String(failed)),
    setSetting('crypto_executor_queue_queued', String(queueSnapshot.queued)),
    setSetting('crypto_executor_queue_in_progress', String(queueSnapshot.inProgress)),
    setSetting('crypto_executor_queue_completed', String(queueSnapshot.completed)),
    setSetting('crypto_executor_queue_skipped', String(queueSnapshot.skipped)),
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
  ]);

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

    const execution = await runCryptoActionExecutor(DEFAULT_EXECUTOR_LIMIT_PER_CYCLE);
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
      executedActions: execution.processed,
      submittedActions: execution.submitted,
      preparedActions: execution.prepared,
      failedActions: execution.failed,
      topScore,
      mode: 'no_capital',
    });

    return {
      success: true,
      total: opportunities.length,
      newItems,
      actionItems: newActions,
      executedActions: execution.processed,
      submittedActions: execution.submitted,
      preparedActions: execution.prepared,
      failedActions: execution.failed,
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
      executedActions: 0,
      submittedActions: 0,
      preparedActions: 0,
      failedActions: 0,
      topScore: 0,
      error: message,
    };
  }
}
