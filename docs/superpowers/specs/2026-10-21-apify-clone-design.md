# Scrapiy Apify-Clone Design (Approach A + B)

**Date:** 2026-10-21
**Status:** Approved

## Goal
Clone Apify's core features onto Scrapiy's free Cloudflare stack: tiered scraping, recipes (actors), visual selector, pagination, schedules, API keys, monitoring.

## Scraping Ladder
| Tier | Engine | Cost | When |
|------|--------|------|------|
| 1 | cheerio static fetch + real browser headers + retry | free, unlimited | default |
| 2 | Cloudflare Browser Rendering (`BROWSER` binding) | free 10 min/day | static blocked/empty or recipe `use_browser` |
| 3 | ScraperAPI/ZenRows (user key via env var, off by default) | 1k credits/mo | hard anti-bot, if key set |

Escalation: Tier 1 fails/empty → Tier 2 → Tier 3 (if configured).

## New D1 Tables
```sql
recipes(id TEXT PK, name, url, selectors_json, pagination_json, use_browser INT, created_at, updated_at)
schedules(id TEXT PK, recipe_id, interval_hours INT, next_run_at TEXT, enabled INT, last_run_at TEXT)
api_keys(key_hash TEXT PK, name, requests_today INT, last_used_at, created_at, revoked INT)
-- ALTER scraped_records ADD COLUMN recipe_id TEXT
```

## Endpoints
- Existing `/api/scan`, `/api/jobs*`, `/api/export/*` unchanged (+ recipe_id passthrough)
- `GET/POST /api/recipes`, `GET/DELETE /api/recipes/:id`, `POST /api/recipes/:id/run`
- `POST /api/v1/run {recipe_id, url?}` — auth `X-API-Key`, 1000 req/day/key
- `GET /api/v1/runs/:id` — job status/results
- `GET /api/v1/runs/:id/export?format=csv|json`
- `GET/POST/DELETE /api/keys` — dashboard key management (hashes only, show key once)

## Visual Selector
Frontend-only: worker endpoint `POST /api/render` returns fetched HTML (tier ladder). Frontend renders sanitized HTML in sandboxed iframe (same origin), click-to-select builds CSS selector (structural path + repeated classes), live preview via `/api/preview` (applies selectors server-side with cheerio), save as recipe.

## Pagination
Recipe `pagination_json`: `{mode: none|next_link|page_param, param_name?, max_pages}` (default 5, cap 50). Worker loops, merges items, single job record.

## Schedules
Simple interval hours (not cron). One Worker Cron Trigger every 15 min → query `schedules WHERE enabled AND next_run_at <= now` → run due recipes → set next_run_at.

## API Keys
SHA-256 hash stored, key shown once at creation. Format `sk_live_<32 hex>`. Daily counter resets by date comparison.

## Monitoring/Alerts
Optional email on job failure via Resend free tier (100/day) — only when `RESEND_API_KEY` secret set; silently skipped otherwise. Per-recipe success rate on jobs page.

## Not Building (YAGNI)
Proxies, CAPTCHA solving, team/roles, SSO, actor SDK/packaging, webhooks, usage billing.

## Build Order
1. Ladder + Tier 2 fix (correct cheerio import)
2. Schema migration + recipes API
3. API keys + /api/v1
4. Visual selector frontend
5. Pagination
6. Schedules + cron trigger
7. Alerts (optional)
