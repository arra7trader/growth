import OpenAI from 'openai';
import tursoClient from './db';
import { executeEvolution, EvolutionProposal } from './github';

const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

let openaiClient: OpenAI | null = null;

export interface MarketData {
  trendingTopics: string[];
  keywords: string[];
  painPoints: string[];
  opportunities: string[];
}

export interface EvolutionDecision {
  action: 'create_content' | 'add_feature' | 'optimize_seo' | 'add_affiliate' | 'fix_bug';
  reasoning: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  expectedImpact: {
    traffic?: number;
    revenue?: number;
    userExperience?: number;
  };
  implementation: EvolutionProposal;
}

interface MetricsSnapshot {
  traffic: number;
  revenue: number;
  activeFeatures: number;
  conversionRate: number;
}

function canUseOpenAI(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

function getOpenAIClient(): OpenAI | null {
  if (!canUseOpenAI()) {
    return null;
  }

  if (!openaiClient) {
    openaiClient = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }

  return openaiClient;
}

function fallbackMarketData(): MarketData {
  return {
    trendingTopics: [
      'crypto bounty opportunities',
      'web3 grant programs',
      'bug bounty security reports',
      'community task rewards',
      'open source contribution rewards',
    ],
    keywords: [
      'crypto bounty no capital',
      'web3 grants open source',
      'blockchain bug bounty reward',
      'defi community campaign',
      'earn usdt online',
    ],
    painPoints: [
      'high competition in bounty applications',
      'unclear reward criteria',
      'slow manual opportunity discovery',
      'difficulty tracking payout status',
      'missed deadlines in grant applications',
    ],
    opportunities: [
      'publish technical submissions for bug bounty programs',
      'build templates to accelerate grant applications',
      'automate discovery of high-scoring bounty posts',
      'prioritize no-capital opportunities with fast payout',
    ],
  };
}

function sanitizeSlug(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

function getProposalType(action: EvolutionDecision['action']): EvolutionProposal['type'] {
  if (action === 'optimize_seo') {
    return 'seo';
  }

  if (action === 'fix_bug') {
    return 'bugfix';
  }

  if (action === 'add_feature') {
    return 'feature';
  }

  if (action === 'add_affiliate') {
    return 'optimization';
  }

  return 'content';
}

function buildFallbackDecision(marketData: MarketData, metrics: MetricsSnapshot): EvolutionDecision {
  const topTopic = marketData.trendingTopics[0] || 'affiliate automation';
  const topKeyword = marketData.keywords[0] || 'automate online business';
  const opportunity = marketData.opportunities[0] || 'expand high-intent content pages';

  let action: EvolutionDecision['action'] = 'create_content';
  let priority: EvolutionDecision['priority'] = 'medium';

  if (metrics.revenue < 25) {
    action = 'create_content';
    priority = 'high';
  } else if (metrics.traffic < 300) {
    action = 'create_content';
    priority = 'high';
  } else if (metrics.conversionRate < 2.5) {
    action = 'optimize_seo';
    priority = 'medium';
  } else {
    action = 'add_feature';
    priority = 'medium';
  }

  const slug = sanitizeSlug(`${topTopic}-${Date.now()}`);
  const proposalType = getProposalType(action);

  return {
    action,
    reasoning: `Crypto no-capital strategy selected "${action}" because traffic=${metrics.traffic}, revenue=${metrics.revenue}, conversionRate=${metrics.conversionRate}.`,
    priority,
    expectedImpact: {
      traffic: action === 'create_content' || action === 'optimize_seo' ? 12 : 6,
      revenue: action === 'add_feature' ? 14 : 8,
      userExperience: 8,
    },
    implementation: {
      type: proposalType,
      title: `Auto plan: ${action} for ${topTopic}`,
      description: `Focus keyword "${topKeyword}". Opportunity: ${opportunity}.`,
      priority,
      files: [
        {
          path: `generated/ideas/${slug}.md`,
          message: `Generate monetization idea for ${topTopic}`,
          content: [
            `# ${topTopic}`,
            '',
            `Action: ${action}`,
            `Priority: ${priority}`,
            `Keyword: ${topKeyword}`,
            `Opportunity: ${opportunity}`,
            '',
            '## Monetization Moves',
            '- Publish comparison content with embedded affiliate links.',
            '- Add one clear conversion CTA above the fold.',
            '- Track click-through rate and iterate weekly.',
          ].join('\n'),
        },
      ],
    },
  };
}

function normalizeModelDecision(
  rawDecision: string | null | undefined,
  fallback: EvolutionDecision
): EvolutionDecision {
  if (!rawDecision) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(rawDecision) as Partial<EvolutionDecision>;

    if (!parsed.action || !parsed.implementation) {
      return fallback;
    }

    return {
      action: parsed.action,
      reasoning: parsed.reasoning || fallback.reasoning,
      priority: parsed.priority || fallback.priority,
      expectedImpact: parsed.expectedImpact || fallback.expectedImpact,
      implementation: {
        type: parsed.implementation.type || fallback.implementation.type,
        title: parsed.implementation.title || fallback.implementation.title,
        description: parsed.implementation.description || fallback.implementation.description,
        files:
          Array.isArray(parsed.implementation.files) && parsed.implementation.files.length > 0
            ? parsed.implementation.files
            : fallback.implementation.files,
        priority: parsed.implementation.priority || fallback.implementation.priority,
      },
    };
  } catch {
    return fallback;
  }
}

export async function scrapeMarketData(): Promise<MarketData> {
  const client = getOpenAIClient();
  const fallback = fallbackMarketData();

  if (!client) {
    await logActivity('market_research', 'Using local market data fallback (OPENAI_API_KEY not set)', fallback);
    return fallback;
  }

  try {
    const prompts = [
      'List top 10 fast-growing topics in SaaS and AI for this month.',
      'List high-intent keywords for autonomous systems and online monetization.',
      'List biggest pain points for online entrepreneurs right now.',
      'List practical opportunities for bootstrapped micro-SaaS growth.',
    ];

    const responses = await Promise.all(
      prompts.map((prompt) =>
        client.chat.completions.create({
          model: OPENAI_MODEL,
          messages: [
            {
              role: 'system',
              content: 'Return concise bullet-like lines, one item per line, no numbering.',
            },
            {
              role: 'user',
              content: prompt,
            },
          ],
          max_tokens: 500,
        })
      )
    );

    const marketData: MarketData = {
      trendingTopics: responses[0].choices[0].message.content?.split('\n').filter((line) => line.trim()) || [],
      keywords: responses[1].choices[0].message.content?.split('\n').filter((line) => line.trim()) || [],
      painPoints: responses[2].choices[0].message.content?.split('\n').filter((line) => line.trim()) || [],
      opportunities: responses[3].choices[0].message.content?.split('\n').filter((line) => line.trim()) || [],
    };

    await logActivity('market_research', 'Completed AI market analysis', marketData);
    return marketData;
  } catch (error) {
    await logActivity('market_research', 'AI market analysis failed, fallback to local data', {
      error: String(error),
    });
    return fallback;
  }
}

export async function makeEvolutionDecision(marketData: MarketData): Promise<EvolutionDecision> {
  const metrics = await getCurrentMetrics();
  const fallback = buildFallbackDecision(marketData, metrics);
  const client = getOpenAIClient();

  if (!client) {
    await logActivity('decision', 'Using local decision engine (OPENAI_API_KEY not set)', fallback);
    return fallback;
  }

  try {
    const prompt = `
      Market data:
      - Topics: ${marketData.trendingTopics.join(', ')}
      - Keywords: ${marketData.keywords.join(', ')}
      - Pain points: ${marketData.painPoints.join(', ')}
      - Opportunities: ${marketData.opportunities.join(', ')}

      Metrics:
      - Traffic: ${metrics.traffic}
      - Revenue: ${metrics.revenue}
      - Active features: ${metrics.activeFeatures}
      - Conversion rate: ${metrics.conversionRate}

      Objective: no-capital crypto revenue growth (bounty/grant/quest pipeline), avoid affiliate-first tactics.
      Pick one action: create_content, add_feature, optimize_seo, fix_bug.
      Return valid JSON matching EvolutionDecision including implementation fields.
    `;

    const response = await client.chat.completions.create({
      model: OPENAI_MODEL,
      messages: [
        {
          role: 'system',
          content:
            'You are a crypto growth engineer. Focus on no-capital opportunities (bounties, grants, quests) and practical execution.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      max_tokens: 1500,
      response_format: { type: 'json_object' },
    });

    const normalized = normalizeModelDecision(response.choices[0].message.content, fallback);
    await logActivity('decision', 'Made evolution decision with AI model', normalized);
    return normalized;
  } catch (error) {
    await logActivity('decision', 'AI decision failed, using local strategy', {
      error: String(error),
      fallbackDecision: fallback,
    });
    return fallback;
  }
}

export async function executeEvolutionDecision(decision: EvolutionDecision): Promise<{
  success: boolean;
  commitSha?: string;
  url?: string;
  error?: string;
}> {
  try {
    await logActivity('execution', 'Starting evolution execution', decision);
    const result = await executeEvolution(decision.implementation);

    if (result.success) {
      await logActivity('success', 'Evolution executed successfully', result);
    } else {
      await logActivity('error', 'Evolution execution failed', result);
    }

    return result;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    await logActivity('error', 'Evolution execution failed', { error: message });
    return {
      success: false,
      error: message,
    };
  }
}

async function getCurrentMetrics(): Promise<MetricsSnapshot> {
  try {
    const trafficResult = await tursoClient.execute({
      sql: 'SELECT AVG(value) as avg_traffic FROM growth_metrics WHERE metric_type = "traffic" AND created_at > datetime("now", "-7 days")',
      args: [],
    });

    const revenueResult = await tursoClient.execute({
      sql: 'SELECT SUM(value) as total_revenue FROM growth_metrics WHERE metric_type = "revenue" AND created_at > datetime("now", "-7 days")',
      args: [],
    });

    const featuresResult = await tursoClient.execute({
      sql: 'SELECT COUNT(*) as feature_count FROM dynamic_content WHERE content_type IN ("feature", "locked_feature") AND is_active = 1',
      args: [],
    });

    const ctrResult = await tursoClient.execute({
      sql: 'SELECT AVG(value) as avg_ctr FROM growth_metrics WHERE metric_type = "ctr" AND created_at > datetime("now", "-7 days")',
      args: [],
    });

    return {
      traffic: Math.round(Number(trafficResult.rows[0]?.avg_traffic) || 0),
      revenue: Math.round(Number(revenueResult.rows[0]?.total_revenue) || 0),
      activeFeatures: Number(featuresResult.rows[0]?.feature_count) || 0,
      conversionRate: Number(ctrResult.rows[0]?.avg_ctr) ? Number(ctrResult.rows[0]?.avg_ctr) * 100 : 0,
    };
  } catch (error) {
    await logActivity('warn', 'Failed to read metrics, using safe zero defaults', { error: String(error) });
    return {
      traffic: 0,
      revenue: 0,
      activeFeatures: 0,
      conversionRate: 0,
    };
  }
}

async function logActivity(type: string, message: string, context: unknown) {
  try {
    await tursoClient.execute({
      sql: `
        INSERT INTO logs (level, message, context)
        VALUES (?, ?, ?)
      `,
      args: [type, message, JSON.stringify(context)],
    });
  } catch (error) {
    console.error('Failed to log activity:', error);
  }
}

async function aggregateTrackingMetrics() {
  const [viewsResult, affiliateClicksResult, affiliateSalesResult, saasSalesResult] = await Promise.all([
    tursoClient.execute({
      sql: `
        SELECT COALESCE(COUNT(*), 0) AS value
        FROM tracking_events
        WHERE event_type = 'page_view'
          AND created_at >= datetime('now', '-1 day')
      `,
      args: [],
    }),
    tursoClient.execute({
      sql: `
        SELECT COALESCE(COUNT(*), 0) AS value
        FROM tracking_events
        WHERE event_type = 'affiliate_click'
          AND created_at >= datetime('now', '-1 day')
      `,
      args: [],
    }),
    tursoClient.execute({
      sql: `
        SELECT COALESCE(SUM(value), 0) AS value
        FROM tracking_events
        WHERE event_type = 'affiliate_sale'
          AND created_at >= datetime('now', '-1 day')
      `,
      args: [],
    }),
    tursoClient.execute({
      sql: `
        SELECT COALESCE(SUM(value), 0) AS value
        FROM tracking_events
        WHERE event_type = 'saas_sale'
          AND created_at >= datetime('now', '-1 day')
      `,
      args: [],
    }),
  ]);

  const visitors = Number(viewsResult.rows[0]?.value) || 0;
  const affiliateClicks = Number(affiliateClicksResult.rows[0]?.value) || 0;
  const affiliateRevenue = Number(affiliateSalesResult.rows[0]?.value) || 0;
  const saasRevenue = Number(saasSalesResult.rows[0]?.value) || 0;
  const totalRevenue = Number((affiliateRevenue + saasRevenue).toFixed(2));
  const ctr = visitors > 0 ? Number((affiliateClicks / visitors).toFixed(6)) : 0;

  return {
    visitors,
    ctr,
    affiliateRevenue: Number(affiliateRevenue.toFixed(2)),
    saasRevenue: Number(saasRevenue.toFixed(2)),
    totalRevenue,
  };
}

async function updateGrowthMetrics(decision: EvolutionDecision) {
  try {
    const metrics = await aggregateTrackingMetrics();

    await tursoClient.execute({
      sql: `
        INSERT INTO growth_metrics (metric_type, metric_name, value, unit, metadata)
        VALUES ('traffic', 'daily_visitors', ?, 'visitors', ?)
      `,
      args: [metrics.visitors, JSON.stringify({ source: 'tracking_events', action: decision.action, realData: true })],
    });

    await tursoClient.execute({
      sql: `
        INSERT INTO growth_metrics (metric_type, metric_name, value, unit, metadata)
        VALUES ('ctr', 'affiliate_ctr', ?, 'ratio', ?)
      `,
      args: [metrics.ctr, JSON.stringify({ source: 'tracking_events', action: decision.action, realData: true })],
    });

    await tursoClient.execute({
      sql: `
        INSERT INTO growth_metrics (metric_type, metric_name, value, unit, metadata)
        VALUES ('affiliate_revenue', 'daily_affiliate_revenue', ?, 'USD', ?)
      `,
      args: [metrics.affiliateRevenue, JSON.stringify({ source: 'tracking_events', realData: true })],
    });

    await tursoClient.execute({
      sql: `
        INSERT INTO growth_metrics (metric_type, metric_name, value, unit, metadata)
        VALUES ('saas_revenue', 'daily_saas_revenue', ?, 'USD', ?)
      `,
      args: [metrics.saasRevenue, JSON.stringify({ source: 'tracking_events', realData: true })],
    });

    await tursoClient.execute({
      sql: `
        INSERT INTO growth_metrics (metric_type, metric_name, value, unit, metadata)
        VALUES ('revenue', 'daily_revenue', ?, 'USD', ?)
      `,
      args: [metrics.totalRevenue, JSON.stringify({ source: 'tracking_events', realData: true })],
    });
  } catch (error) {
    console.error('Failed to update metrics:', error);
  }
}

export async function runEvolutionCycle() {
  console.log('Starting evolution cycle...');

  try {
    console.log('Phase 1: market research');
    const marketData = await scrapeMarketData();

    console.log('Phase 2: decision making');
    const decision = await makeEvolutionDecision(marketData);

    console.log('Phase 3: execution');
    const result = await executeEvolutionDecision(decision);

    console.log('Phase 4: metrics update');
    await updateGrowthMetrics(decision);

    console.log('Evolution cycle complete');
    return result;
  } catch (error) {
    console.error('Evolution cycle failed:', error);
    await logActivity('error', 'Evolution cycle failed', { error: String(error) });
    throw error;
  }
}

export default {
  scrapeMarketData,
  makeEvolutionDecision,
  executeEvolutionDecision,
  runEvolutionCycle,
};
