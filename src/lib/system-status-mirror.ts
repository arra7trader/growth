import { createHash } from 'node:crypto';
import { Octokit } from '@octokit/rest';
import { getFileContent, updateFile } from './github';

const DEFAULT_MIRROR_PATH = 'generated/runtime/system-status-mirror.json';
const DEFAULT_MIRROR_MIN_WRITE_INTERVAL_SECONDS = 180;
const DEFAULT_MIRROR_ISSUE_TITLE = '[AETHER] Runtime Status Mirror';
const MIRROR_COMMENT_MARKER = '<!-- AETHER_SYSTEM_STATUS_MIRROR_V1 -->';

let lastWriteAtMs = 0;
let lastWriteFingerprint = '';
let cachedMirrorIssueNumber: number | null = null;

export interface SystemStatusMirrorEnvelope {
  snapshotAt: string;
  source: string;
  fingerprint: string;
  data: Record<string, unknown>;
}

function isMirrorEnabled(): boolean {
  if (!process.env.GITHUB_TOKEN) {
    return false;
  }
  return String(process.env.AETHER_GITHUB_MIRROR_ENABLED || 'true').toLowerCase() !== 'false';
}

function getMirrorPath(): string {
  const raw = String(process.env.AETHER_GITHUB_MIRROR_PATH || '').trim();
  return raw || DEFAULT_MIRROR_PATH;
}

function getMinWriteIntervalSeconds(): number {
  const raw = Number(process.env.AETHER_GITHUB_MIRROR_MIN_WRITE_INTERVAL_SECONDS || DEFAULT_MIRROR_MIN_WRITE_INTERVAL_SECONDS);
  return Number.isFinite(raw) && raw > 10 ? Math.round(raw) : DEFAULT_MIRROR_MIN_WRITE_INTERVAL_SECONDS;
}

function getMirrorMode(): 'auto' | 'repo_file' | 'issue_comment' {
  const raw = String(process.env.AETHER_GITHUB_MIRROR_MODE || 'auto').trim().toLowerCase();
  if (raw === 'repo_file' || raw === 'issue_comment') {
    return raw;
  }
  return 'auto';
}

function getMirrorIssueTitle(): string {
  const raw = String(process.env.AETHER_GITHUB_MIRROR_ISSUE_TITLE || '').trim();
  return raw || DEFAULT_MIRROR_ISSUE_TITLE;
}

