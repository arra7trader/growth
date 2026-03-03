import OpenAI from 'openai';
import tursoClient from './db';
import { executeEvolution, EvolutionProposal } from './github';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

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

/**
 * Scrape trending topics from various sources
 */
export async function scrapeMarketData(): Promise<MarketData> {
  try {
    // Simulate market research (in production, use actual APIs)
    const prompts = [
      "What are the top 10 trending topics in SaaS and AI right now?",
      "What are the most searched keywords related to autonomous systems and passive income?",
      "What are the biggest pain points for online entrepreneurs in 2026?",
      "What are the best untapped opportunities for micro-SaaS products?",
    ];

    const responses = await Promise.all(
      prompts.map((prompt) =>
        openai.chat.completions.create({
          model: 'gpt-4-turbo-preview',
          messages: [
            {
              role: 'system',
              content: 'You are a market research expert. Provide concise, actionable insights.',
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

    // Log market research
    await logActivity('market_research', 'Completed market analysis', marketData);

    return marketData;
  } catch (error) {
    console.error('Market research failed:', error);
    await logActivity('error', 'Market research failed', { error: String(error) });
    throw error;
  }
}

/**
 * Analyze data and make evolution decisions
 */
export async function makeEvolutionDecision(marketData: MarketData): Promise<EvolutionDecision> {
  try {
    // Get current performance metrics
    const metrics = await getCurrentMetrics();

    const prompt = `
      Based on the following market data and current performance metrics, decide the next evolution action:

      MARKET DATA:
      - Trending Topics: ${marketData.trendingTopics.join(', ')}
      - Keywords: ${marketData.keywords.join(', ')}
      - Pain Points: ${marketData.painPoints.join(', ')}
      - Opportunities: ${marketData.opportunities.join(', ')}

      CURRENT METRICS:
      - Traffic: ${metrics.traffic} visitors/day
      - Revenue: $${metrics.revenue}/day
      - Active Features: ${metrics.activeFeatures}
      - Conversion Rate: ${metrics.conversionRate}%

      Decide the BEST action to maximize profit and growth. Choose from:
      1. create_content - Create new blog post or landing page
      2. add_feature - Add a new micro-SaaS feature
      3. optimize_seo - Improve SEO metadata and structure
      4. add_affiliate - Add affiliate links to existing content
      5. fix_bug - Fix identified bugs or issues

      Provide a detailed implementation plan including specific code changes needed.
    `;

    const response = await openai.chat.completions.create({
      model: 'gpt-4-turbo-preview',
      messages: [
        {
          role: 'system',
          content: `You are an autonomous AI agent responsible for evolving a web application to maximize profit.
          You have the ability to modify code via GitHub API. Make strategic decisions based on data.
          Always provide specific, implementable code changes.`,
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      max_tokens: 2000,
      response_format: { type: 'json_object' },
    });

    const decision = JSON.parse(response.choices[0].message.content || '{}') as EvolutionDecision;

    // Log decision
    await logActivity('decision', 'Made evolution decision', decision);

    return decision;
  } catch (error) {
    console.error('Decision making failed:', error);
    await logActivity('error', 'Decision making failed', { error: String(error) });
    throw error;
  }
}

/**
 * Execute the evolution decision
 */
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
  } catch (error: any) {
    await logActivity('error', 'Evolution execution failed', { error: error.message });
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Get current performance metrics
 */
async function getCurrentMetrics() {
  try {
    const trafficResult = await tursoClient.execute({
      sql: 'SELECT AVG(value) as avg_traffic FROM growth_metrics WHERE metric_type = "traffic" AND created_at > datetime("now", "-7 days")',
    });

    const revenueResult = await tursoClient.execute({
      sql: 'SELECT SUM(value) as total_revenue FROM growth_metrics WHERE metric_type = "revenue" AND created_at > datetime("now", "-7 days")',
    });

    const featuresResult = await tursoClient.execute({
      sql: 'SELECT COUNT(*) as feature_count FROM dynamic_content WHERE content_type = "feature" AND is_active = 1',
    });

    return {
      traffic: Math.round(trafficResult.rows[0]?.avg_traffic || 100),
      revenue: Math.round(revenueResult.rows[0]?.total_revenue || 0),
      activeFeatures: featuresResult.rows[0]?.feature_count || 1,
      conversionRate: 2.5, // Default placeholder
    };
  } catch (error) {
    console.error('Failed to get metrics:', error);
    return {
      traffic: 100,
      revenue: 0,
      activeFeatures: 1,
      conversionRate: 2.5,
    };
  }
}

/**
 * Log activity to database
 */
async function logActivity(type: string, message: string, context: any) {
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

/**
 * Main evolution cycle - runs every 24 hours
 */
export async function runEvolutionCycle() {
  console.log('🚀 Starting Evolution Cycle...');
  
  try {
    // Phase 1: Market Research
    console.log('📊 Phase 1: Market Research');
    const marketData = await scrapeMarketData();

    // Phase 2: Decision Making
    console.log('🧠 Phase 2: Decision Making');
    const decision = await makeEvolutionDecision(marketData);

    // Phase 3: Execution
    console.log('⚡ Phase 3: Execution');
    const result = await executeEvolutionDecision(decision);

    // Phase 4: Metrics Update
    console.log('📈 Phase 4: Updating Metrics');
    await updateGrowthMetrics();

    console.log('✅ Evolution Cycle Complete');
    return result;
  } catch (error) {
    console.error('❌ Evolution Cycle Failed:', error);
    await logActivity('error', 'Evolution cycle failed', { error: String(error) });
    throw error;
  }
}

/**
 * Update growth metrics
 */
async function updateGrowthMetrics() {
  try {
    // Simulate metrics update (in production, use real analytics)
    await tursoClient.execute({
      sql: `
        INSERT INTO growth_metrics (metric_type, metric_name, value, unit)
        VALUES ('traffic', 'daily_visitors', ?, 'visitors')
      `,
      args: [Math.floor(Math.random() * 500) + 100],
    });

    await tursoClient.execute({
      sql: `
        INSERT INTO growth_metrics (metric_type, metric_name, value, unit)
        VALUES ('revenue', 'daily_revenue', ?, 'USD')
      `,
      args: [Math.random() * 100],
    });
  } catch (error) {
    console.error('Failed to update metrics:', error);
  }
}

export default {
  scrapeMarketData,
  makeEvolutionDecision,
  executeEvolutionDecision,
  runEvolutionCycle,
};
