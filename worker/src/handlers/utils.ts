/**
 * Utility functions for Cloudflare Worker handlers
 */
import type { D1Database, Queue, KVNamespace, ExecutionContext } from '@cloudflare/workers-types'

export function jsonResponse(data: any, status: number = 200): Response {
  return new Response(JSON.stringify(data), {
    status: status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  })
}

export async function validateRequest(req: Request): Promise<any> {
  try {
    return await req.json()
  } catch {
    throw new Error('Invalid JSON body')
  }
}

export interface CloudflareEnv {
  DB: D1Database
  QUEUE: Queue
  EXPORTS: KVNamespace
  BROWSER?: import('../lib/fetchLadder').BrowserBinding
  SCRAPERAPI_KEY?: string
  RESEND_API_KEY?: string
  OWNER_KEY?: string   // master key: unlimited requests, bypasses the per-key counter
  API_BASE: string
}

export type { D1Database, Queue, KVNamespace, ExecutionContext }