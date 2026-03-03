import tursoClient from './db';

export interface AffiliateLink {
  id: number;
  keyword: string;
  affiliateUrl: string;
  conversionRate: number;
  clicks: number;
  revenue: number;
  isActive: boolean;
}

export interface MonetizationConfig {
  minPayout: number;
  cryptoEnabled: boolean;
  stripeEnabled: boolean;
  adPlacementStrategy: 'conservative' | 'balanced' | 'aggressive';
}

/**
 * Find and insert relevant affiliate links based on content
 */
export async function findAffiliateOpportunities(content: string): Promise<AffiliateLink[]> {
  try {
    // Get active affiliate links from database
    const result = await tursoClient.execute({
      sql: 'SELECT * FROM affiliate_links WHERE is_active = 1',
    });

    const affiliateLinks: AffiliateLink[] = result.rows.map((row: any) => ({
      id: row.id,
      keyword: row.keyword,
      affiliateUrl: row.affiliate_url,
      conversionRate: row.conversion_rate,
      clicks: row.clicks,
      revenue: row.revenue,
      isActive: row.is_active,
    }));

    // Find matching keywords in content
    const matches = affiliateLinks.filter((link) =>
      content.toLowerCase().includes(link.keyword.toLowerCase())
    );

    // Sort by conversion rate (highest first)
    matches.sort((a, b) => b.conversionRate - a.conversionRate);

    return matches.slice(0, 5); // Return top 5 opportunities
  } catch (error) {
    console.error('Failed to find affiliate opportunities:', error);
    return [];
  }
}

/**
 * Track affiliate link click
 */
export async function trackAffiliateClick(affiliateId: number): Promise<void> {
  try {
    await tursoClient.execute({
      sql: 'UPDATE affiliate_links SET clicks = clicks + 1 WHERE id = ?',
      args: [affiliateId],
    });
  } catch (error) {
    console.error('Failed to track affiliate click:', error);
  }
}

/**
 * Create locked feature (Micro-SaaS)
 */
export async function createLockedFeature(
  featureName: string,
  price: number,
  description: string
): Promise<{ featureId: number; success: boolean }> {
  try {
    const result = await tursoClient.execute({
      sql: `
        INSERT INTO dynamic_content (content_type, content_key, content_data, metadata)
        VALUES ('locked_feature', ?, ?, ?)
      `,
      args: [
        featureName.toLowerCase().replace(/\s+/g, '_'),
        JSON.stringify({
          name: featureName,
          price,
          description,
          locked: true,
        }),
        JSON.stringify({
          price,
          currency: 'USD',
          paymentMethods: ['stripe', 'crypto'],
        }),
      ],
    });

    return {
      featureId: result.lastInsertRowid as number,
      success: true,
    };
  } catch (error: any) {
    console.error('Failed to create locked feature:', error);
    return {
      featureId: 0,
      success: false,
    };
  }
}

/**
 * Optimize ad placement based on CTR data
 */
export async function optimizeAdPlacement(): Promise<{
  strategy: MonetizationConfig['adPlacementStrategy'];
  recommendedChanges: string[];
}> {
  try {
    // Get current CTR metrics
    const ctrResult = await tursoClient.execute({
      sql: `
        SELECT AVG(value) as avg_ctr 
        FROM growth_metrics 
        WHERE metric_type = 'ctr' 
        AND created_at > datetime('now', '-7 days')
      `,
    });

    const avgCtr = ctrResult.rows[0]?.avg_ctr || 0;

    const recommendedChanges: string[] = [];
    let strategy: MonetizationConfig['adPlacementStrategy'] = 'conservative';

    if (avgCtr > 0.05) {
      // CTR > 5% - Can be more aggressive
      strategy = 'aggressive';
      recommendedChanges.push(
        'Increase ad density in high-engagement areas',
        'Add sticky header/footer ads',
        'Implement interstitial ads between content sections'
      );
    } else if (avgCtr > 0.02) {
      // CTR > 2% - Balanced approach
      strategy = 'balanced';
      recommendedChanges.push(
        'Add sidebar ads on desktop',
        'Insert native ads within content',
        'Test above-the-fold placements'
      );
    } else {
      // CTR < 2% - Conservative approach
      strategy = 'conservative';
      recommendedChanges.push(
        'Focus on high-relevance ad placements only',
        'Improve ad-content alignment',
        'A/B test different ad formats'
      );
    }

    return {
      strategy,
      recommendedChanges,
    };
  } catch (error) {
    console.error('Failed to optimize ad placement:', error);
    return {
      strategy: 'conservative',
      recommendedChanges: ['Unable to analyze - using default conservative strategy'],
    };
  }
}

