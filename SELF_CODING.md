# Self-Coding Logic Documentation

## Overview

The Self-Coding feature is the core innovation of Aether Auto-SaaS. It allows the system to autonomously modify its own codebase through the GitHub API, enabling true autonomous evolution.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    SELF-CODING PIPELINE                      │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌─────────────┐     ┌─────────────┐     ┌──────────────┐  │
│  │  AI Brain   │────▶│  Proposal   │────▶│  GitHub API  │  │
│  │  (OpenAI)   │     │  Generator  │     │  (Octokit)   │  │
│  └─────────────┘     └─────────────┘     └──────────────┘  │
│         │                   │                    │           │
│         │                   │                    ▼           │
│         │                   │          ┌──────────────┐     │
│         │                   │          │   Commit &   │     │
│         │                   │          │    Push      │     │
│         │                   │          └──────────────┘     │
│         │                   │                    │           │
│         ▼                   ▼                    ▼           │
│  ┌─────────────┐     ┌─────────────┐     ┌──────────────┐  │
│  │  Market     │     │  Evolution  │     │   Repository │  │
│  │  Research   │     │  Decision   │     │    Updated   │  │
│  └─────────────┘     └─────────────┘     └──────────────┘  │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

## Step-by-Step Process

### Step 1: Market Research

**File**: `src/lib/brain.ts` - `scrapeMarketData()`

The AI researches market trends using OpenAI's API:

```typescript
export async function scrapeMarketData(): Promise<MarketData> {
  const prompts = [
    "What are the top 10 trending topics in SaaS and AI right now?",
    "What are the most searched keywords related to autonomous systems?",
    "What are the biggest pain points for online entrepreneurs in 2026?",
    "What are the best untapped opportunities for micro-SaaS products?",
  ];

  // Query OpenAI for each research question
  const responses = await Promise.all(
    prompts.map((prompt) =>
      openai.chat.completions.create({
        model: 'gpt-4-turbo-preview',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 500,
      })
    )
  );

  // Compile market data
  return {
    trendingTopics: responses[0].choices[0].message.content?.split('\n'),
    keywords: responses[1].choices[0].message.content?.split('\n'),
    painPoints: responses[2].choices[0].message.content?.split('\n'),
    opportunities: responses[3].choices[0].message.content?.split('\n'),
  };
}
```

**Output**:
```json
{
  "trendingTopics": [
    "AI-powered automation",
    "Passive income systems",
    "Crypto payment integration"
  ],
  "keywords": ["autonomous saas", "ai trading", "passive income"],
  "painPoints": ["lack of time", "technical complexity", "high costs"],
  "opportunities": ["micro-saaS for traders", "ai content generation"]
}
```

### Step 2: Evolution Decision

**File**: `src/lib/brain.ts` - `makeEvolutionDecision()`

The AI analyzes market data and decides what action to take:

```typescript
export async function makeEvolutionDecision(
  marketData: MarketData
): Promise<EvolutionDecision> {
  const prompt = `
    Based on the following market data and current performance metrics,
    decide the next evolution action:

    MARKET DATA:
    - Trending Topics: ${marketData.trendingTopics.join(', ')}
    - Keywords: ${marketData.keywords.join(', ')}
    - Pain Points: ${marketData.painPoints.join(', ')}
    - Opportunities: ${marketData.opportunities.join(', ')}

    CURRENT METRICS:
    - Traffic: ${metrics.traffic} visitors/day
    - Revenue: $${metrics.revenue}/day

    Decide the BEST action from:
    1. create_content - Create new blog post or landing page
    2. add_feature - Add a new micro-SaaS feature
    3. optimize_seo - Improve SEO metadata and structure
    4. add_affiliate - Add affiliate links to existing content
    5. fix_bug - Fix identified bugs or issues

    Provide a detailed implementation plan including specific code changes.
  `;

  const response = await openai.chat.completions.create({
    model: 'gpt-4-turbo-preview',
    messages: [
      {
        role: 'system',
        content: `You are an autonomous AI agent responsible for evolving
        a web application to maximize profit. You have the ability to modify
        code via GitHub API. Make strategic decisions based on data.`,
      },
      { role: 'user', content: prompt },
    ],
    max_tokens: 2000,
    response_format: { type: 'json_object' },
  });

  return JSON.parse(response.choices[0].message.content || '{}');
}
```

