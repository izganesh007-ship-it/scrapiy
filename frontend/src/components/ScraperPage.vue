<template>
  <div class="container mx-auto px-4 py-8 max-w-5xl">
    <header class="mb-8">
      <h1 class="text-3xl font-bold text-gray-900">Scrapiy</h1>
      <p class="text-gray-600 mt-2">Free web scraper - paste any product page URL and detect fields automatically</p>
    </header>

    <!-- URL Input -->
    <div class="bg-white rounded-lg shadow p-6 mb-6">
      <label class="block text-sm font-medium text-gray-700 mb-2">Enter Product Page URL</label>
      <div class="flex gap-3">
        <input
          v-model="state.url"
          @keyup.enter="scanUrl()"
          placeholder="https://example.com/products"
          class="flex-1 px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
        />
        <button
          @click="scanUrl()"
          :disabled="state.loading || !state.url.trim()"
          class="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
        >
          {{ state.loading ? 'Scanning...' : 'Scan Website' }}
        </button>
      </div>
      <p v-if="state.error" class="text-red-500 mt-3 text-sm">{{ state.error }}</p>
    </div>

    <!-- Scan Results / Field Detection -->
    <div v-if="state.scanResult && state.scanResult.length" class="bg-white rounded-lg shadow p-6 mb-6">
      <h2 class="text-lg font-semibold mb-4">
        Detected Fields ({{ state.scanResult.length }} items)
      </h2>
      <div class="overflow-x-auto">
        <table class="w-full border-collapse">
          <thead>
            <tr class="bg-gray-50 border-b">
              <th class="px-4 py-3 text-left text-sm font-medium text-gray-600">Name</th>
              <th class="px-4 py-3 text-left text-sm font-medium text-gray-600">Price</th>
              <th class="px-4 py-3 text-left text-sm font-medium text-gray-600">Link</th>
              <th class="px-4 py-3 text-left text-sm font-medium text-gray-600">Selector</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(item, idx) in state.scanResult" :key="idx" class="border-b hover:bg-gray-50">
              <td class="px-4 py-3 text-sm font-medium text-blue-600">{{ item.name }}</td>
              <td class="px-4 py-3 text-sm">{{ item.price }}</td>
              <td class="px-4 py-3 text-sm">
                <a v-if="item.link" :href="item.link" target="_blank" class="text-blue-500 hover:underline">
                  View
                </a>
              </td>
              <td class="px-4 py-3 text-xs text-gray-500">{{ item.selector }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="mt-4 flex gap-3">
        <button
          @click="exportCsv()"
          class="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 font-medium text-sm"
        >
          Download CSV
        </button>
        <button
          @click="resetScan()"
          class="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 font-medium text-sm"
        >
          New Scan
        </button>
      </div>
    </div>

    <!-- Job Status -->
    <div v-if="state.currentJob" class="bg-white rounded-lg shadow p-6 mb-6">
      <div class="flex items-center justify-between mb-2">
        <h2 class="text-lg font-semibold">Job {{ state.currentJob.id.slice(0, 8) }}</h2>
        <span :class="statusBadge(state.currentJob.status)">{{ state.currentJob.status }}</span>
      </div>
      <div class="w-full bg-gray-200 rounded-full h-2">
        <div
          class="bg-blue-600 h-2 rounded-full transition-all duration-300"
          :style="{ width: (state.currentJob.progress || 0) + '%' }"
        />
      </div>
      <p class="text-sm text-gray-500 mt-2">{{ state.currentJob.progress || 0 }}% complete</p>
    </div>

    <!-- Empty State -->
    <div v-if="!state.url && !state.loading" class="bg-white rounded-lg shadow p-12 text-center">
      <p class="text-gray-500 text-lg">Paste a URL above to start scraping</p>
      <p class="text-gray-400 text-sm mt-2">Supports static HTML, JS-rendered, and paginated sites</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive } from 'vue'
import { createApp } from '../app'

const { state, scanUrl, exportCsv, resetScan } = createApp()

function statusBadge(status: string): string {
  const colors: Record<string, string> = {
    pending: 'bg-yellow-100 text-yellow-800 px-3 py-1 rounded-full text-sm font-medium',
    running: 'bg-blue-100 text-blue-800 px-3 py-1 rounded-full text-sm font-medium',
    completed: 'bg-green-100 text-green-800 px-3 py-1 rounded-full text-sm font-medium',
    failed: 'bg-red-100 text-red-800 px-3 py-1 rounded-full text-sm font-medium',
    queued: 'bg-purple-100 text-purple-800 px-3 py-1 rounded-full text-sm font-medium',
  }
  return colors[status] || 'bg-gray-100 text-gray-800 px-3 py-1 rounded-full text-sm font-medium'
}
</script>