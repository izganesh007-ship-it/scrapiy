import type { D1Database, Queue, KVNamespace, ExecutionContext } from '@cloudflare/workers-types'
import { scanHandler } from './handlers/scanHandler'
import { jobsListHandler, jobsGetHandler, scrapeHandler, updateJobStatusHandler, completeJobHandler, failJobHandler } from './handlers/jobs'
import { exportCsvHandler, generateCsvExport } from './handlers/export'
import { jsonResponse } from './handlers/utils'
import {
  recipesListHandler, recipeCreateHandler, recipeGetHandler, recipeDeleteHandler,
  recipeUpdateHandler, recipeRunHandler, scheduleSetHandler, schedulesListHandler,
} from './handlers/recipes'
import { keysListHandler, keyCreateHandler, keyRevokeHandler, v1RunHandler, v1RunStatusHandler, v1RunExportHandler } from './handlers/v1'
import { renderHandler, previewHandler } from './handlers/render'
import { runRecipeFetch } from './lib/recipeRunner'
import { dueSchedules, markScheduleRan, getRecipe, insertScrapeJob, updateScrapeJob } from './db/database'
import type { CloudflareEnv } from './handlers/utils'

export interface Env {
  DB: import('@cloudflare/workers-types').D1Database
  QUEUE: Queue
  EXPORTS: KVNamespace
  BROWSER?: import('./lib/fetchLadder').BrowserBinding
  SCRAPERAPI_KEY?: string
  RESEND_API_KEY?: string
  OWNER_KEY?: string
  API_BASE: string
}

const UUID_RE = '[0-9a-f-]{36}'

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname

    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-API-Key, Authorization',
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders })
    }

    try {
      if (path === '/health') {
        return jsonResponse({ status: 'ok', timestamp: new Date().toISOString() })
      }

      if (path === '/api/scan' && request.method === 'POST') {
        return await scanHandler(request, env, ctx)
      }

      // Visual selector support
      if (path === '/api/render' && request.method === 'POST') {
        return await renderHandler(request, env)
      }
      if (path === '/api/preview' && request.method === 'POST') {
        return await previewHandler(request, env)
      }

      // Recipes
      if (path === '/api/recipes' && request.method === 'GET') {
        return await recipesListHandler(env.DB)
      }
      if (path === '/api/recipes' && request.method === 'POST') {
        return await recipeCreateHandler(request, env)
      }
      let m = path.match(/^\/api\/recipes\/([0-9a-f-]+)$/)
      if (m && request.method === 'GET') return await recipeGetHandler(env, m[1])
      if (m && request.method === 'DELETE') return await recipeDeleteHandler(env, m[1])
      if (m && request.method === 'PUT') return await recipeUpdateHandler(request, env, m[1])
      m = path.match(/^\/api\/recipes\/([0-9a-f-]+)\/run$/)
      if (m && request.method === 'POST') return await recipeRunHandler(request, env, m[1])
      m = path.match(/^\/api\/recipes\/([0-9a-f-]+)\/schedule$/)
      if (m && request.method === 'POST') return await scheduleSetHandler(request, env, m[1])
      if (path === '/api/schedules' && request.method === 'GET') {
        return await schedulesListHandler(env)
      }

      // Dashboard API key management
      if (path === '/api/keys' && request.method === 'GET') return await keysListHandler(env)
      if (path === '/api/keys' && request.method === 'POST') return await keyCreateHandler(request, env)
      m = path.match(/^\/api\/keys\/([0-9a-f]{64})$/)
      if (m && request.method === 'DELETE') return await keyRevokeHandler(env, m[1])

      // Public v1 API (X-API-Key auth)
      if (path === '/api/v1/run' && request.method === 'POST') {
        return await v1RunHandler(request, env)
      }
      m = path.match(/^\/api\/v1\/runs\/([0-9a-f-]+)\/export$/)
      if (m && request.method === 'GET') {
        return await v1RunExportHandler(request, env, m[1])
      }
      m = path.match(/^\/api\/v1\/runs\/([0-9a-f-]+)$/)
      if (m && request.method === 'GET') {
        return await v1RunStatusHandler(request, env, m[1])
      }

      if (path === '/api/scrape' && request.method === 'POST') {
        return await scrapeHandler(request, env)
      }

      if (path === '/api/jobs' && request.method === 'GET') {
        return await jobsListHandler(env.DB)
      }

      const jobMatch = path.match(/^\/api\/jobs\/([0-9a-f-]+)$/)
      if (jobMatch && request.method === 'GET') {
        return await jobsGetHandler(env.DB, jobMatch[1])
      }

      // Playwright worker callbacks (kept for compatibility)
      const statusMatch = path.match(/^\/api\/jobs\/([0-9a-f-]+)\/status$/)
      if (statusMatch && request.method === 'PATCH') {
        return await updateJobStatusHandler(env.DB, statusMatch[1], await request.json())
      }
      const completeMatch = path.match(/^\/api\/jobs\/([0-9a-f-]+)\/complete$/)
      if (completeMatch && request.method === 'POST') {
        return await completeJobHandler(env.DB, completeMatch[1], await request.json())
      }
      const failMatch = path.match(/^\/api\/jobs\/([0-9a-f-]+)\/fail$/)
      if (failMatch && request.method === 'POST') {
        return await failJobHandler(env.DB, failMatch[1], await request.json())
      }

      const exportPostMatch = path.match(/^\/api\/export\/([0-9a-f-]+)\/csv$/)
      if (exportPostMatch && request.method === 'POST') {
        return await generateCsvExport(request, env, exportPostMatch[1])
      }
      const exportGetMatch = path.match(/^\/api\/export\/([0-9a-f-]+)\/csv$/)
      if (exportGetMatch && request.method === 'GET') {
        return await exportCsvHandler(env.EXPORTS, exportGetMatch[1])
      }

      return new Response('Not found', { status: 404, headers: corsHeaders })
    } catch (e: any) {
      console.error('Worker error:', e)
      return jsonResponse({ error: e.message }, 500)
    }
  },

  /**
   * Cron: runs every 15 min (see wrangler.jsonc triggers.crons).
   * Executes all due recipe schedules sequentially.
   */
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    try {
      const nowIso = new Date().toISOString()
      const due = await dueSchedules(env.DB, nowIso)
      for (const schedule of due) {
        try {
          const recipe = await getRecipe(env.DB, schedule.recipe_id)
          if (!recipe) { await markScheduleRan(env.DB, schedule.id, schedule.interval_hours); continue }

          const selectors = JSON.parse(recipe.selectors_json || '{}')
          const pagination = JSON.parse(recipe.pagination_json || '{"mode":"none"}')
          const run = await runRecipeFetch(env, {
            url: recipe.url,
            selectors: selectors.item ? selectors : null,
            pagination,
            useBrowser: !!recipe.use_browser,
          })

          const jobId = crypto.randomUUID()
          await insertScrapeJob(env.DB, {
            jobId, url: recipe.url, status: run.items.length ? 'completed' : 'failed',
            progress: 100, results: run.items as any[],
            error: run.items.length === 0 ? (run.error || 'No items') : null,
            createdAt: new Date().toISOString(),
          })
          await markScheduleRan(env.DB, schedule.id, schedule.interval_hours)
        } catch (e: any) {
          console.error('Scheduled recipe failed:', schedule.recipe_id, e.message)
        }
      }
    } catch (e: any) {
      console.error('Scheduled handler error:', e)
    }
  }
}