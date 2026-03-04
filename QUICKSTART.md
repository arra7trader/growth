# Quick Start (100% Free)

## 1. Install

```bash
cd aether-auto-saas
npm install
```

## 2. Environment

```bash
cp .env.example .env.local
```

Default env gratis dan siap untuk mode real data:

```bash
AETHER_REAL_MODE=true
TURSO_DATABASE_URL=file:local.db
```

## 3. Run

```bash
npm run dev
```

Open `http://localhost:3000`.

## 4. Make it evolve

```bash
npm run evolve
```

## 5. Always-on autonomous mode

Pilot berjalan terus otomatis (`free_autonomous`) tanpa perlu kontrol manual.

## 6. Pilot always-on

Pilot bot berjalan otomatis terus, tanpa start/stop manual.

Lihat report terbaru:

```bash
npm run pilot:latest
```

Report output:

- `reports/pilot/*.md`
- `reports/pilot/*.json`
- Dashboard tab `Admin` (report otomatis tampil di panel)

## Health check

```bash
curl http://localhost:3000/api/evolve
```

## Real tracking check

```bash
curl -X POST http://localhost:3000/api/track \
  -H "Content-Type: application/json" \
  -d "{\"eventType\":\"page_view\",\"value\":1,\"source\":\"quickstart\"}"
```

Expect:

- `success: true`
- `systemHealth: operational`
- `systemMode: free_real`
- `operationMode: free_autonomous` (default)
