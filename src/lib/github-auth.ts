export function getGithubToken(): string | null {
  const raw = String(process.env.GITHUB_TOKEN || '');
  if (!raw) {
    return null;
  }

  let token = raw.trim();

  // Tolerate accidental wrapping quotes from env editors.
  if (
    (token.startsWith('"') && token.endsWith('"')) ||
    (token.startsWith("'") && token.endsWith("'"))
  ) {
    token = token.slice(1, -1).trim();
  }

  // Remove accidental trailing CR/LF.
  token = token.replace(/[\r\n]+/g, '').trim();

  return token || null;
}

export function hasGithubToken(): boolean {
  return Boolean(getGithubToken());
}

