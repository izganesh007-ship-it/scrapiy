import * as cheerio from 'cheerio'
import { v4 as uuidv4 } from 'uuid'
import { jsonResponse, validateRequest, CloudflareEnv } from './utils'
import { fetchPageHtml } from '../lib/fetchLadder'
import { extractAuto, type Card } from '../lib/extract'
import { insertScrapeJob, updateScrapeJob } from '../db/database'

export async function scanHandler(req: Request, env: CloudflareEnv, ctx: ExecutionContext): Promise<Response> {
  try {
    const body = await req.json() as { url?: string; use_browser?: boolean; recipe_id?: string }
    const url = body?.url as string | undefined

    if (!url || url.length < 5) {
      return jsonResponse({ error: 'Invalid URL', details: 'URL must be at least 5 characters' }, 400)
    }

    let parsedUrl: URL
    try {
      parsedUrl = new URL(url)
    } catch {
      return jsonResponse({ error: 'Invalid URL format' }, 400)
    }

    // SSRF protection: block private/internal IPs
    const hostname = parsedUrl.hostname.toLowerCase()
    const privatePatterns = [
      /^localhost$/i, /^127\./, /^10\./, /^172\.(1[6-9]|2\d|3[01])\./,
      /^192\.168\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
      /^169\.254\./, /^fc00:/i, /^fe80:/i, /^::1$/i, /^0\.0\.0\.0$/,
    ]
    if (privatePatterns.some(p => p.test(hostname))) {
      return jsonResponse({ error: 'Access to private/internal URLs is blocked' }, 403)
    }

    const jobId = uuidv4()
    await insertScrapeJob(env.DB, {
      jobId,
      url,
      status: 'running',
      progress: 10,
      results: [],
      error: null,
      createdAt: new Date().toISOString(),
    })

    let samples: Card[] = []
    let tier = 1

    try {
      // Ladder: static → browser render → optional external (ScraperAPI if key set)
      const result = await fetchPageHtml(url, env, { useBrowser: !!body?.use_browser })

      if (!result.html) {
        throw new Error(result.error || `Fetch failed (tier ${result.tier})`)
      }

      samples = extractAuto(result.html, url)
      tier = result.tier
    } catch (e: any) {
      console.error('Page fetch error:', e.message)
      await updateScrapeJob(env.DB, jobId, {
        status: 'failed',
        progress: 0,
        error: e.message,
      })
      return jsonResponse({ error: e.message, jobs: [], jobId }, 500)
    }

    await updateScrapeJob(env.DB, jobId, {
      status: 'completed',
      progress: 100,
      results: samples,
      error: samples.length === 0 ? 'No products detected' : null,
      completedAt: new Date().toISOString(),
    })

    return jsonResponse({ jobId, jobs: samples, success: true, tier })
  } catch (e: any) {
    console.error('Scan handler error:', e)
    return jsonResponse({ error: e.message, jobs: [] }, 500)
  }
}