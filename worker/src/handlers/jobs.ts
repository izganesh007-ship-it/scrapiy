import { jsonResponse, CloudflareEnv, type D1Database, type Queue } from './utils'
import { getScrapeJob, listJobs, updateScrapeJob } from '../db/database'

/**
 * GET /api/jobs - List recent scrape jobs
 */
export async function jobsListHandler(db: D1Database): Promise<Response> {
  try {
    const jobs = await listJobs(db, 50)
    return jsonResponse({ jobs: jobs.map(job => ({
      job_id: job.job_id,
      url: job.url,
      status: job.status,
      progress: job.progress,
      results: job.data ? JSON.parse(job.data) : [],
      error: job.error,
      created_at: job.created_at,
      completed_at: job.completed_at
    })) })
  } catch (e: any) {
    console.error('List jobs error:', e)
    return jsonResponse({ error: e.message }, 500)
  }
}

/**
 * GET /api/jobs/{jobId} - Get a specific job's status and results
 */
export async function jobsGetHandler(db: D1Database, jobId: string): Promise<Response> {
  try {
    const job = await getScrapeJob(db, jobId)

    if (!job) {
      return jsonResponse({ error: 'Job not found' }, 404)
    }

    return jsonResponse({
      job_id: job.job_id,
      url: job.url,
      status: job.status,
      progress: job.progress,
      results: job.data ? JSON.parse(job.data) : [],
      error: job.error,
      created_at: job.created_at,
      completed_at: job.completed_at
    })
  } catch (e: any) {
    console.error('Get job error:', e)
    return jsonResponse({ error: e.message }, 500)
  }
}

/**
 * PATCH /api/jobs/{jobId}/status - Update job status/progress (Playwright callback)
 */
export async function updateJobStatusHandler(
  db: D1Database,
  jobId: string,
  body: { status?: string; progress?: number }
): Promise<Response> {
  try {
    const updates: { status?: 'pending' | 'running' | 'completed' | 'failed'; progress?: number } = {}
    if (body.status) updates.status = body.status as 'pending' | 'running' | 'completed' | 'failed'
    if (typeof body.progress === 'number') updates.progress = body.progress

    await updateScrapeJob(db, jobId, updates)
    return jsonResponse({ message: 'Status updated', job_id: jobId })
  } catch (e: any) {
    console.error('Update status error:', e)
    return jsonResponse({ error: e.message }, 500)
  }
}

/**
 * POST /api/jobs/{jobId}/complete - Complete a job with results (Playwright callback)
 */
export async function completeJobHandler(
  db: D1Database,
  jobId: string,
  body: { results?: unknown[] }
): Promise<Response> {
  try {
    await updateScrapeJob(db, jobId, {
      status: 'completed',
      progress: 100,
      results: (body.results || []) as any[],
      completedAt: new Date().toISOString(),
    })
    return jsonResponse({ message: 'Job completed', job_id: jobId })
  } catch (e: any) {
    console.error('Complete job error:', e)
    return jsonResponse({ error: e.message }, 500)
  }
}

/**
 * POST /api/jobs/{jobId}/fail - Mark a job as failed (Playwright callback)
 */
export async function failJobHandler(
  db: D1Database,
  jobId: string,
  body: { error?: string }
): Promise<Response> {
  try {
    await updateScrapeJob(db, jobId, {
      status: 'failed',
      progress: 0,
      error: body.error || 'Unknown error',
      completedAt: new Date().toISOString(),
    })
    return jsonResponse({ message: 'Job marked as failed', job_id: jobId })
  } catch (e: any) {
    console.error('Fail job error:', e)
    return jsonResponse({ error: e.message }, 500)
  }
}

/**
 * POST /api/scrape - Trigger/continue a scraping job (dispatches to Playwright worker via Queue)
 */
export async function scrapeHandler(
  req: Request,
  env: CloudflareEnv
): Promise<Response> {
  try {
    const body = await req.json() as { jobId?: string; url?: string }
    const { jobId, url } = body

    if (!jobId || !url) {
      return jsonResponse({ error: 'jobId and url are required' }, 400)
    }

    await updateScrapeJob(env.DB, jobId, {
      status: 'running',
      progress: 10,
    })

    // Dispatch job to Playwright queue (consumed by Fly.io worker)
    try {
      await env.QUEUE.send({ jobId, url, method: 'playwright' })
      await updateScrapeJob(env.DB, jobId, {
        status: 'running',
        progress: 20,
      })
    } catch (q) {
      console.error('Queue dispatch failed:', q)
      await updateScrapeJob(env.DB, jobId, {
        status: 'running',
        progress: 0,
        error: 'Failed to dispatch to queue',
      })
    }

    return jsonResponse({ message: 'Scraping queued', job_id: jobId, status: 'running' })
  } catch (e: any) {
    console.error('Scrape handler error:', e)
    return jsonResponse({ error: e.message }, 500)
  }
}