**Output Example**:
```json
{
  "action": "add_feature",
  "reasoning": "Crypto payment integration is trending and aligns with our audience",
  "priority": "high",
  "expectedImpact": {
    "traffic": 150,
    "revenue": 500,
    "userExperience": 8
  },
  "implementation": {
    "type": "feature",
    "title": "Add Crypto Payment Gateway",
    "description": "Implement Coinbase Commerce integration",
    "files": [
      {
        "path": "src/app/api/payment/crypto/route.ts",
        "content": "import { NextRequest, NextResponse } from 'next/server';\n\nexport async function POST(request: NextRequest) {\n  // ... generated code ...\n}",
        "message": "Add crypto payment endpoint"
      },
      {
        "path": "src/components/CryptoPayment.tsx",
        "content": "'use client';\n\nexport default function CryptoPayment() {\n  // ... generated code ...\n}",
        "message": "Add crypto payment UI component"
      }
    ]
  }
}
```

### Step 3: Code Execution via GitHub API

**File**: `src/lib/github.ts` - `executeEvolution()`

The system commits the AI-generated code to GitHub:

```typescript
export async function executeEvolution(
  proposal: EvolutionProposal
): Promise<{ success: boolean; commitSha?: string; url?: string }> {
  const timestamp = new Date().toISOString();
  const commitMessage = `[AUTO] ${proposal.type}: ${proposal.title}\n\n${proposal.description}\n\nGenerated by Aether Autonomous System at ${timestamp}`;

  // Apply all file changes using GitHub Git Data API
  const result = await commitChanges(proposal.files, commitMessage);

  // Log the evolution to database
  await logEvolution(proposal, result.commitSha);

  return {
    success: true,
    commitSha: result.commitSha,
    url: result.url,
  };
}
```

### Step 4: Multi-File Commit Process

**File**: `src/lib/github.ts` - `commitChanges()`

The system uses GitHub's Git Data API to commit multiple files:

```typescript
export async function commitChanges(
  changes: FileChange[],
  commitMessage: string
): Promise<{ commitSha: string; url: string }> {
  // 1. Get current commit
  const currentCommit = await octokit.repos.getBranch({
    owner: GITHUB_OWNER,
    repo: GITHUB_REPO,
    branch: 'main',
  });

  // 2. Create blobs for each file
  const blobs = await Promise.all(
    changes.map(async (change) => {
      const blob = await octokit.git.createBlob({
        owner: GITHUB_OWNER,
        repo: GITHUB_REPO,
        content: change.content,
        encoding: 'utf-8',
      });
      return { path: change.path, sha: blob.data.sha };
    })
  );

  // 3. Get current tree
  const currentTree = await octokit.git.getTree({
    owner: GITHUB_OWNER,
    repo: GITHUB_REPO,
    tree_sha: currentCommit.data.commit.tree.sha,
  });

  // 4. Create new tree with updated files
  const tree = blobs.map((blob) => ({
    path: blob.path,
    mode: '100644' as const,
    type: 'blob' as const,
    sha: blob.sha,
  }));

  const newTree = await octokit.git.createTree({
    owner: GITHUB_OWNER,
    repo: GITHUB_REPO,
    tree,
    base_tree: currentTree.data.sha,
  });

  // 5. Create new commit
  const newCommit = await octokit.git.createCommit({
    owner: GITHUB_OWNER,
    repo: GITHUB_REPO,
    message: commitMessage,
    tree: newTree.data.sha,
    parents: [currentCommit.data.commit.sha],
  });

  // 6. Update branch reference
  await octokit.git.updateRef({
    owner: GITHUB_OWNER,
    repo: GITHUB_REPO,
    ref: 'heads/main',
    sha: newCommit.data.sha,
  });

  return {
    commitSha: newCommit.data.sha,
    url: `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/commit/${newCommit.data.sha}`,
  };
}
```

## Evolution Cycle Flow

