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

## USDT payout monitor

- Wallet payout default BEP20 sudah di-set ke:
  - `0x84a06ffc26031b782c893252a769bd146bca8ad0`
- Cek sinkronisasi on-chain di dashboard tab `Admin` bagian `USDT Payout Monitor`.

## No-cron autopilot

- Sistem pakai mode `request_driven` (tanpa cron).
- Dashboard browser kirim heartbeat otomatis agar autopilot tetap berjalan saat ada traffic.

## Zero-click mode (recommended)

- GitHub Actions heartbeat sudah tersedia di:
  - `.github/workflows/autopilot-heartbeat.yml`
- Workflow ini mengirim pulse otomatis tiap 15 menit agar sistem tetap aktif tanpa klik dari Anda.

## Auto action executor

- Engine crypto otomatis membuat action queue + draft submission.
- Engine mencoba auto-submit langsung untuk target GitHub jika `GITHUB_TOKEN` tersedia.
- Jika token tidak ada, hasil tetap diproses ke mode `outbox`.
- Pantau di dashboard tab `Admin` bagian `Crypto Revenue Engine`.

Expect:

- `success: true`
- `systemHealth: operational`
- `systemMode: free_real`
- `operationMode: free_autonomous` (default)