/**
 * Get monetization dashboard data
 */
export async function getMonetizationDashboard() {
  try {
    // Get revenue metrics
    const revenueResult = await tursoClient.execute({
      sql: `
        SELECT 
          SUM(CASE WHEN metric_type = 'revenue' THEN value ELSE 0 END) as total_revenue,
          SUM(CASE WHEN metric_type = 'affiliate_revenue' THEN value ELSE 0 END) as affiliate_revenue,
          SUM(CASE WHEN metric_type = 'saas_revenue' THEN value ELSE 0 END) as saas_revenue
        FROM growth_metrics
        WHERE created_at > datetime('now', '-30 days')
      `,
    });

    // Get top affiliate links
    const topAffiliates = await tursoClient.execute({
      sql: `
        SELECT keyword, clicks, revenue, conversion_rate
        FROM affiliate_links
        WHERE is_active = 1
        ORDER BY revenue DESC
        LIMIT 10
      `,
    });

    // Get locked features
    const lockedFeatures = await tursoClient.execute({
      sql: `
        SELECT content_key, content_data
        FROM dynamic_content
        WHERE content_type = 'locked_feature'
      `,
    });

    return {
      totalRevenue: revenueResult.rows[0]?.total_revenue || 0,
      affiliateRevenue: revenueResult.rows[0]?.affiliate_revenue || 0,
      saasRevenue: revenueResult.rows[0]?.saas_revenue || 0,
      topAffiliates: topAffiliates.rows,
      lockedFeatures: lockedFeatures.rows,
    };
  } catch (error) {
    console.error('Failed to get monetization dashboard:', error);
    return {
      totalRevenue: 0,
      affiliateRevenue: 0,
      saasRevenue: 0,
      topAffiliates: [],
      lockedFeatures: [],
    };
  }
}

/**
 * Initialize default affiliate links
 */
export async function initializeAffiliateLinks() {
  try {
    const defaultAffiliates = [
      { keyword: 'ai tools', affiliateUrl: 'https://affiliate.example.com/ai-tools', conversionRate: 0.03 },
      { keyword: 'saas', affiliateUrl: 'https://affiliate.example.com/saas', conversionRate: 0.025 },
      { keyword: 'passive income', affiliateUrl: 'https://affiliate.example.com/passive-income', conversionRate: 0.04 },
      { keyword: 'automation', affiliateUrl: 'https://affiliate.example.com/automation', conversionRate: 0.035 },
      { keyword: 'trading', affiliateUrl: 'https://affiliate.example.com/trading', conversionRate: 0.05 },
    ];

    for (const affiliate of defaultAffiliates) {
      await tursoClient.execute({
        sql: `
          INSERT OR IGNORE INTO affiliate_links (keyword, affiliate_url, conversion_rate)
          VALUES (?, ?, ?)
        `,
        args: [affiliate.keyword, affiliate.affiliateUrl, affiliate.conversionRate],
      });
    }

    console.log('Affiliate links initialized');
  } catch (error) {
    console.error('Failed to initialize affiliate links:', error);
  }
}

export default {
  findAffiliateOpportunities,
  trackAffiliateClick,
  createLockedFeature,
  optimizeAdPlacement,
  getMonetizationDashboard,
  initializeAffiliateLinks,
};
