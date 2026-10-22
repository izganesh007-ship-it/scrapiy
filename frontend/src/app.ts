/**
 * Scrapiy Frontend - Vue 3 Composable for API calls
 */
import { reactive } from 'vue'

export interface ScanResultItem {
  name: string
  price: string
  link?: string
  selector: string
}

export interface Job {
  id: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'queued'
  progress: number
  results?: ScanResultItem[]
  error?: string
}

export interface ScanResponse {
  success: boolean
  jobId: string
  jobs: ScanResultItem[]
  error?: string
}

export interface JobListResponse {
  jobs: Array<{
    job_id: string
    url: string
    status: string
    progress: number
    results: ScanResultItem[]
    error: string | null
    created_at: string
    completed_at: string | null
  }>
}

const API_BASE = import.meta.env.VITE_API_BASE || ''

async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error || `HTTP ${res.status}`)
  }
  return res.json()
}

export function createApp() {
  const state = reactive({
    url: '',
    loading: false,
    error: '',
    scanResult: [] as ScanResultItem[],
    currentJob: null as Job | null,
  })

  let pollInterval: ReturnType<typeof setInterval> | null = null

  async function scanUrl() {
    state.loading = true
    state.error = ''
    state.scanResult = []
    state.currentJob = null

    try {
      const res = await api<ScanResponse>('/api/scan', {
        method: 'POST',
        body: JSON.stringify({ url: state.url }),
      })

      state.scanResult = res.jobs
      state.currentJob = {
        id: res.jobId,
        status: res.success ? 'completed' : 'failed',
        progress: 100,
        results: res.jobs,
        error: res.error,
      }
    } catch (e: any) {
      state.error = e.message
    } finally {
      state.loading = false
    }
  }

  async function pollJob(jobId: string) {
    if (pollInterval) clearInterval(pollInterval)
    pollInterval = setInterval(async () => {
      try {
        const res = await api<{ job_id: string; status: string; progress: number; results: ScanResultItem[]; error: string | null }>(`/api/jobs/${jobId}`)
        state.currentJob = {
          id: res.job_id,
          status: res.status as Job['status'],
          progress: res.progress,
          results: res.results,
          error: res.error || undefined,
        }
        if (res.status === 'completed' || res.status === 'failed') {
          if (pollInterval) clearInterval(pollInterval)
        }
      } catch (e) {
        console.error('Poll error:', e)
        if (pollInterval) clearInterval(pollInterval)
      }
    }, 2000)
  }

  async function exportCsv() {
    if (!state.currentJob?.id) return
    const jobId = state.currentJob.id
    try {
      await api<{ message: string; url: string }>(`/api/export/${jobId}/csv`, {
        method: 'POST',
        body: JSON.stringify({ jobId }),
      })
      // Trigger download via GET
      window.location.href = `${API_BASE}/api/export/${jobId}/csv`
    } catch (e: any) {
      state.error = e.message
    }
  }

  function resetScan() {
    state.url = ''
    state.scanResult = []
    state.currentJob = null
    state.error = ''
    state.loading = false
    if (pollInterval) clearInterval(pollInterval)
  }

  return { state, scanUrl, exportCsv, resetScan }
}

export type { ScanResultItem, Job, ScanResponse, JobListResponse }