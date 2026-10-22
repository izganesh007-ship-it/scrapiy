/**
 * Render + preview endpoints for the visual selector.
 * POST /api/render  {url, use_browser?}                 → {html, tier}   (raw HTML for the iframe)
 * POST /api/preview {url, selectors, use_browser?}      → {items}        (live extraction preview)
 */
import { jsonResponse, validateRequest, type CloudflareEnv } from './utils'
import { fetchPageHtml } from '../lib/fetchLadder'
import { extractWithSelectors, extractAuto, type CustomSelectors } from '../lib/extract'

const PRIVATE_HOST_PATTERNS = [
  /^localhost$/i, /^127\./, /^10\./, /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./, /^169\.254\./, /^fc00:/i, /^fe80:/i, /^::1$/i, /^0\.0\.0\.0$/,
]

function isPrivateHost(url: string): boolean {
  try {
    return PRIVATE_HOST_PATTERNS.some(p => p.test(new URL(url).hostname.toLowerCase()))
  } catch {
    return true
  }
}

export async function renderHandler(req: Request, env: CloudflareEnv): Promise<Response> {
  try {
    const body = await req.json() as { url?: string; use_browser?: boolean }
    if (!body.url) return jsonResponse({ error: 'url required' }, 400)
    if (isPrivateHost(body.url)) return jsonResponse({ error: 'Access to private/internal URLs is blocked' }, 403)

    const result = await fetchPageHtml(body.url, env, { useBrowser: !!body.use_browser })
    return jsonResponse({
      html: result.html, tier: result.tier,
      blocked: result.blocked, error: result.error,
      success: !!result.html && !result.blocked,
    })
  } catch (e: any) {
    return jsonResponse({ error: e.message }, 500)
  }
}

export async function previewHandler(req: Request, env: CloudflareEnv): Promise<Response> {
  try {
    const body = await req.json() as {
      url?: string; selectors?: { item?: string; fields: Record<string, string> }; use_browser?: boolean; auto?: boolean
    }
    if (!body.url) return jsonResponse({ error: 'url required' }, 400)

    const result = await fetchPageHtml(body.url, env, { useBrowser: !!body.use_browser })
    if (!result.html) return jsonResponse({ error: result.error || 'Fetch failed', tier: result.tier }, 502)

    // Auto mode: no selectors given — let the detector find repeated cards itself
    if (body.auto || !body.selectors?.item) {
      const items = extractAuto(result.html, body.url, 12)
      return jsonResponse({
        success: true, tier: result.tier, mode: 'auto',
        count: items.length, selector: items[0]?.selector ?? null, items,
      })
    }

    const items = extractWithSelectors(result.html, body.url, body.selectors, 12)
    return jsonResponse({ success: true, tier: result.tier, mode: 'selectors', count: items.length, items })
  } catch (e: any) {
    return jsonResponse({ error: e.message }, 500)
  }
}
