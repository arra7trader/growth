import { createHash } from 'node:crypto';
import { getFileContent, updateFile } from './github';

const DEFAULT_MIRROR_PATH = 'generated/runtime/system-status-mirror.json';
const DEFAULT_MIRROR_MIN_WRITE_INTERVAL_SECONDS = 180;

let lastWriteAtMs = 0;
let lastWriteFingerprint = '';

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

export async function readSystemStatusMirror(): Promise<SystemStatusMirrorEnvelope | null> {
  if (!isMirrorEnabled()) {
    return null;
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
    return null;
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

  try {
    await updateFile(getMirrorPath(), content, commitMessage);
    lastWriteAtMs = now;
    lastWriteFingerprint = fingerprint;
    return { written: true, reason: 'updated' };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { written: false, reason: message };
  }
}

