# Aether Auto-SaaS

Autonomous web app that is **100% free** and focused on growing revenue by itself.

## Principles

- Full free stack by default (optional paid integrations if you choose)
- Continuous self-evolution
- Monetization-first metrics (traffic + crypto revenue + SaaS revenue)

## What it does

- Runs autonomous evolution cycles
- Generates and stores growth decisions
- Tracks monetization results in database
- Shows real revenue/traffic trend in dashboard
- Uses fixed always-on mode: `free_autonomous`
- Runs a crypto opportunity engine focused on no-capital pathways (bounty/grant/quest/job)
- Auto-generates execution tasks + submission drafts for top crypto opportunities

## Stack

- Next.js (App Router)
- React + Tailwind CSS
- SQLite local database via `@libsql/client`

## Quick setup

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open: `http://localhost:3000`

## Evolution controls

- Dashboard mode: always-on autopilot (no manual start/stop)
- CLI:

```bash
npm run evolve
```

## Pilot bot automation

Pilot bot adalah operator utama yang mengurus website secara otomatis (always-on):

- Menjalankan siklus evolusi secara berkala
- Monitoring KPI (traffic, revenue, CTR, fitur aktif)
- Menentukan strategi optimasi iklan
- Menyimpan report ke database
- Menghasilkan report file `.md` + `.json` untuk Anda
- Mengirim report ke tab `Admin` di dashboard

Pilot tidak perlu di-start/stop manual. Sistem menjaga pilot tetap hidup otomatis.

Lihat report terbaru langsung di terminal:

```bash
npm run pilot:latest
```

Lokasi report default:

- `reports/pilot/*.md`
- `reports/pilot/*.json`

Konfigurasi via `.env.local`:

- `PILOT_INTERVAL_MINUTES`
- `PILOT_EVOLUTION_INTERVAL_MINUTES`
- `PILOT_MAX_CYCLES`
- `PILOT_OPERATION_MODE`
- `PILOT_REPORT_DIR`

- API evolve:

```bash
curl -X POST http://localhost:3000/api/evolve \
  -H "Content-Type: application/json" \
  -d '{"action":"evolve"}'
```

- API tracking event real:

```bash
curl -X POST http://localhost:3000/api/track \
  -H "Content-Type: application/json" \
  -d '{"eventType":"page_view","value":1,"source":"landing"}'
```

## API

### `GET /api/evolve`

Returns:

- `systemHealth`
- `systemMode` (`free_real`)
- `operationMode` (`free_autonomous`)
- logs, metrics, evolution history
- monetization summary + 14-day revenue trend
- admin pilot status + pilot reports

### `POST /api/evolve`

Actions:

- `{"action":"evolve"}`
- `{"action":"status"}`
- `{"action":"logs"}`
- `{"action":"pulse","source":"browser_heartbeat"}`

### `POST /api/track`

Untuk data real (bukan simulasi). Event yang didukung:

- `page_view`
- `affiliate_click`
- `affiliate_sale`
- `saas_sale`

## Auto USDT BEP20 Monitoring

Sistem memantau transfer masuk USDT BEP20 ke wallet payout secara otomatis (tanpa cron), lalu mencatatnya sebagai revenue real:

- Wallet default: `0x84a06ffc26031b782c893252a769bd146bca8ad0`
- Endpoint sinkronisasi dijalankan otomatis saat API status/evolve dipanggil
- Status sinkronisasi dan error tampil di tab `Admin`

## Request-Driven Autopilot (No Cron)

- Mode autopilot dikunci ke `request_driven` (gratis, tanpa cron).
- Browser dashboard mengirim heartbeat berkala (`pulse`) untuk menjaga siklus otomatis tetap jalan.
- Tanpa traffic/event sama sekali, serverless tidak akan terus aktif 24/7.

## Zero-Click Heartbeat (Free)

- Repository ini menyertakan workflow: `.github/workflows/autopilot-heartbeat.yml`.
- Workflow mem-pulse production otomatis tiap 15 menit (gratis via GitHub Actions).
- Set repo variable `APP_BASE_URL` bila domain production Anda berbeda.

## Auto Action Executor

- Setiap cycle, engine memilih peluang crypto skor tertinggi.
- Sistem membuat `crypto_action_task` otomatis (priority, due time, runbook, submission draft).
- Sistem menjalankan auto-submit adapter:
  - Jika `AETHER_SUBMISSION_WEBHOOK_URL` tersedia: kirim submission payload otomatis ke webhook.
  - Jika target adalah GitHub issue/pull URL dan `GITHUB_TOKEN` tersedia: submit komentar otomatis.
  - Jika tidak: hasil disimpan sebagai `outbox` terstruktur (tetap otomatis, tanpa kehilangan draft).
- Executor memakai retry + backoff otomatis, dengan batas attempt (`CRYPTO_EXECUTOR_MAX_ATTEMPTS`).
- Semua task, draft, dan hasil submission ditampilkan di Admin panel untuk monitoring.

## Source Enrichment

- Engine memakai multi-query GitHub discovery (bounty/grant/quest/job).
- Bisa ditambah sumber RSS crypto opportunity via `CRYPTO_RSS_FEED_URLS`.
- Status jumlah sumber (query/feed) dan antrean executor tersedia di Admin panel.

## Scripts

- `npm run dev`
- `npm run build`
- `npm run start`
- `npm run lint`
- `npm run evolve`
- `npm run pilot:latest` (diagnostic report viewer)
