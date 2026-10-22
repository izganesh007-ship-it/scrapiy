# Implementation Plan — Scrapiy Apify-Clone ✅ COMPLETE (2026-10-21)

**Spec:** docs/superpowers/specs/2026-10-21-apify-clone-design.md
**Status:** All phases shipped and verified live. See FINAL_STATUS.md.

## Phase 1 — Scraping Ladder (worker)
- [ ] `worker/src/lib/fetchLadder.ts`: `fetchPageHtml(url, env, {useBrowser})` — Tier1 static (browser headers, 1 retry, 15s timeout) → Tier2 `env.BROWSER.launch()` (any-typed binding, 60s goto networkidle) → Tier3 optional `SCRAPERAPI_KEY` env. Returns `{html, tier, status}`.
- [ ] `scanHandler.ts`: use fetchLadder; accept optional `recipe_id`; record tier used in error/status path.
- [ ] `wrangler.jsonc`: re-add `browser` binding.
- **Test:** scan static site (tier1), JS site (tier2 escalation), check D1 job rows.

## Phase 2 — Schema + Recipes API
- [ ] `worker/src/db/schema-v2.sql`: recipes, schedules, api_keys, ALTER scraped_records.
- [ ] `wrangler d1 execute scrapiy_jobs --remote --file=worker/src/db/schema-v2.sql`
- [ ] `worker/src/db/database.ts`: recipe CRUD helpers (list/get/create/delete/update).
- [ ] `worker/src/handlers/recipes.ts`: list/create/delete/run endpoints. Run = insert job w/ recipe_id, run ladder + saved selectors via cheerio, return items.
- [ ] `index.ts`: wire routes.
- **Test:** create recipe via curl, run it, verify results.

## Phase 3 — API Keys + /api/v1
- [ ] `db`: api_key helpers (create, verify by hash, bump daily counter, 1000/day cap).
- [ ] `worker/src/handlers/v1.ts`: `POST /api/v1/run`, `GET /api/v1/runs/:id`, `GET /api/v1/runs/:id/export`.
- [ ] `handlers/keys.ts`: dashboard CRUD (show plaintext once, store sha256).
- [ ] `index.ts`: wire + key auth middleware for /api/v1/*.
- **Test:** create key, call /api/v1/run with key, verify rate limit counter.

## Phase 4 — Pagination
- [ ] In recipe runner: `pagination_json` modes next_link/page_param, max_pages default 5 cap 50, merge items.
- **Test:** page_param against webscraper.io test site (3 pages).

## Phase 5 — Schedules + Cron
- [ ] `schedules` CRUD endpoints + `scheduled()` handler in index.ts (every 15min, run due recipes).
- [ ] `wrangler.jsonc`: `"triggers": {"crons": ["*/15 * * * *"]}`.
- **Test:** insert schedule with next_run_at in past, trigger via deploy + check D1.

## Phase 6 — Frontend (Vue)
- [ ] Nav tabs: Scraper | Recipes | Keys.
- [ ] Recipes page: list/create/delete/run recipes, view results.
- [ ] Visual Selector page: URL → POST /api/render → iframe sandbox with injected script → click-to-select → generated selector → live preview (POST /api/preview) → save recipe.
- [ ] API Keys page: create (show once) / revoke list.
- **Test:** build (`npm run build`), deploy, manual click-through.

## Phase 7 — Alerts (optional)
- [ ] `notify.ts`: if `RESEND_API_KEY` set, POST resend email on failed job (recipe runs only).
- **Skip silently when key absent.**

## Verification (final)
- [ ] `npx wrangler deploy` clean
- [ ] Live: static scan, JS scan (tier2), recipe create/run, key + v1 run, pagination run
- [ ] No credit card services anywhere
