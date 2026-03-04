# Aether Auto-SaaS

Autonomous web app that is **100% free** and focused on growing revenue by itself.

## Principles

- Full free stack only (no paid APIs)
- Continuous self-evolution
- Monetization-first metrics (traffic, affiliate revenue, SaaS revenue)

## What it does

- Runs autonomous evolution cycles
- Generates and stores growth decisions
- Tracks monetization results in database
- Shows real revenue/traffic trend in dashboard
- Uses fixed always-on mode: `free_autonomous`

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

- Dashboard:
  - `Trigger Evolution` button
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

## API

### `GET /api/evolve`

Returns:

- `systemHealth`
- `systemMode` (`free`)
- `operationMode` (`free_autonomous`)
- logs, metrics, evolution history
- monetization summary + 14-day revenue trend
- admin pilot status + pilot reports

### `POST /api/evolve`

Actions:

- `{"action":"evolve"}`
- `{"action":"status"}`
- `{"action":"logs"}`

## Scripts

- `npm run dev`
- `npm run build`
- `npm run start`
- `npm run lint`
- `npm run evolve`
- `npm run pilot:latest` (diagnostic report viewer)
