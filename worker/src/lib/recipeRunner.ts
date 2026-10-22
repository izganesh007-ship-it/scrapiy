/**
 * Recipe runner: fetch (ladder) → paginate → extract.
 * Used by /api/recipes/:id/run, /api/v1/run, and the cron scheduler.
 */
import * as cheerio from 'cheerio'
import { fetchPageHtml } from './fetchLadder'
import { extractAuto, extractWithSelectors, findNextPageUrl, type CustomSelectors, type PaginationConfig } from './extract'

export interface ExtractionItem {
  [field: string]: string | undefined
}

export interface RunResult {
  items: Array<Record<string, string | undefined>>
  tier: number
  pages: number
  error: string | null
}

function paginationMax(p?: PaginationConfig | null): number {
  if (!p || p.mode === 'none') return 1
  return Math.min(p.max_pages ?? 5, 50)
}

export async function runRecipeFetch(
  env: { BROWSER?: { launch(opts?: unknown): Promise<{ newPage(): Promise<{ goto(url: string, opts?: unknown): Promise<unknown>; content(): Promise<string>; setUserAgent?(ua: string): Promise<void> }>; close(): Promise<void> }> }; SCRAPERAPI_KEY?: string },
  opts: { url: string; selectors?: CustomSelectors | null; pagination?: PaginationConfig | null; useBrowser?: boolean }
): Promise<RunResult> {
  const maxPages = paginationMax(opts.pagination)
  const allItems: Array<Record<string, string | undefined>> = []
  let currentUrl: string | null = opts.url
  let tier = 1
  let pages = 0
  let lastError: string | null = null

  while (currentUrl && pages < maxPages) {
    const result = await fetchPageHtml(currentUrl, env, { useBrowser: opts.useBrowser })
    tier = result.tier
    lastError = result.error

    if (!result.html) {
      if (allItems.length === 0) throw new Error(result.error || `Fetch failed (tier ${result.tier})`)
      break
    }

    const $ = cheerio.load(result.html)
    let pageItems: Array<Record<string, string | undefined>>

    if (opts.selectors && opts.selectors.item && Object.keys(opts.selectors.fields ?? {}).length > 0) {
      pageItems = extractWithSelectors(result.html, opts.url, opts.selectors)
    } else {
      pageItems = extractAuto(result.html, opts.url) as unknown as Array<Record<string, string | undefined>>
    }

    allItems.push(...pageItems)
    pages++

    // Stop paginating if a page yielded nothing (avoids burning quota on dead trails)
    if (pageItems.length === 0 && pages > 1) break
    currentUrl = findNextPageUrl($, currentUrl, opts.pagination ?? { mode: 'none' })
  }

  return { items: allItems, tier, pages, error: lastError }
}
