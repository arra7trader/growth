# Aether Auto-SaaS - Autonomous Profit-Generating Web Entity

An autonomous, self-evolving web application that operates as an independent agent capable of:

- 🧠 **Autonomous Decision Making** - AI-powered market research and feature planning
- 💻 **Self-Coding** - Automatically updates its own code via GitHub API
- 💰 **Monetization** - Dynamic affiliate marketing, micro-SaaS, and ad optimization
- 📈 **Growth Metrics** - Real-time tracking and optimization
- 🔄 **24-Hour Evolution Cycle** - Continuous improvement loop

## Tech Stack

- **Framework**: Next.js 15 (App Router)
- **Styling**: Tailwind CSS (Dark mode focused)
- **Database**: Turso (SQLite on the Edge)
- **AI**: OpenAI GPT-4
- **Self-Coding**: GitHub API (Octokit)
- **Deployment**: Vercel (Edge Functions + Cron Jobs)

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    AETHER AUTO-SaaS                      │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  ┌──────────────┐    ┌──────────────┐    ┌────────────┐ │
│  │ Market       │    │ Autonomous   │    │ Self-Coding│ │
│  │ Research     │───▶│ Brain (AI)   │───▶│ GitHub API │ │
│  └──────────────┘    └──────────────┘    └────────────┘ │
│         │                   │                    │       │
│         ▼                   ▼                    ▼       │
│  ┌──────────────┐    ┌──────────────┐    ┌────────────┐ │
│  │ Trends/      │    │ Evolution    │    │ Code       │ │
│  │ Keywords     │    │ Decisions    │    │ Updates    │ │
│  └──────────────┘    └──────────────┘    └────────────┘ │
│                                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │           Monetization Engine                     │   │
│  │  • Affiliate Marketing (Auto-insert links)        │   │
│  │  • Micro-SaaS (Locked features)                   │   │
│  │  • Ad Optimization (CTR-based)                    │   │
│  └──────────────────────────────────────────────────┘   │
│                                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │              Turso Database                       │   │
│  │  • logs (AI thoughts & decisions)                 │   │
│  │  • growth_metrics (Traffic & Revenue)             │   │
│  │  • dynamic_content (AI-generated UI)              │   │
│  │  • affiliate_links (Revenue tracking)             │   │
│  │  • evolution_history (Change log)                 │   │
│  └──────────────────────────────────────────────────┘   │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

## Getting Started

### Prerequisites

- Node.js 18+ 
- OpenAI API Key
- GitHub Personal Access Token
- Turso Database (free tier available)
- Vercel Account

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/arra7trader/growth.git
   cd growth/aether-auto-saas
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   
   Copy `.env.example` to `.env.local` and fill in your credentials:
   ```bash
   cp .env.example .env.local
   ```

   Required variables:
   - `OPENAI_API_KEY` - Your OpenAI API key
   - `GITHUB_TOKEN` - GitHub Personal Access Token (with repo scope)
   - `GITHUB_OWNER` - Your GitHub username (e.g., `arra7trader`)
   - `GITHUB_REPO` - Repository name (e.g., `growth`)
   - `TURSO_DATABASE_URL` - Your Turso database URL
   - `TURSO_AUTH_TOKEN` - Your Turso auth token

4. **Initialize the database**
   ```bash
   npm run dev
   # Database auto-initializes on first run
   ```

