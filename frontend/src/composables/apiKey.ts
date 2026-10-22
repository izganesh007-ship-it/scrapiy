/**
 * Browser-local API key storage. The full key NEVER leaves this browser
 * (except in the X-API-Key header of your own requests); the dashboard only
 * ever shows a server-computed hash prefix.
 */
const KEY_STORAGE = 'scrapiy_api_key'

export function getStoredKey(): string {
  try { return localStorage.getItem(KEY_STORAGE) || '' } catch { return '' }
}

export function storeKey(key: string): void {
  try { localStorage.setItem(KEY_STORAGE, key) } catch { /* private mode */ }
}

export function clearStoredKey(): void {
  try { localStorage.removeItem(KEY_STORAGE) } catch { /* private mode */ }
}

/** Masked display: sk_live_fb39…07a */
export function maskKey(key: string): string {
  if (!key) return ''
  return key.slice(0, 12) + '…' + key.slice(-4)
}