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

## Opsi 2: GitHub mirror persistence

- Aktif otomatis saat `GITHUB_TOKEN` tersedia.
- Mirror menyimpan status runtime penting ke file GitHub agar tidak split-state antar instance serverless.
- Jika token tidak punya izin `contents:write`, mirror fallback otomatis ke issue comment.
- Env terkait:
  - `AETHER_GITHUB_MIRROR_ENABLED`
  - `AETHER_GITHUB_MIRROR_MODE`
  - `AETHER_GITHUB_MIRROR_PATH`
  - `AETHER_GITHUB_MIRROR_MIN_WRITE_INTERVAL_SECONDS`
  - `AETHER_GITHUB_MIRROR_ISSUE_NUMBER` / `AETHER_GITHUB_MIRROR_ISSUE_TITLE`

## Zero-click mode (recommended)

- GitHub Actions heartbeat sudah tersedia di:
  - `.github/workflows/autopilot-heartbeat.yml`
- Workflow ini mengirim pulse otomatis tiap 15 menit agar sistem tetap aktif tanpa klik dari Anda.

## Auto action executor

- Engine crypto otomatis membuat action queue + draft submission.
- Jika `AETHER_SUBMISSION_WEBHOOK_URL` diisi, bot auto-submit ke webhook.
- Engine mencoba auto-submit langsung untuk target GitHub jika `GITHUB_TOKEN` tersedia.
- Jika token tidak ada, hasil tetap diproses ke mode `outbox`.
- Retry/backoff otomatis aktif dengan limit `CRYPTO_EXECUTOR_MAX_ATTEMPTS`.
- Self-healing maintenance otomatis aktif:
  - recovery task macet,
  - reprioritas overdue queue,
  - prune task lama + queue guard.
- Real Lane A aktif: engine utamakan peluang dengan sinyal `payable + submit-path`.
- Submission lifecycle monitor otomatis cek sinyal `accepted/paid` untuk target GitHub issue.
- Jika commit evolusi gagal karena jaringan/API, sistem auto-fallback ke local execution (`AETHER_GITHUB_EXECUTION_FALLBACK=true`).
- Pantau di dashboard tab `Admin` bagian `Crypto Revenue Engine`.

## Tambah sumber peluang (opsional)

- `CRYPTO_GITHUB_QUERIES` untuk override query discovery.
- `CRYPTO_RSS_FEED_URLS` untuk tambah sumber RSS (dipisah koma).
- Query GitHub akan ditambah otomatis `is:issue` dan `state:open` jika belum ada.
- `CRYPTO_STALE_IN_PROGRESS_MINUTES` untuk batas recovery task macet.
- `CRYPTO_QUEUE_OVERDUE_MINUTES` untuk batas reprioritas queue overdue.
- `CRYPTO_TASK_RETENTION_DAYS` untuk retensi task selesai/skipped.
- `CRYPTO_ACTIVE_TASK_LIMIT` untuk batas task aktif dalam antrean.
- `CRYPTO_ENGINE_CYCLE_HISTORY_LIMIT` untuk panjang histori cycle di dashboard.
- `CRYPTO_REAL_LANE_STRICT` untuk mode strict/flexible filter peluang real.
- `CRYPTO_SUBMISSION_MONITOR_INTERVAL_MINUTES` untuk interval cek lifecycle submission.
- `CRYPTO_SUBMISSION_MONITOR_LIMIT` untuk jumlah submission yang dicek per monitor run.

Expect:

- `success: true`
- `systemHealth: operational`
- `systemMode: free_real`
- `operationMode: free_autonomous` (default)
