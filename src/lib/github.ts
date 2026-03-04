import { Octokit } from '@octokit/rest';
import tursoClient from './db';
import { getGithubToken } from './github-auth';

const GITHUB_TOKEN = getGithubToken();
const GITHUB_OWNER = process.env.GITHUB_OWNER || 'arra7trader';
const GITHUB_REPO = process.env.GITHUB_REPO || 'growth';

const octokit = GITHUB_TOKEN ? new Octokit({ auth: GITHUB_TOKEN }) : null;

export interface FileChange {
  path: string;
  content: string;
  message: string;
}

export interface EvolutionProposal {
  type: 'feature' | 'bugfix' | 'optimization' | 'content' | 'seo';
  title: string;
  description: string;
  files: FileChange[];
  priority: 'low' | 'medium' | 'high' | 'critical';
}

function getOctokit(): Octokit {
  if (!octokit) {
    throw new Error('GitHub token not configured. Set GITHUB_TOKEN for direct repository updates.');
  }

  return octokit;
}

function shouldUseLocalExecution(): boolean {
  return !GITHUB_TOKEN;
}

export async function getFileContent(filePath: string): Promise<{ content: string; sha: string } | null> {
  const client = getOctokit();

  try {
    const response = await client.repos.getContent({
      owner: GITHUB_OWNER,
      repo: GITHUB_REPO,
      path: filePath,
    });

    if ('content' in response.data) {
      const content = Buffer.from(response.data.content, 'base64').toString('utf-8');
      return { content, sha: response.data.sha };
    }

    return null;
  } catch (error: unknown) {
    if (typeof error === 'object' && error && 'status' in error && (error as { status?: number }).status === 404) {
      return null;
    }

    throw error;
  }
}

export async function updateFile(filePath: string, content: string, message: string): Promise<{ commitSha: string; url: string }> {
  const client = getOctokit();

  try {
    const existingFile = await getFileContent(filePath);

    const response = await client.repos.createOrUpdateFileContents({
      owner: GITHUB_OWNER,
      repo: GITHUB_REPO,
      path: filePath,
      message,
      content: Buffer.from(content).toString('base64'),
      sha: existingFile?.sha,
      branch: 'main',
    });

    return {
      commitSha: response.data.commit.sha || '',
      url: response.data.commit.html_url || '',
    };
  } catch (error) {
    console.error('Failed to update file:', error);
    throw error;
  }
}

export async function commitChanges(changes: FileChange[], commitMessage: string): Promise<{ commitSha: string; url: string }> {
  const client = getOctokit();

  try {
    const currentCommit = await client.repos.getBranch({
      owner: GITHUB_OWNER,
      repo: GITHUB_REPO,
      branch: 'main',
    });

    const blobs = await Promise.all(
      changes.map(async (change) => {
        const blob = await client.git.createBlob({
          owner: GITHUB_OWNER,
          repo: GITHUB_REPO,
          content: change.content,
          encoding: 'utf-8',
        });
        return { path: change.path, sha: blob.data.sha };
      })
    );

    const currentTree = await client.git.getTree({
      owner: GITHUB_OWNER,
      repo: GITHUB_REPO,
      tree_sha: (currentCommit.data.commit as { tree?: { sha?: string } }).tree?.sha || '',
    });

    const tree = blobs.map((blob) => ({
      path: blob.path,
      mode: '100644' as const,
      type: 'blob' as const,
      sha: blob.sha,
    }));

    const newTree = await client.git.createTree({
      owner: GITHUB_OWNER,
      repo: GITHUB_REPO,
      tree,
      base_tree: currentTree.data.sha,
    });

    const newCommit = await client.git.createCommit({
      owner: GITHUB_OWNER,
      repo: GITHUB_REPO,
      message: commitMessage,
      tree: newTree.data.sha,
      parents: [currentCommit.data.commit.sha],
    });

    await client.git.updateRef({
      owner: GITHUB_OWNER,
      repo: GITHUB_REPO,
      ref: 'heads/main',
      sha: newCommit.data.sha,
    });

    return {
      commitSha: newCommit.data.sha,
      url: `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/commit/${newCommit.data.sha}`,
    };
  } catch (error) {
    console.error('Failed to commit changes:', error);
    throw error;
  }
}

export async function createPullRequest(
  branch: string,
  title: string,
  body: string
): Promise<{ prNumber: number; url: string }> {
  const client = getOctokit();

  try {
    const response = await client.pulls.create({
      owner: GITHUB_OWNER,
      repo: GITHUB_REPO,
      title,
      body,
      head: branch,
      base: 'main',
    });

    return {
      prNumber: response.data.number,
      url: response.data.html_url,
    };
  } catch (error) {
    console.error('Failed to create pull request:', error);
    throw error;
  }
}

async function logEvolution(
  proposal: EvolutionProposal,
  implementationStatus: string,
  commitSha?: string
) {
  try {
    await tursoClient.execute({
      sql: `
        INSERT INTO evolution_history (
          cycle_number,
          decision_type,
          decision_data,
          implementation_status,
          github_commit_hash
        ) VALUES (?, ?, ?, ?, ?)
      `,
      args: [Date.now(), proposal.type, JSON.stringify(proposal), implementationStatus, commitSha ?? null],
    });
  } catch (error) {
    console.error('Failed to log evolution:', error);
  }
}

async function storeLocalGeneratedContent(proposal: EvolutionProposal) {
  try {
    await tursoClient.execute({
      sql: `
        INSERT INTO dynamic_content (
          content_type,
          content_key,
          content_data,
          metadata
        ) VALUES (?, ?, ?, ?)
      `,
      args: [
        'evolution_record',
        `evolution_record_${Date.now()}`,
        JSON.stringify({
          title: proposal.title,
          description: proposal.description,
          files: proposal.files,
        }),
        JSON.stringify({
          mode: 'local_execution',
          priority: proposal.priority,
          generatedAt: new Date().toISOString(),
        }),
      ],
    });
  } catch (error) {
    console.error('Failed to store local generated content:', error);
  }
}

export async function executeEvolution(proposal: EvolutionProposal): Promise<{
  success: boolean;
  commitSha?: string;
  url?: string;
  error?: string;
}> {
  const timestamp = new Date().toISOString();
  const allowNetworkFallback = String(process.env.AETHER_GITHUB_EXECUTION_FALLBACK || 'true').toLowerCase() !== 'false';

  if (shouldUseLocalExecution()) {
    await storeLocalGeneratedContent(proposal);
    await logEvolution(proposal, 'local_recorded');

    return {
      success: true,
      url: `internal://evolution/${timestamp}`,
    };
  }

  try {
    const commitMessage = `[AUTO] ${proposal.type}: ${proposal.title}\n\n${proposal.description}\n\nGenerated by Aether Autonomous System at ${timestamp}`;
    const result = await commitChanges(proposal.files, commitMessage);

    await logEvolution(proposal, 'implemented', result.commitSha);

    return {
      success: true,
      commitSha: result.commitSha,
      url: result.url,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (allowNetworkFallback) {
      await storeLocalGeneratedContent(proposal);
      await logEvolution(proposal, 'degraded_local_fallback');

      return {
        success: true,
        url: `internal://evolution-fallback/${timestamp}`,
        error: `github_commit_failed: ${message}`,
      };
    }

    await logEvolution(proposal, 'failed');

    return {
      success: false,
      error: message,
    };
  }
}

export default {
  getFileContent,
  updateFile,
  commitChanges,
  createPullRequest,
  executeEvolution,
};
