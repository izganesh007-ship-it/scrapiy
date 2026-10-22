/**
 * Recipe management + run endpoints (dashboard, no API key needed).
 */
import { jsonResponse, validateRequest, type CloudflareEnv } from './utils'
import { createRecipe, getRecipe, listRecipes, deleteRecipe, upsertSchedule, deleteSchedule, listSchedules, insertScrapeJob, updateScrapeJob } from '../db/database'
import { runRecipeFetch } from '../lib/recipeRunner'

function publicRecipe(r: any) {
  return {
    id: r.id,
    name: r.name,
    url: r.url,
    selectors: JSON.parse(r.selectors_json || '{}'),
    pagination: JSON.parse(r.pagination_json || '{"mode":"none"}'),
    use_browser: !!r.use_browser,
    created_at: r.created_at,
  }
}

export async function recipesListHandler(db: CloudflareEnv['DB']): Promise<Response> {
  try {
    const recipes = await listRecipes(db)
    const schedules = await listSchedules(db)
    const byRecipe = new Map(schedules.map(s => [s.recipe_id, s]))
    return jsonResponse({ recipes: recipes.map(r => {
      const sched = byRecipe.get(r.id)
      return {
        ...publicRecipe(r),
        schedule: sched ? {
          interval_hours: sched.interval_hours,
          next_run_at: sched.next_run_at,
          enabled: !!sched.enabled,
        } : null,
      }
    }) })
  } catch (e: any) {
    return jsonResponse({ error: e.message }, 500)
  }
}

export async function recipeCreateHandler(req: Request, env: CloudflareEnv): Promise<Response> {
  try {
    const body = await req.json() as {
      name?: string; url?: string; selectors?: unknown; pagination?: unknown; useBrowser?: boolean; intervalHours?: number
    }
    if (!body.name || !body.url) return jsonResponse({ error: 'name and url required' }, 400)

    const id = crypto.randomUUID()
    await createRecipe(env.DB, {
      id,
      name: body.name,
      url: body.url,
      // Default item selector: first repeated card container auto-detected downstream;
      // visual selector UI always sends explicit item+fields.
      selectors: body.selectors ?? {},
      pagination: body.pagination ?? { mode: 'none' },
      useBrowser: !!body.useBrowser,
    })
    if (typeof body.intervalHours === 'number' && body.intervalHours > 0) {
      await upsertSchedule(env.DB, { recipeId: id, intervalHours: body.intervalHours })
    }
    return jsonResponse({ success: true, id }, 201)
  } catch (e: any) {
    return jsonResponse({ error: e.message }, 500)
  }
}

export async function recipeGetHandler(env: CloudflareEnv, id: string): Promise<Response> {
  const r = await getRecipe(env.DB, id)
  if (!r) return jsonResponse({ error: 'Recipe not found' }, 404)
  return jsonResponse({ recipe: publicRecipe(r) })
}

export async function recipeDeleteHandler(env: CloudflareEnv, id: string): Promise<Response> {
  await deleteRecipe(env.DB, id)
  return jsonResponse({ success: true })
}

export async function recipeUpdateHandler(req: Request, env: CloudflareEnv, id: string): Promise<Response> {
  try {
    const existing = await getRecipe(env.DB, id)
    if (!existing) return jsonResponse({ error: 'Recipe not found' }, 404)
    const body = await req.json() as {
      name?: string; url?: string; selectors?: unknown; pagination?: unknown; useBrowser?: boolean; intervalHours?: number | null
    }
    const now = new Date().toISOString()
    await env.DB.prepare(
      `UPDATE recipes SET name = ?, url = ?, selectors_json = ?, pagination_json = ?, use_browser = ?, updated_at = ? WHERE id = ?`
    ).bind(
      body.name ?? existing.name,
      body.url ?? existing.url,
      body.selectors !== undefined ? JSON.stringify(body.selectors) : existing.selectors_json,
      body.pagination !== undefined ? JSON.stringify(body.pagination) : existing.pagination_json,
      body.useBrowser === undefined ? existing.use_browser : (body.useBrowser ? 1 : 0),
      now, id
    ).run()

    if (typeof body.intervalHours === 'number' && body.intervalHours > 0) {
      await upsertSchedule(env.DB, { recipeId: id, intervalHours: body.intervalHours })
    } else if (body.intervalHours === 0 || body.intervalHours === null) {
      await deleteSchedule(env.DB, id)
    }
    return jsonResponse({ success: true })
  } catch (e: any) {
    return jsonResponse({ error: e.message }, 500)
  }
}

/** Run a recipe: fetch via ladder, extract, persist job, return items. */
export async function recipeRunHandler(req: Request, env: CloudflareEnv, id: string): Promise<Response> {
  try {
    const recipe = await getRecipe(env.DB, id)
    if (!recipe) return jsonResponse({ error: 'Recipe not found' }, 404)

    const selectors = JSON.parse(recipe.selectors_json || '{}')
    const pagination = JSON.parse(recipe.pagination_json || '{"mode":"none"}')

    const jobId = crypto.randomUUID()
    await insertScrapeJob(env.DB, {
      jobId, url: recipe.url, status: 'running', progress: 10, results: [], error: null,
      createdAt: new Date().toISOString(),
    })

    const run = await runRecipeFetch(env, {
      url: recipe.url,
      selectors: selectors.item ? selectors : null,
      pagination,
      useBrowser: !!recipe.use_browser,
    })

    await updateScrapeJob(env.DB, jobId, {
      status: 'completed',
      progress: 100,
      results: run.items as any[],
      error: run.items.length === 0 ? (run.error || 'No items extracted') : null,
      completedAt: new Date().toISOString(),
    })

    return jsonResponse({
      success: true, job_id: jobId, items: run.items, tier: run.tier, pages: run.pages,
    })
  } catch (e: any) {
    return jsonResponse({ error: e.message }, 500)
  }
}

// Schedule endpoints
export async function scheduleSetHandler(req: Request, env: CloudflareEnv, recipeId: string): Promise<Response> {
  try {
    const body = await req.json() as { intervalHours?: number; enabled?: boolean }
    if (typeof body.intervalHours !== 'number' || body.intervalHours < 1) {
      return jsonResponse({ error: 'intervalHours >= 1 required (0 to disable)' }, 400)
    }
    if (body.intervalHours === 0 || body.enabled === false) {
      await deleteSchedule(env.DB, recipeId)
      return jsonResponse({ success: true, schedule: null })
    }
    await upsertSchedule(env.DB, { recipeId, intervalHours: body.intervalHours, enabled: body.enabled })
    return jsonResponse({ success: true })
  } catch (e: any) {
    return jsonResponse({ error: e.message }, 500)
  }
}

export async function schedulesListHandler(env: CloudflareEnv): Promise<Response> {
  return jsonResponse({ schedules: await listSchedules(env.DB) })
}