function getMirrorIssueNumberFromEnv(): number | null {
  const n = Number(process.env.AETHER_GITHUB_MIRROR_ISSUE_NUMBER || 0);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

function getOctokitClient(): Octokit | null {
  if (!process.env.GITHUB_TOKEN) {
    return null;
  }
  return new Octokit({ auth: process.env.GITHUB_TOKEN });
}

function getRepoOwner(): string {
  return process.env.GITHUB_OWNER || 'arra7trader';
}

function getRepoName(): string {
  return process.env.GITHUB_REPO || 'growth';
}

function toFingerprint(data: Record<string, unknown>): string {
  return createHash('sha1').update(JSON.stringify(data)).digest('hex');
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

function encodeMirrorComment(payload: SystemStatusMirrorEnvelope): string {
  return [
    MIRROR_COMMENT_MARKER,
    '```json',
    JSON.stringify(payload),
    '```',
  ].join('\n');
}

function decodeMirrorComment(body: string): SystemStatusMirrorEnvelope | null {
  if (!body.includes(MIRROR_COMMENT_MARKER)) {
    return null;
  }

  const match = body.match(/```json\s*([\s\S]*?)\s*```/i);
  if (!match?.[1]) {
    return null;
  }

  try {
    const parsed = JSON.parse(match[1]) as Partial<SystemStatusMirrorEnvelope>;
    if (!parsed || typeof parsed !== 'object' || !parsed.data) {
      return null;
    }
    return {
      snapshotAt: safeIsoOrNull(parsed.snapshotAt) || new Date(0).toISOString(),
      source: String(parsed.source || 'github_issue_comment'),
      fingerprint: String(parsed.fingerprint || toFingerprint(parsed.data as Record<string, unknown>)),
      data: parsed.data as Record<string, unknown>,
    };
  } catch {
    return null;
  }
}

async function ensureMirrorIssueNumber(client: Octokit): Promise<number | null> {
  if (cachedMirrorIssueNumber) {
    return cachedMirrorIssueNumber;
  }

  const envIssue = getMirrorIssueNumberFromEnv();
  if (envIssue) {
    cachedMirrorIssueNumber = envIssue;
    return envIssue;
  }

  try {
    const issues = await client.issues.listForRepo({
      owner: getRepoOwner(),
      repo: getRepoName(),
      state: 'open',
      per_page: 30,
    });

    const found = issues.data.find((issue) => issue.title === getMirrorIssueTitle());
    if (found) {
      cachedMirrorIssueNumber = found.number;
      return found.number;
    }
  } catch {
    return null;
  }

  try {
    const created = await client.issues.create({
      owner: getRepoOwner(),
      repo: getRepoName(),
      title: getMirrorIssueTitle(),
      body: [
        'Autonomous runtime status mirror issue.',
        'Do not close. Used by bot for shared state fallback.',
      ].join('\n'),
    });
    cachedMirrorIssueNumber = created.data.number;
    return created.data.number;
  } catch {
    return null;
  }
}

async function readIssueCommentMirror(): Promise<SystemStatusMirrorEnvelope | null> {
  const client = getOctokitClient();
  if (!client) {
    return null;
  }

  const issueNumber = await ensureMirrorIssueNumber(client);
  if (!issueNumber) {
    return null;
  }

  try {
    const comments = await client.issues.listComments({
      owner: getRepoOwner(),
      repo: getRepoName(),
      issue_number: issueNumber,
      per_page: 100,
    });

    for (let i = comments.data.length - 1; i >= 0; i -= 1) {
      const body = String(comments.data[i]?.body || '');
      const decoded = decodeMirrorComment(body);
      if (decoded) {
        return decoded;
      }
    }
  } catch {
    return null;
  }

  return null;
}

async function writeIssueCommentMirror(payload: SystemStatusMirrorEnvelope): Promise<{ written: boolean; reason: string }> {
  const client = getOctokitClient();
  if (!client) {
    return { written: false, reason: 'issue_comment_mirror_disabled' };
  }

  const issueNumber = await ensureMirrorIssueNumber(client);
  if (!issueNumber) {
    return { written: false, reason: 'issue_comment_mirror_issue_unavailable' };
  }

  try {
    await client.issues.createComment({
      owner: getRepoOwner(),
      repo: getRepoName(),
      issue_number: issueNumber,
      body: encodeMirrorComment(payload),
    });
    return { written: true, reason: 'updated_issue_comment' };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { written: false, reason: message };
  }
}

export async function readSystemStatusMirror(): Promise<SystemStatusMirrorEnvelope | null> {
  if (!isMirrorEnabled()) {
    return null;
  }

  const mode = getMirrorMode();
  if (mode === 'issue_comment') {
    return await readIssueCommentMirror();
  }

  try {
    const file = await getFileContent(getMirrorPath());
    if (!file?.content) {
      return null;
    }

    const parsed = JSON.parse(file.content) as Partial<SystemStatusMirrorEnvelope>;
    if (!parsed || typeof parsed !== 'object' || !parsed.data) {
      return null;
    }

    const data = parsed.data as Record<string, unknown>;
    const fingerprint = String(parsed.fingerprint || toFingerprint(data));
    return {
      snapshotAt: safeIsoOrNull(parsed.snapshotAt) || new Date(0).toISOString(),
      source: String(parsed.source || 'unknown'),
      fingerprint,
      data,
    };
  } catch {
    if (mode === 'repo_file') {
      return null;
    }
    return await readIssueCommentMirror();
  }
}

export async function writeSystemStatusMirror(
  data: Record<string, unknown>,
  source: string
): Promise<{ written: boolean; reason: string }> {
  if (!isMirrorEnabled()) {
    return { written: false, reason: 'mirror_disabled' };
  }

  const now = Date.now();
  const minIntervalMs = getMinWriteIntervalSeconds() * 1000;
  const fingerprint = toFingerprint(data);

  if (fingerprint === lastWriteFingerprint) {
    return { written: false, reason: 'same_as_last_runtime_write' };
  }

  if (now - lastWriteAtMs < minIntervalMs) {
    return { written: false, reason: 'throttled_runtime_interval' };
  }

  const existing = await readSystemStatusMirror();
  if (existing?.fingerprint === fingerprint) {
    lastWriteAtMs = now;
    lastWriteFingerprint = fingerprint;
    return { written: false, reason: 'same_as_remote_snapshot' };
  }

  const payload: SystemStatusMirrorEnvelope = {
    snapshotAt: new Date(now).toISOString(),
    source,
    fingerprint,
    data,
  };

  const content = `${JSON.stringify(payload, null, 2)}\n`;
  const commitMessage = `[AUTO] Update runtime system status mirror (${payload.snapshotAt})`;
  const mode = getMirrorMode();

  if (mode === 'issue_comment') {
    const issueResult = await writeIssueCommentMirror(payload);
    if (issueResult.written) {
      lastWriteAtMs = now;
      lastWriteFingerprint = fingerprint;
    }
    return issueResult;
  }

  try {
    await updateFile(getMirrorPath(), content, commitMessage);
    lastWriteAtMs = now;
    lastWriteFingerprint = fingerprint;
    return { written: true, reason: 'updated' };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (mode === 'repo_file') {
      return { written: false, reason: message };
    }

    const issueResult = await writeIssueCommentMirror(payload);
    if (issueResult.written) {
      lastWriteAtMs = now;
      lastWriteFingerprint = fingerprint;
      return issueResult;
    }
    return { written: false, reason: `${message} | ${issueResult.reason}` };
  }
}
