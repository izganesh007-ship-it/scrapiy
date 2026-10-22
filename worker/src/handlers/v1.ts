/**
 * API key management (dashboard) + public /api/v1 endpoints (key-authed).
 */
import { jsonResponse, validateRequest, type CloudflareEnv } from './utils'
import {
  createApiKey, listApiKeys, revokeApiKey, verifyApiKey,
  getScrapeJob, insertScrapeJob, updateScrapeJob,
} from '../db/database'
import { runRecipeFetch } from '../lib/recipeRunner'
import { getRecipe } from '../db/database'

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
}

// ---- Dashboard key management ----

export async function keysListHandler(env: CloudflareEnv): Promise<Response> {
  const keys = await listApiKeys(env.DB)
  // Full hash is safe to return: it's a one-way SHA-256 of a 32-byte random key.
  // The frontend masks it for display and sends the full hash back for revoke.
  return jsonResponse({ keys: keys.map(k => ({
    key_hash: k.key_hash,
    name: k.name,
    requests_today: k.requests_today,
    last_used_at: k.last_used_at,
    created_at: k.created_at,
    revoked: !!k.revoked,
  })) })
}

export async function keyCreateHandler(req: Request, env: CloudflareEnv): Promise<Response> {
  try {
    const body = await req.json() as { name?: string }
    const name = (body.name || 'default').slice(0, 60)
    const raw = 'sk_live_' + [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('')
    await createApiKey(env.DB, await sha256Hex(raw), name)
    // Shown exactly once — we only store the hash
    return jsonResponse({ key: raw, name }, 201)
  } catch (e: any) {
    return jsonResponse({ error: e.message }, 500)
  }
}

export async function keyRevokeHandler(env: CloudflareEnv, keyHash: string): Promise<Response> {
  await revokeApiKey(env.DB, keyHash)
  return jsonResponse({ success: true })
}

// ---- Public v1 API ----

function keyFromRequest(req: Request): string | null {
  const header = req.headers.get('X-API-Key') || req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '')
  return header || null
}

async function requireKey(req: Request, env: CloudflareEnv): Promise<Response | null> {
  const key = keyFromRequest(req)
  if (!key) return jsonResponse({ error: 'X-API-Key header required' }, 401)
  // Owner master key: unlimited, never counted, lives only in wrangler secrets
  if (env.OWNER_KEY && key === env.OWNER_KEY) return null
  const result = await verifyApiKey(env.DB, key)
  if (result.error) return jsonResponse({ error: result.error }, result.error.includes('limit') ? 429 : 401)
  return null
}

/** POST /api/v1/run {recipe_id, url?} — run a recipe, wait for results (sync like ScraperAPI). */
export async function v1RunHandler(req: Request, env: CloudflareEnv): Promise<Response> {
  const authFailure = await requireKey(req, env)
  if (authFailure) return authFailure

  try {
    const body = await validateRequest(req) as { recipe_id?: string; url?: string }
    if (!body.recipe_id) return jsonResponse({ error: 'recipe_id required' }, 400)

    const recipe = await getRecipe(env.DB, body.recipe_id)
    if (!recipe) return jsonResponse({ error: 'Recipe not found' }, 404)

    const url = body.url || recipe.url
    const selectors = JSON.parse(recipe.selectors_json || '{}')
    const pagination = JSON.parse(recipe.pagination_json || '{"mode":"none"}')

    const jobId = crypto.randomUUID()
    await insertScrapeJob(env.DB, {
      jobId, url, status: 'running', progress: 10, results: [], error: null,
      createdAt: new Date().toISOString(),
    })

    const run = await runRecipeFetch(env, {
      url,
      selectors: selectors.item ? selectors : null,
      pagination,
      useBrowser: !!recipe.use_browser,
    })

    await updateScrapeJob(env.DB, jobId, {
      status: 'completed', progress: 100,
      results: run.items as any[],
      error: run.items.length === 0 ? (run.error || 'No items extracted') : null,
      completedAt: new Date().toISOString(),
    })

    return jsonResponse({
      success: true, job_id: jobId, tier: run.tier, pages: run.pages, count: run.items.length,
      items: run.items,
    })
  } catch (e: any) {
    return jsonResponse({ error: e.message }, 500)
  }
}

/** GET /api/v1/runs/:id — job status + results. */
export async function v1RunStatusHandler(req: Request, env: CloudflareEnv, jobId: string): Promise<Response> {
  const authFailure = await requireKey(req, env)
  if (authFailure) return authFailure

  const job = await getScrapeJob(env.DB, jobId)
  if (!job) return jsonResponse({ error: 'Run not found' }, 404)
  return jsonResponse({
    job_id: job.job_id, url: job.url, status: job.status, progress: job.progress,
    results: job.data ? JSON.parse(job.data) : [], error: job.error,
    created_at: job.created_at, completed_at: job.completed_at,
  })
}

/** GET /api/v1/runs/:id/export?format=csv|json */
export async function v1RunExportHandler(req: Request, env: CloudflareEnv, jobId: string): Promise<Response> {
  const authFailure = await requireKey(req, env)
  if (authFailure) return authFailure

  const url = new URL(req.url)
  const format = url.searchParams.get('format') || 'csv'

  const job = await getScrapeJob(env.DB, jobId)
  if (!job) return jsonResponse({ error: 'Run not found' }, 404)

  const results = job.data ? JSON.parse(job.data) : []
  if (format === 'json') {
    return new Response(JSON.stringify(results, null, 2), {
      headers: { 'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="${jobId}.json"` },
    })
  }
  // Reuse the dashboard CSV exporter (KV-backed)
  const { exportCsvHandler } = await import('./export')
  return exportCsvHandler(env.EXPORTS, jobId)
}
