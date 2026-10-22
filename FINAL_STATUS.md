# Scrapiy - Final Status (Apify-clone shipped 2026-10-21)

**Live:** https://scrapiy.izganesh-marketplace.workers.dev

## What's shipped (all verified live)

| Feature | Endpoint / Where | Status |
|---|---|---|
| Static scraping + auto-detect | `/api/scan` | ✅ 200 |
| Scraping ladder (static → Browser Rendering → ScraperAPI) | `worker/src/lib/fetchLadder.ts` | ✅ |
| JS rendering (Cloudflare Browser Rendering, free 10 min/day) | `BROWSER` binding | ✅ deployed |
| Recipes (Apify "actors") | `/api/recipes` CRUD + `POST /api/recipes/:id/run` | ✅ 12 items/2 pages verified |
| Custom selectors extraction | `worker/src/lib/extract.ts` (`item` + `fields` w/ `a@href` attr syntax) | ✅ 6 fields verified |
| Pagination | next_link + page_param, max 50 | ✅ 2 pages merged |
| Schedules (interval hours) | `/api/recipes/:id/schedule` + cron `*/15` | ✅ next_run stored |
| API keys (SHA-256 hashed, 1000 req/day) | `/api/keys`, `X-API-Key` on `/api/v1/*` | ✅ 401 no key / 200 valid |
| Public API | `POST /api/v1/run`, `GET /api/v1/runs/:id`, `GET /api/v1/runs/:id/export?format=json\|csv` | ✅ verified |
| Visual selector (iframe click-to-pick) | `/visual` tab + `/api/render` + `/api/preview` | ✅ deployed |
| Frontend tabs | Scraper / Recipes / Visual Selector / API Keys | ✅ 93KB gzip 34KB |

## Verified test transcript (2026-10-21, final)
- Revoke proven end-to-end: create → 200 OK → DELETE by full hash → 401 rejected (keys list now returns full SHA-256 hash; UI masks it)
- Demo rebuilt as 4-step wizard (Fetch → Find cards → Extract → Export CSV/Recipe); /api/preview now has auto-detect mode
- Auto-detect scan: webscraper laptops → 5 unique products; books.toscrape → 20 books w/ £ prices (nav filtered, nested-div dedupe)
- Recipe "Webscraper Test": `.product-wrapper` → 12 items across 2 pages
- v1 API with key: 12 items, JSON export 200; 401 without/wrong key
- Schedule set 24h → next_run_at stored; cron */15 live
- Keys: full key stored in localStorage only; server keeps SHA-256 hash; UI shows masked + reveal/copy/remove

## How to use
1. **Scraper tab** — instant scan of any URL (static, or check "JS render")
2. **Visual Selector** — load page, click a card, pick fields, save recipe
3. **Recipes tab** — run/delete/schedule recipes (interval hours)
4. **Keys tab** — create key → call `POST /api/v1/run {"recipe_id": "..."}`
5. Optional env secrets: `SCRAPERAPI_KEY` (tier 3), `RESEND_API_KEY` (failure emails — not yet wired)

## Known ceilings (ponytail notes)
- Schedules upsert = delete+insert (recipe_id lacks UNIQUE index)
- Browser Rendering free = 10 min/day — recipe `use_browser` only for JS-heavy sites
- Tier 3 only active if SCRAPERAPI_KEY secret set
