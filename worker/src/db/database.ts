/**
 * Database layer for Scrapiy worker (D1 SQLite)
 */
import type { D1Database, D1Result } from '@cloudflare/workers-types'

export interface ScrapeJob {
  jobId: string
  url: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  progress: number
  results: any[]
  error: string | null
  createdAt: string
  completedAt?: string
}

interface ScrapeJobRow {
  job_id: string
  url: string
  status: string
  progress: number
  data: string | null
  error: string | null
  created_at: string
  completed_at: string | null
  recipe_id?: string | null
}

/**
 * Insert a new scrape job record
 */
export async function insertScrapeJob(db: D1Database, job: Partial<ScrapeJob & { recipeId?: string }>): Promise<void> {
  const jobId = job.jobId || crypto.randomUUID()

  await db.prepare(
    'INSERT INTO scraped_records (job_id, url, status, progress, data, error, created_at, recipe_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  )
    .bind(jobId, job.url || '', job.status || 'pending', job.progress || 0, JSON.stringify(job.results || []), job.error || null, job.createdAt || new Date().toISOString(), (job as any).recipeId ?? null)
    .run()
}

/**
 * Update an existing scrape job record
 */
export async function updateScrapeJob(db: D1Database, jobId: string, updates: Partial<ScrapeJob>): Promise<void> {
  // Build SET clause dynamically so partial updates never clobber existing columns with NULL
  const sets: string[] = []
  const values: (string | number | null)[] = []

  if (updates.status !== undefined) { sets.push('status = ?'); values.push(updates.status) }
  if (updates.progress !== undefined) { sets.push('progress = ?'); values.push(updates.progress) }
  if (updates.results !== undefined) { sets.push('data = ?'); values.push(JSON.stringify(updates.results)) }
  if (updates.error !== undefined) { sets.push('error = ?'); values.push(updates.error) }
  if (updates.completedAt !== undefined) { sets.push('completed_at = ?'); values.push(updates.completedAt) }

  if (sets.length === 0) return

  values.push(jobId)

  await db.prepare(
    `UPDATE scraped_records SET ${sets.join(', ')} WHERE job_id = ?`
  ).bind(...values).run()
}

/**
 * Retrieve a single scrape job by ID
 */
export async function getScrapeJob(db: D1Database, jobId: string): Promise<ScrapeJobRow | null> {
  const result = await db.prepare(
    'SELECT job_id, url, status, progress, data, error, created_at, completed_at FROM scraped_records WHERE job_id = ?'
  ).bind(jobId).first()
  return result as ScrapeJobRow | null
}

/**
 * List recent jobs (up to limit)
 */
/**
 * List recent jobs (up to limit)
 */
export async function listJobs(db: D1Database, limit: number = 50): Promise<ScrapeJobRow[]> {
  const result = await db.prepare(
    'SELECT job_id, url, status, progress, data, error, created_at, completed_at, recipe_id FROM scraped_records ORDER BY created_at DESC LIMIT ?'
  ).bind(limit).all()
  return (result as D1Result<Record<string, unknown>>).results as unknown as ScrapeJobRow[]
}

// ---- Recipes ----

export interface Recipe {
  id: string
  name: string
  url: string
  selectors_json: string
  pagination_json: string
  use_browser: number
  created_at: string
  updated_at: string
}

export async function createRecipe(db: D1Database, recipe: { id: string; name: string; url: string; selectors: unknown; pagination?: unknown; useBrowser?: boolean }): Promise<void> {
  const now = new Date().toISOString()
  await db.prepare(
    'INSERT INTO recipes (id, name, url, selectors_json, pagination_json, use_browser, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(
    recipe.id,
    recipe.name,
    recipe.url,
    JSON.stringify(recipe.selectors ?? {}),
    JSON.stringify(recipe.pagination ?? { mode: 'none' }),
    recipe.useBrowser ? 1 : 0,
    now,
    now
  ).run()
}

export async function getRecipe(db: D1Database, id: string): Promise<Recipe | null> {
  return (await db.prepare('SELECT * FROM recipes WHERE id = ?').bind(id).first()) as Recipe | null
}

export async function listRecipes(db: D1Database): Promise<Recipe[]> {
  const result = await db.prepare('SELECT * FROM recipes ORDER BY created_at DESC').all()
  return (result as D1Result<Record<string, unknown>>).results as unknown as Recipe[]
}

export async function deleteRecipe(db: D1Database, id: string): Promise<void> {
  await db.prepare('DELETE FROM schedules WHERE recipe_id = ?').bind(id).run()
  await db.prepare('DELETE FROM recipes WHERE id = ?').bind(id).run()
}

// ---- Schedules ----

export interface ScheduleRow {
  id: string
  recipe_id: string
  interval_hours: number
  next_run_at: string
  last_run_at: string | null
  enabled: number
  created_at: string
}

export async function upsertSchedule(db: D1Database, s: { recipeId: string; intervalHours: number; enabled?: boolean }): Promise<void> {
  const nowIso = new Date().toISOString()
  const nextRun = new Date(Date.now() + s.intervalHours * 3600_000).toISOString()
  // ponytail: delete+insert instead of ON CONFLICT — recipe_id lacks a UNIQUE index, not worth a migration
  await db.prepare('DELETE FROM schedules WHERE recipe_id = ?').bind(s.recipeId).run()
  await db.prepare(
    'INSERT INTO schedules (id, recipe_id, interval_hours, next_run_at, enabled, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(
    crypto.randomUUID(), s.recipeId, s.intervalHours, nextRun, s.enabled === false ? 0 : 1, nowIso
  ).run()
}

export async function deleteSchedule(db: D1Database, recipeId: string): Promise<void> {
  await db.prepare('DELETE FROM schedules WHERE recipe_id = ?').bind(recipeId).run()
}

export async function listSchedules(db: D1Database): Promise<ScheduleRow[]> {
  const result = await db.prepare('SELECT * FROM schedules ORDER BY created_at DESC').all()
  return (result as D1Result<Record<string, unknown>>).results as unknown as ScheduleRow[]
}

/** Schedules due to run right now (cron handler). */
export async function dueSchedules(db: D1Database, nowIso: string): Promise<ScheduleRow[]> {
  const result = await db.prepare(
    'SELECT * FROM schedules WHERE enabled = 1 AND next_run_at <= ? LIMIT 10'
  ).bind(nowIso).all()
  return (result as D1Result<Record<string, unknown>>).results as unknown as ScheduleRow[]
}

export async function markScheduleRan(db: D1Database, scheduleId: string, intervalHours: number): Promise<void> {
  const next = new Date(Date.now() + intervalHours * 3600_000).toISOString()
  await db.prepare(
    'UPDATE schedules SET last_run_at = ?, next_run_at = ? WHERE id = ?'
  ).bind(new Date().toISOString(), next, scheduleId).run()
}

// ---- API keys ----

export interface ApiKeyRow {
  key_hash: string
  name: string
  requests_date: string
  requests_today: number
  last_used_at: string | null
  created_at: string
  revoked: number
}

export async function createApiKey(db: D1Database, keyHash: string, name: string): Promise<void> {
  await db.prepare(
    'INSERT INTO api_keys (key_hash, name, requests_date, requests_today, created_at) VALUES (?, ?, ?, 0, ?)'
  ).bind(keyHash, name, new Date().toISOString().slice(0, 10), new Date().toISOString()).run()
}

export async function listApiKeys(db: D1Database): Promise<ApiKeyRow[]> {
  const result = await db.prepare('SELECT key_hash, name, requests_date, requests_today, last_used_at, created_at, revoked FROM api_keys ORDER BY created_at DESC').all()
  return (result as D1Result<Record<string, unknown>>).results as unknown as ApiKeyRow[]
}

export async function revokeApiKey(db: D1Database, keyHash: string): Promise<void> {
  await db.prepare('UPDATE api_keys SET revoked = 1 WHERE key_hash = ?').bind(keyHash).run()
}

export const API_KEY_DAILY_LIMIT = 1000

/** Verify an API key and enforce the daily rate limit. Returns error message or null. */
export async function verifyApiKey(db: D1Database, key: string): Promise<{ error?: string; name?: string }> {
  const hash = await sha256Hex(key)
  const row = (await db.prepare(
    'SELECT key_hash, name, requests_date, requests_today, revoked FROM api_keys WHERE key_hash = ?'
  ).bind(hash).first()) as ApiKeyRow | null
  if (!row || row.revoked) return { error: 'Invalid API key' }

  const today = new Date().toISOString().slice(0, 10)
  let used = row.requests_today
  if (row.requests_date !== today) used = 0
  if (used >= API_KEY_DAILY_LIMIT) return { error: `Daily limit of ${API_KEY_DAILY_LIMIT} requests reached` }

  if (row.requests_date === today) {
    await db.prepare('UPDATE api_keys SET requests_today = requests_today + 1, last_used_at = ? WHERE key_hash = ?').bind(new Date().toISOString(), hash).run()
  } else {
    await db.prepare('UPDATE api_keys SET requests_date = ?, requests_today = 1, last_used_at = ? WHERE key_hash = ?').bind(today, new Date().toISOString(), hash).run()
  }
  return { name: row.name }
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
}