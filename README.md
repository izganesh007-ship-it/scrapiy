# Scrapiy

A free, self-hosted web scraper that runs entirely on Cloudflare's free tier.
Point it at a listing page — it finds the repeating product cards, extracts the
fields, follows pagination, and hands you a CSV. Recipes, schedules and a
public REST API included. No subscription, no credit card.

**Live:** https://scrapiy.izganesh-marketplace.workers.dev

## Architecture

Everything runs as one Cloudflare Worker. The frontend is served as static
assets by the same Worker — one deploy, one URL.

```
Browser (Vue 3 + Vite, macOS-style UI)
   │
Cloudflare Worker  (worker/src/index.ts)
   ├─ Static assets  → frontend/dist
   ├─ D1 (SQLite)    → jobs, recipes, schedules, API keys
   ├─ KV             → CSV export storage
   ├─ Queues         → job dispatch
   └─ Browser Rendering (tier 2)
   │
Scraping ladder  (worker/src/lib/fetchLadder.ts)
   ├─ Tier 1  cheerio static fetch + real browser headers  (free, default)
   ├─ Tier 2  Cloudflare Browser Rendering for JS sites    (10 min/day free)
   └─ Tier 3  ScraperAPI/ZenRows — only if you set a key   (optional)
```

## Features

- **Auto field detection** — finds repeating containers, extracts name/price/link
- **Visual selector** — click elements on a live-rendered page to build recipes
- **Recipes** — saved scrape configs, re-runnable in one click
- **Pagination** — `next_link` and `page_param` modes, up to 50 pages
- **Schedules** — re-run recipes every N hours (built-in cron trigger)
- **Public REST API** — `POST /api/v1/run` with `X-API-Key` (1,000 req/day/key)
- **CSV / JSON export** — from the dashboard or the API
- **API keys** — SHA-256 hashed server-side; full keys live only in your browser

## Project structure

```
├─ wrangler.jsonc          Cloudflare config (Worker + D1 + KV + Queue + browser + cron)
├─ worker/
│  └─ src/
│     ├─ index.ts          Routes + scheduled() cron handler
│     ├─ lib/
│     │  ├─ fetchLadder.ts Tier 1→2→3 scraping ladder
│     │  ├─ extract.ts     Auto-detection + custom selector engine
│     │  └─ cardDetector.ts DOM repeated-card detection
│     ├─ handlers/         scan, render, preview, recipes, keys, v1 API
│     └─ db/               D1 helpers + schema.sql, schema-v2.sql
├─ frontend/
│  └─ src/components/      Demo (4-step wizard), Scraper, VisualSelector,
│                          Recipes, Keys pages
├─ playwright-worker/      Optional standalone Playwright service (Docker)
└─ docs/                   Design + implementation plan notes
```

## Quick start (local)

Prerequisites: Node.js 20+, npm.

```bash
git clone https://github.com/izganesh007-ship-it/scrapiy.git
cd scrapiy

# Worker — terminal 1
cd worker
npm install
npx wrangler login              # one time
npx wrangler d1 execute scrapiy_jobs --local --file=src/db/schema-v2.sql
npm run dev                     # wrangler dev on :8787

# Frontend — terminal 2
cd ../frontend
npm install
npm run dev                     # Vite dev server, proxies to :8787
```

Open http://localhost:5173. Try the Live Demo tab — it runs real scrapes.

## Deploy to Cloudflare (free)

```bash
# 1. Login + create resources (one time)
npx wrangler login
npx wrangler d1 create scrapiy_jobs        # paste the id into wrangler.jsonc
npx wrangler kv namespace create EXPORTS   # paste the id into wrangler.jsonc
npx wrangler queues create scrape-jobs

# 2. Apply schema
npx wrangler d1 execute scrapiy_jobs --remote --file=worker/src/db/schema-v2.sql

# 3. Build + deploy (Worker serves the built frontend from frontend/dist)
cd frontend && npm install && npm run build && cd ..

npx wrangler deploy
```

You get: the app at `https://<name>.<subdomain>.workers.dev`, a 15-minute cron
for schedules, and the browser-rendering binding enabled.

Optional secrets (all set with `npx wrangler secret put NAME`):

| Secret | Purpose |
|---|---|
| `OWNER_KEY` | Master API key — unlimited `/api/v1` requests, bypasses counters |
| `SCRAPERAPI_KEY` | Enables tier-3 fallback for hard anti-bot sites |
| `RESEND_API_KEY` | Failure email alerts (not required) |

## API usage

```bash
# Run a saved recipe (sync — returns scraped items)
curl -X POST https://<your-worker>/api/v1/run \
  -H "X-API-Key: sk_live_..." \
  -H "Content-Type: application/json" \
  -d '{"recipe_id": "<uuid>"}'

# Fetch a run + export
curl -H "X-API-Key: sk_live_..." https://<your-worker>/api/v1/runs/<job_id>
curl -H "X-API-Key: sk_live_..." -o out.csv \
  "https://<your-worker>/api/v1/runs/<job_id>/export?format=csv"
```

Works from Python, Google Sheets (Apps Script), n8n/Make, cron — anywhere that
speaks HTTP.

## Free-tier limits

| Resource | Free allowance |
|---|---|
| Workers requests | 100,000 / day |
| D1 storage | 5 GB |
| KV reads | 100,000 / day |
| Browser Rendering | 10 minutes / day |
| Queues | 1M messages / month |

## Security notes

- API keys are stored only as SHA-256 hashes server-side; the plaintext key is
  shown once at creation and kept in your browser's localStorage
- URL validation + SSRF protection (private IP ranges blocked)
- Owner keys (`OWNER_KEY` secret) bypass rate limits — treat them like passwords

## License

MIT