```
┌──────────────────────────────────────────────────────────┐
│                   24-Hour Evolution Cycle                 │
├──────────────────────────────────────────────────────────┤
│                                                           │
│  00:00 UTC ──▶ Trigger Evolution Cycle                    │
│       │                                                   │
│       ▼                                                   │
│  ┌─────────────────┐                                     │
│  │ Phase 1:        │                                     │
│  │ Market Research │                                     │
│  └─────────────────┘                                     │
│       │                                                   │
│       ▼                                                   │
│  ┌─────────────────┐                                     │
│  │ Phase 2:        │                                     │
│  │ AI Decision     │                                     │
│  └─────────────────┘                                     │
│       │                                                   │
│       ▼                                                   │
│  ┌─────────────────┐                                     │
│  │ Phase 3:        │                                     │
│  │ Code Generation │                                     │
│  └─────────────────┘                                     │
│       │                                                   │
│       ▼                                                   │
│  ┌─────────────────┐                                     │
│  │ Phase 4:        │                                     │
│  │ GitHub Commit   │                                     │
│  └─────────────────┘                                     │
│       │                                                   │
│       ▼                                                   │
│  ┌─────────────────┐                                     │
│  │ Phase 5:        │                                     │
│  │ Vercel Deploy   │ (Automatic via GitHub integration)  │
│  └─────────────────┘                                     │
│                                                           │
│  Cycle Complete ──▶ Log Results & Wait 24 Hours          │
│                                                           │
└──────────────────────────────────────────────────────────┘
```

## Example Self-Coding Scenarios

### Scenario 1: Adding a New Feature

**Trigger**: AI detects trending demand for "AI trading signals"

**Decision**: Add a trading signals feature

**Files Created**:
```
src/app/api/signals/route.ts       - API endpoint for signals
src/components/TradingSignals.tsx  - UI component
src/lib/signals.ts                 - Signal generation logic
```

**Commit Message**:
```
[AUTO] feature: Add AI Trading Signals

Implement real-time trading signals powered by AI analysis.

Generated by Aether Autonomous System at 2026-03-04T00:00:00Z
```

### Scenario 2: SEO Optimization

**Trigger**: AI identifies low-ranking keywords

**Decision**: Optimize SEO metadata

**Files Modified**:
```
src/app/page.tsx          - Update meta tags
src/app/layout.tsx        - Add structured data
src/app/sitemap.ts        - Generate sitemap
```

### Scenario 3: Affiliate Integration

**Trigger**: High-converting keyword detected

**Decision**: Add affiliate links

**Files Modified**:
```
src/lib/monetization.ts   - Add new affiliate opportunities
src/components/Content.tsx - Insert affiliate links
```

## Security & Safety

### GitHub Token Permissions

The GitHub Personal Access Token requires:
- `repo` - Full control of private repositories (for creating commits)
- `workflow` - Update GitHub Action workflows (optional)

**Recommended**: Create a dedicated token with minimal scope.

### Change Validation

Before committing changes, the system:
1. Validates code syntax (TypeScript compilation)
2. Checks for breaking changes
3. Logs all changes to database
4. Creates traceable commit history

### Rollback Strategy

If a self-coded change causes issues:
1. Manual rollback via GitHub revert
2. AI detects errors in next cycle
3. Auto-fix proposal generated
4. Corrective commit applied

## Monitoring & Logging

All self-coding activities are logged:

```sql
-- View evolution history
SELECT * FROM evolution_history ORDER BY created_at DESC;

-- View recent AI decisions
SELECT * FROM logs WHERE level = 'decision' ORDER BY created_at DESC;

-- View successful commits
SELECT * FROM evolution_history 
WHERE implementation_status = 'implemented';
```

## API Reference

### EvolutionProposal Interface

```typescript
interface EvolutionProposal {
  type: 'feature' | 'bugfix' | 'optimization' | 'content' | 'seo';
  title: string;
  description: string;
  files: FileChange[];
  priority: 'low' | 'medium' | 'high' | 'critical';
}
```

### FileChange Interface

```typescript
interface FileChange {
  path: string;
  content: string;
  message: string;
}
```

### Execute Evolution Response

```typescript
{
  success: boolean;
  commitSha?: string;
  url?: string;
  error?: string;
}
```

## Troubleshooting

### Issue: GitHub API Rate Limit

**Solution**: 
- Use authenticated requests (GITHUB_TOKEN)
- Rate limit: 5000 requests/hour for authenticated users
- Implement exponential backoff

### Issue: Commit Conflicts

**Solution**:
- System fetches latest commit before each change
- Sequential commit processing
- Conflict detection and retry logic

### Issue: Invalid Code Generation

**Solution**:
- TypeScript compilation catches syntax errors
- AI learns from failed generations
- Human review option for critical changes

## Future Enhancements

- [ ] Pull Request workflow (human review before merge)
- [ ] A/B testing for self-coded features
- [ ] Rollback automation
- [ ] Multi-branch development
- [ ] Integration with CI/CD pipelines
- [ ] Code quality scoring
- [ ] Impact prediction before implementation

---

**This self-coding system represents the next evolution of autonomous software development.**

*For technical support, visit: https://github.com/arra7trader/growth/issues*
