import { jsonResponse, CloudflareEnv, type D1Database, type KVNamespace } from './utils'
import { getScrapeJob } from '../db/database'

/**
 * GET /api/export/{jobId}/csv - Export scrape results as CSV from KV
 */
export async function exportCsvHandler(
  exports: KVNamespace,
  jobId: string
): Promise<Response> {
  try {
    const csvContent = await exports.get(`results/${jobId}.csv`)

    if (!csvContent) {
      return jsonResponse({ error: 'Export not found' }, 404)
    }

    return new Response(csvContent, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="scrapiy-${jobId}.csv"`,
      },
    })
  } catch (e: any) {
    console.error('Export error:', e)
    return jsonResponse({ error: e.message }, 500)
  }
}

/**
 * POST /api/export/{jobId}/csv - Generate CSV export (async)
 * jobId from URL path (preferred) or JSON body; handles empty body
 */
export async function generateCsvExport(
  req: Request,
  env: CloudflareEnv,
  pathJobId?: string
): Promise<Response> {
  try {
    let jobId = pathJobId || null
    if (!jobId) {
      try {
        const text = await req.text()
        if (text.trim()) {
          const body = JSON.parse(text) as { jobId?: string; job_id?: string; id?: string }
          jobId = body.jobId || body.job_id || body.id || null
        }
      } catch {
        // empty/invalid body — fall through to 400
      }
    }

    if (!jobId) {
      return jsonResponse({ error: 'jobId required' }, 400)
    }

    const job = await getScrapeJob(env.DB, jobId)
    if (!job) {
      return jsonResponse({ error: 'Job not found' }, 404)
    }

    const results = job.data ? JSON.parse(job.data) : []

    // Generate CSV content with proper escaping
    const headers = ['name', 'price', 'link', 'selector']
    const escape = (v: string) => {
      const s = String(v ?? '')
      if (/["\,\n]/.test(s)) return '"' + s.replace(/\"/g, '""') + '"'
      return s
    }
    const csvRows = results.map((r: any) =>
      [r.name, r.price, r.link, r.selector].map(escape).join(',')
    )
    const csvContent = [headers.join(','), ...csvRows].join('\n')

    // Store in KV for later retrieval
    await env.EXPORTS.put(`results/${jobId}.csv`, csvContent)

    return jsonResponse({ message: 'CSV generated', url: `/api/export/${jobId}/csv` })
  } catch (e: any) {
    console.error('Generate CSV error:', e)
    return jsonResponse({ error: e.message }, 500)
  }
}