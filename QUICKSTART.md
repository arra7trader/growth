# Quick Start Guide - Aether Auto-SaaS

## Setup (5 minutes)

### 1. Clone and Install

```bash
# Navigate to the project
cd aether-auto-saas

# Install dependencies
npm install
```

### 2. Configure Environment Variables

Copy the example environment file and fill in your credentials:

```bash
cp .env.example .env.local
```

**Required API Keys:**

1. **OpenAI API Key**
   - Get from: https://platform.openai.com/api-keys
   - Required for: AI decision making and code generation

2. **GitHub Personal Access Token**
   - Get from: https://github.com/settings/tokens
   - Scopes needed: `repo` (full control of private repositories)
   - Required for: Self-coding functionality

3. **Turso Database** (Optional for local dev)
   - Create at: https://turso.tech/
   - For local development, SQLite file is used automatically

### 3. Start Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to see the dashboard.

### 4. Trigger First Evolution

Click the **"Trigger Evolution"** button in the dashboard to start the first autonomous cycle.

---

## Deployment to Vercel (10 minutes)

### 1. Install Vercel CLI

```bash
npm install -g vercel
```

### 2. Deploy

```bash
vercel deploy --prod
```

### 3. Set Environment Variables

In the [Vercel Dashboard](https://vercel.com/dashboard):

1. Select your project
2. Go to **Settings** → **Environment Variables**
3. Add all variables from `.env.example`

### 4. Enable Cron Jobs

The `vercel.json` already configures daily evolution at midnight UTC.

To verify:
1. Go to **Settings** → **Cron Jobs**
2. Ensure the cron job is active

### 5. Connect GitHub for Auto-Deploy

1. In Vercel, connect your GitHub repository
2. Enable automatic deployments on push
3. The self-coding feature will now auto-deploy changes

---

## Usage

### Dashboard Features

- **Overview Tab**: Real-time metrics and system status
- **Logs Tab**: AI thoughts and decisions
- **Metrics Tab**: Traffic and revenue tracking
- **Evolution Tab**: History of self-coded changes

### Manual Evolution Trigger

**Via Dashboard:**
- Click "Trigger Evolution" button

**Via API:**
```bash
curl -X POST http://localhost:3000/api/evolve \
  -H "Content-Type: application/json" \
  -d '{"action": "evolve"}'
```

**Via CLI:**
```bash
npm run evolve
```

---

## Monitoring

### Check System Health

```bash
curl http://localhost:3000/api/evolve
```

### View Evolution History

In the dashboard, navigate to the **Evolution** tab to see:
- All self-coded changes
- GitHub commit links
- AI decision reasoning

---

## Troubleshooting

### Build Fails

**Error: Missing credentials**
- Ensure `.env.local` exists with valid API keys
- OpenAI API key must start with `sk-`

### GitHub API Errors

**Error: Bad credentials**
- Regenerate GitHub Personal Access Token
- Ensure token has `repo` scope

**Error: Rate limit exceeded**
- Authenticated requests get 5000 requests/hour
- Wait for limit to reset or use different token

### Database Errors

**Error: unable to open database file**
- For local dev, ensure write permissions in project directory
- For Turso, check `TURSO_DATABASE_URL` is correct

---

## Next Steps

1. **Customize AI Behavior**
   - Edit prompts in `src/lib/brain.ts`
   - Adjust decision-making logic

2. **Add Revenue Streams**
   - Configure affiliate links in database
   - Set up Stripe/crypto payments

3. **Monitor Performance**
   - Check dashboard daily
   - Review evolution history weekly

4. **Scale Up**
   - Upgrade Turso plan for more traffic
   - Add more AI models for diverse decisions

---

## Support

- **Documentation**: See `README.md` and `SELF_CODING.md`
- **Issues**: https://github.com/arra7trader/growth/issues
- **Discussions**: https://github.com/arra7trader/growth/discussions

---

**🚀 Your autonomous profit-generating entity is now live!**

*Sit back and watch as the AI evolves the platform 24/7.*
