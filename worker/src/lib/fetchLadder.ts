/**
 * Scraping ladder: Tier 1 static fetch → Tier 2 Cloudflare Browser Rendering
 * → Tier 3 optional ScraperAPI/ZenRows (user key, off by default).
 * Returns the rendered/fetched HTML plus which tier served it.
 */

export interface FetchResult {
  html: string
  tier: 1 | 2 | 3
  finalUrl: string
  status: number
  blocked: boolean
  error: string | null
}

// Loose structural typing for the Browser Rendering binding — avoids pulling
// in @cloudflare/playwright just for types.
interface BrowserPage {
  goto(url: string, opts?: unknown): Promise<unknown>
  content(): Promise<string>
  setUserAgent?(ua: string): Promise<void>
}
interface LaunchedBrowser {
  newPage(): Promise<BrowserPage>
  close(): Promise<void>
}
export interface BrowserBinding {
  launch(opts?: unknown): Promise<LaunchedBrowser>
}

export interface LadderEnv {
  BROWSER?: BrowserBinding
  SCRAPERAPI_KEY?: string
}

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

const REAL_BROWSER_HEADERS: Record<string, string> = {
  'User-Agent': BROWSER_UA,
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Dest': 'document',
  'Upgrade-Insecure-Requests': '1',
}

const BLOCKED_PATTERNS = [
  /just a moment/i,           // Cloudflare challenge
  /access denied/i,
  /attention required/i,
  /captcha-delivery/i,        // DataDome
  /px-captcha/i,              // PerimeterX
  /incapsula/i,
]

export function looksBlocked(html: string): boolean {
  if (!html || html.length < 500) return true
  // ponytail: scan first 12KB only — interstitials live in the head, keeps it O(1)
  const head = html.slice(0, 12000)
  return BLOCKED_PATTERNS.some(p => p.test(head))
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

function fail(tier: 1 | 2 | 3, url: string, error: string | null, status = 0): FetchResult {
  return { html: '', tier, finalUrl: url, status, blocked: true, error }
}

/** Tier 1: static fetch with realistic browser headers + one retry. */
async function tier1(url: string): Promise<FetchResult> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, {
        headers: REAL_BROWSER_HEADERS,
        redirect: 'follow',
        signal: AbortSignal.timeout(15000),
      })
      if (!res.ok) {
        if (attempt === 1) return fail(1, url, `HTTP ${res.status} ${res.statusText}`, res.status)
        await sleep(1500)
        continue
      }
      const html = await res.text()
      const blocked = looksBlocked(html)
      if (blocked && attempt === 0) { await sleep(1500); continue }
      return { html, tier: 1, finalUrl: res.url || url, status: res.status, blocked, error: blocked ? 'Blocked/challenge page' : null }
    } catch (e: any) {
      if (attempt === 1) return fail(1, url, e.message)
      await sleep(1500)
    }
  }
  return fail(1, url, 'Unreachable after retry')
}

/** Tier 2: Cloudflare Browser Rendering. 10 min/day free — use sparingly. */
async function tier2(url: string, env: LadderEnv): Promise<FetchResult> {
  if (!env.BROWSER) return fail(2, url, 'Browser binding unavailable')
  let browser: LaunchedBrowser | null = null
  try {
    browser = await env.BROWSER.launch()
    const page = await browser.newPage()
    if (page.setUserAgent) await page.setUserAgent(BROWSER_UA)
    await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 })
    const html = await page.content()
    const blocked = looksBlocked(html)
    return { html, tier: 2, finalUrl: url, status: 200, blocked, error: blocked ? 'Blocked after render' : null }
  } catch (e: any) {
    return fail(2, url, e.message)
  } finally {
    // Always close — browser minutes are the scarce resource
    if (browser) { try { await browser.close() } catch { /* already closed */ } }
  }
}

/** Tier 3: user-supplied ScraperAPI key (1k credits/mo free, no card). */
async function tier3(url: string, env: LadderEnv): Promise<FetchResult> {
  const key = env.SCRAPERAPI_KEY
  if (!key) return fail(3, url, 'No SCRAPERAPI_KEY set')
  try {
    const res = await fetch(
      `https://api.scraperapi.com/?api_key=${encodeURIComponent(key)}&url=${encodeURIComponent(url)}&render=true`,
      { headers: REAL_BROWSER_HEADERS, redirect: 'follow' }
    )
    if (!res.ok) return fail(3, url, `ScraperAPI HTTP ${res.status}`, res.status)
    const html = await res.text()
    const blocked = looksBlocked(html)
    return { html, tier: 3, finalUrl: url, status: 200, blocked, error: blocked ? 'Blocked via ScraperAPI' : null }
  } catch (e: any) {
    return fail(3, url, e.message)
  }
}

export interface LadderOptions {
  useBrowser?: boolean   // force Tier 2 first (recipe opted in)
  maxTier?: 1 | 2 | 3    // hard stop (default: 3 if SCRAPERAPI_KEY set, else 2)
}

/** Useful: did this HTML actually contain extractable content? */
export function htmlUsable(r: FetchResult): boolean {
  return !r.blocked && r.html.length > 1000
}

/**
 * Run the ladder: static → browser → external.
 * Returns the first tier that yields unblocked, usable HTML.
 */
export async function fetchPageHtml(
  url: string,
  env: LadderEnv,
  options: LadderOptions = {}
): Promise<FetchResult> {
  const maxTier = options.maxTier ?? (env.SCRAPERAPI_KEY ? 3 : 2)

  if (options.useBrowser) {
    // Recipe explicitly wants JS rendering: browser first, static as backup
    const r2 = await tier2(url, env)
    if (htmlUsable(r2)) return r2
    if (maxTier >= 1) {
      const r1 = await tier1(url)
      if (htmlUsable(r1)) return r1
    }
    if (maxTier >= 3) return await tier3(url, env)
    return r2
  }

  const r1 = await tier1(url)
  if (htmlUsable(r1)) return r1
  if (maxTier >= 2) {
    const r2 = await tier2(url, env)
    if (htmlUsable(r2)) return r2
  }
  if (maxTier >= 3) return await tier3(url, env)
  return r1
}