5. **Run the development server**
   ```bash
   npm run dev
   ```

   Open [http://localhost:3000](http://localhost:3000) to see the dashboard.

## Self-Coding Logic

The self-coding feature works through the following process:

### 1. Market Research (Daily)
```typescript
// src/lib/brain.ts - scrapeMarketData()
- Scrapes trending topics from AI APIs
- Analyzes keywords and pain points
- Identifies monetization opportunities
```

### 2. Decision Making
```typescript
// src/lib/brain.ts - makeEvolutionDecision()
- AI analyzes market data + current metrics
- Decides best action (content, feature, SEO, etc.)
- Generates specific code implementation plan
```

### 3. Code Generation & Execution
```typescript
// src/lib/github.ts - executeEvolution()
- Receives evolution proposal with file changes
- Creates commits via GitHub API
- Updates repository with new code
- Logs changes to database
```

### Example Evolution Proposal
```typescript
{
  type: "add_feature",
  title: "Add Crypto Payment Gateway",
  description: "Implement Stripe/crypto payment for locked features",
  files: [
    {
      path: "src/app/api/payment/route.ts",
      content: "// ... generated code ...",
      message: "Add payment endpoint"
    },
    {
      path: "src/components/PaymentModal.tsx",
      content: "// ... generated code ...",
      message: "Add payment UI component"
    }
  ],
  priority: "high"
}
```

## Monetization Engine

### 1. Dynamic Affiliate Marketing
- Automatically finds relevant affiliate opportunities
- Inserts affiliate links into generated content
- Tracks clicks, conversions, and revenue
- Optimizes for highest-converting keywords

### 2. Micro-SaaS (Locked Features)
- AI decides which features to lock behind paywall
- Supports Stripe and crypto payments
- Dynamic pricing based on demand
- Automatic feature creation

### 3. Ad Optimization
- Analyzes CTR data in real-time
- Adjusts ad placement strategy:
  - **Conservative**: < 2% CTR
  - **Balanced**: 2-5% CTR
  - **Aggressive**: > 5% CTR

## API Endpoints

### `POST /api/evolve`

Trigger evolution cycle manually.

**Request:**
```json
{
  "action": "evolve"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Evolution cycle completed",
  "data": {
    "success": true,
    "commitSha": "abc123...",
    "url": "https://github.com/..."
  }
}
```

### `GET /api/evolve`

Get current system status.

**Response:**
```json
{
  "success": true,
  "data": {
    "systemHealth": "operational",
    "lastActivity": "2026-03-04T10:00:00Z",
    "recentLogs": [...],
    "latestMetrics": [...],
    "evolutionHistory": [...],
    "activeContent": [...]
  }
}
```

## Vercel Deployment

### 1. Deploy to Vercel
```bash
vercel deploy --prod
```

### 2. Set Environment Variables
In Vercel dashboard, add all environment variables from `.env.example`.

### 3. Enable Cron Jobs
The `vercel.json` configures a daily cron job at midnight UTC:
```json
{
  "crons": [
    {
      "path": "/api/evolve",
      "schedule": "0 0 * * *"
    }
  ]
}
```

### 4. GitHub Integration
Connect your Vercel project to the GitHub repository for automatic deployments.

## Database Schema

### `logs`
Stores AI thoughts, decisions, and system events.

### `growth_metrics`
Tracks traffic, revenue, CTR, and other KPIs.

### `dynamic_content`
Stores AI-generated UI components and content.

### `affiliate_links`
Manages affiliate opportunities and performance.

### `evolution_history`
Records all self-coding changes and commits.

## Manual Evolution Trigger

You can manually trigger an evolution cycle:

**Via Dashboard:**
- Click "Trigger Evolution" button in the UI

**Via CLI:**
```bash
npm run evolve
```

**Via API:**
```bash
curl -X POST http://localhost:3000/api/evolve \
  -H "Content-Type: application/json" \
  -d '{"action": "evolve"}'
```

## Security Considerations

⚠️ **Important Security Notes:**

1. **GitHub Token**: Use a Personal Access Token with minimal required scopes (`repo` only)
2. **API Keys**: Never commit `.env.local` to version control
3. **Rate Limiting**: Implement rate limiting for API endpoints in production
4. **Validation**: All AI-generated code should be validated before execution
5. **Rollback**: Maintain ability to revert unwanted self-coding changes

## Monitoring & Debugging

### View System Logs
```typescript
// In dashboard, navigate to "Logs" tab
// Or query directly:
SELECT * FROM logs ORDER BY created_at DESC LIMIT 50;
```

### Check Evolution History
```typescript
SELECT * FROM evolution_history ORDER BY created_at DESC;
```

### Monitor Revenue
```typescript
SELECT 
  metric_type,
  SUM(value) as total,
  AVG(value) as average
FROM growth_metrics
WHERE created_at > datetime('now', '-30 days')
GROUP BY metric_type;
```

## Roadmap

- [ ] Integrate real-time Twitter/X API for trend scraping
- [ ] Add Google Trends API integration
- [ ] Implement Stripe payment processing
- [ ] Add crypto payment support (Coinbase Commerce)
- [ ] Multi-language content generation
- [ ] A/B testing framework for optimizations
- [ ] Advanced analytics dashboard
- [ ] Mobile-responsive UI improvements

## License

MIT License - See LICENSE file for details.

## Support

For issues or questions, open an issue on GitHub: https://github.com/arra7trader/growth/issues

---

**Built with 🧠 by Aether Autonomous Systems**

*This system is capable of modifying its own code. Use responsibly.*
