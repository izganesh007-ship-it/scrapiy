<template>
  <div class="container mx-auto px-4 py-8 max-w-5xl">
    <div class="flex items-center justify-between mb-6">
      <div>
        <h1 class="text-2xl font-bold text-gray-900">API Keys</h1>
        <p class="text-gray-600 text-sm mt-1">Full keys live in <b>your browser only</b> (localStorage). The server keeps only a SHA-256 hash — no page can reveal a key again.</p>
      </div>
      <button @click="createKey()" :disabled="creating" class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium disabled:opacity-50">
        {{ creating ? 'Creating…' : '+ New Key' }}
      </button>
    </div>

    <!-- Show-once banner -->
    <div v-if="newKey" class="bg-yellow-50 border border-yellow-300 rounded-lg p-4 mb-6">
      <p class="font-medium text-yellow-800 text-sm mb-1">Copy now — stored in this browser only, never shown again:</p>
      <div class="flex gap-2">
        <code class="text-sm bg-white border px-3 py-2 rounded block break-all flex-1">{{ newKey }}</code>
        <button @click="copyText(newKey)" class="px-3 py-2 bg-blue-600 text-white rounded text-sm">Copy</button>
      </div>
      <p class="text-green-700 text-xs mt-2">✓ Saved to this browser. The Demo tab uses it automatically — other devices/visitors can't see it.</p>
    </div>

    <!-- Browser-local key -->
    <div class="bg-white rounded-lg shadow p-5 mb-6">
      <h3 class="font-semibold text-sm mb-1">Key saved in this browser</h3>
      <p class="text-xs text-gray-500 mb-3">Stored in localStorage on this device only; used automatically by the Demo tab and code samples.</p>
      <div v-if="localKey" class="flex items-center gap-2 flex-wrap">
        <code class="text-sm bg-gray-100 px-3 py-2 rounded">{{ showFull ? localKey : maskKey(localKey) }}</code>
        <button @click="showFull = !showFull" class="px-3 py-2 bg-gray-100 rounded text-sm">{{ showFull ? 'Hide' : 'Reveal' }}</button>
        <button @click="copyText(localKey)" class="px-3 py-2 bg-gray-100 rounded text-sm">Copy</button>
        <button @click="forget()" class="px-3 py-2 bg-red-100 text-red-600 rounded text-sm">Remove from browser</button>
      </div>
      <p v-else class="text-gray-400 text-sm">Nothing stored yet — create a key above.</p>
    </div>

    <!-- All keys (hash + usage only — safe to show) -->
    <div class="mb-2">
      <h2 class="font-semibold text-gray-900">All keys (hashes & usage only)</h2>
      <p class="text-gray-400 text-xs">Full key material is never stored server-side — only SHA-256 hashes. Revoked keys can't be recovered.</p>
    </div>
    <div v-if="loading" class="text-gray-500">Loading…</div>
    <div v-else-if="keys.length === 0" class="bg-white rounded-lg shadow p-12 text-center text-gray-500">
      No keys yet. Create one to use the <code>/api/v1</code> endpoints.
    </div>
    <div v-else class="bg-white rounded-lg shadow overflow-hidden">
      <table class="w-full text-sm">
        <thead>
          <tr class="bg-gray-50 border-b text-left text-sm text-gray-600">
            <th class="px-4 py-3">Name</th>
            <th class="px-4 py-3">Key (hash prefix)</th>
            <th class="px-4 py-3">Today</th>
            <th class="px-4 py-3">Last used</th>
            <th class="px-4 py-3">Status</th>
            <th class="px-4 py-3"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="k in keys" :key="k.key_hash" class="border-b">
            <td class="px-4 py-3">{{ k.name }}</td>
            <td class="px-4 py-3 font-mono text-xs text-gray-400" :title="k.key_hash">{{ k.key_hash.slice(0, 12) }}…{{ k.key_hash.slice(-4) }}</td>
            <td class="px-4 py-3">{{ k.requests_today }}/1000</td>
            <td class="px-4 py-3 text-xs text-gray-500">{{ k.last_used_at ? new Date(k.last_used_at).toLocaleString() : 'never' }}</td>
            <td class="px-4 py-3">
              <span :class="k.revoked ? 'text-red-500' : 'text-green-600'">{{ k.revoked ? 'revoked' : 'active' }}</span>
            </td>
            <td class="px-4 py-3 text-right">
              <button v-if="!k.revoked" @click="revoke(k.key_hash)" class="text-red-500 text-sm hover:underline">Revoke</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { getStoredKey, storeKey, clearStoredKey, maskKey } from '../composables/apiKey'

const keys = ref<any[]>([])
const loading = ref(true)
const creating = ref(false)
const newKey = ref('')
const showFull = ref(false)
const localKey = ref(getStoredKey())

async function load() {
  try {
    const res = await fetch('/api/keys').then(r => r.json())
    keys.value = res.keys || []
  } finally {
    loading.value = false
  }
}

async function createKey() {
  creating.value = true
  newKey.value = ''
  try {
    const res = await fetch('/api/keys', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `browser-${new Date().toISOString().slice(0, 10)}` }),
    })
    const json = await res.json()
    if (!res.ok) throw new Error(json.error || 'Failed')
    newKey.value = json.key
    storeKey(json.key)          // stays in THIS browser only
    localKey.value = json.key
    await load()
  } finally {
    creating.value = false
  }
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
}

async function revoke(hash: string) {
  await fetch(`/api/keys/${hash}`, { method: 'DELETE' })
  // If this browser held the revoked key, forget it locally too
  const stored = getStoredKey()
  if (stored) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(stored))
    const hex = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
    if (hex === hash) { clearStoredKey(); localKey.value = '' }
  }
  await load()
}

async function copyText(text: string) {
  try { await navigator.clipboard.writeText(text) } catch { /* clipboard unavailable */ }
}

onMounted(load)
</script>