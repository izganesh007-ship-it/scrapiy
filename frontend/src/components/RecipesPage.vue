<template>
  <div class="container mx-auto px-4 py-8 max-w-5xl">
    <div class="flex items-center justify-between mb-6">
      <h1 class="text-2xl font-bold text-gray-900">Recipes</h1>
      <button @click="showCreate = !showCreate" class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium">
        {{ showCreate ? 'Cancel' : '+ New Recipe' }}
      </button>
    </div>

    <!-- Create form -->
    <div v-if="showCreate" class="bg-white rounded-lg shadow p-6 mb-6">
      <h2 class="font-semibold mb-4">New Recipe</h2>
      <div class="grid grid-cols-2 gap-4 mb-4">
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Name</label>
          <input v-model="form.name" placeholder="Laptop prices" class="w-full px-3 py-2 border rounded-lg" />
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">URL</label>
          <input v-model="form.url" placeholder="https://example.com/products" class="w-full px-3 py-2 border rounded-lg" />
        </div>
      </div>
      <div class="grid grid-cols-3 gap-4 mb-4">
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Item selector</label>
          <input v-model="form.item" placeholder=".product-card" class="w-full px-3 py-2 border rounded-lg text-sm" />
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Fields (name=selector per line)</label>
          <textarea v-model="form.fields" rows="3" placeholder="name=.title&#10;price=.price&#10;link=a@href" class="w-full px-3 py-2 border rounded-lg text-sm font-mono"></textarea>
        </div>
        <div class="space-y-3">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Pagination</label>
            <select v-model="form.mode" class="w-full px-3 py-2 border rounded-lg text-sm">
              <option value="none">None</option>
              <option value="next_link">Next link</option>
              <option value="page_param">Page parameter</option>
            </select>
          </div>
          <div v-if="form.mode === 'page_param'" class="flex gap-2">
            <input v-model="form.paramName" placeholder="page" class="w-20 px-2 py-1 border rounded text-sm" />
            <input v-model.number="form.maxPages" type="number" min="1" max="50" class="w-20 px-2 py-1 border rounded text-sm" />
          </div>
        </div>
      </div>
      <div class="flex items-center gap-4 mb-4">
        <label class="flex items-center gap-2 text-sm">
          <input type="checkbox" v-model="form.useBrowser" /> JS rendering (uses browser minutes)
        </label>
        <div class="flex items-center gap-2 text-sm">
          <span>Repeat every</span>
          <input v-model.number="form.intervalHours" type="number" min="0" class="w-16 px-2 py-1 border rounded" />
          <span>hours (0 = off)</span>
        </div>
      </div>
      <div class="flex gap-3">
        <button @click="createRecipe()" :disabled="!form.name || !form.url || saving" class="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium disabled:opacity-50">
          {{ saving ? 'Saving...' : 'Save Recipe' }}
        </button>
        <button @click="previewFields()" class="px-4 py-2 bg-gray-200 rounded-lg text-sm font-medium">Preview</button>
      </div>
      <p v-if="error" class="text-red-500 mt-3 text-sm">{{ error }}</p>

      <!-- Preview results -->
      <div v-if="previewItems.length" class="mt-4 border rounded-lg p-4 bg-gray-50 overflow-x-auto">
        <p class="text-sm font-medium mb-2">Preview ({{ previewItems.length }} items)</p>
        <table class="w-full text-sm">
          <thead><tr class="bg-gray-50"><th v-for="f in Object.keys(previewItems[0])" :key="f" class="px-2 py-1 text-left border-b">{{ f }}</th></tr></thead>
          <tbody>
            <tr v-for="(item, i) in previewItems" :key="i" class="border-b">
              <td v-for="f in Object.keys(previewItems[0])" :key="f" class="px-2 py-1 text-xs max-w-48 truncate">{{ item[f] || '—' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Recipe list -->
    <div v-if="loading" class="text-gray-500">Loading recipes…</div>
    <div v-else-if="recipes.length === 0" class="bg-white rounded-lg shadow p-12 text-center text-gray-500">
      No recipes yet. Create one, or pick elements visually in the Visual Selector tab.
    </div>
    <div v-else class="space-y-4">
      <div v-for="r in recipes" :key="r.id" class="bg-white rounded-lg shadow p-5">
        <div class="flex items-start justify-between">
          <div>
            <h3 class="font-semibold text-gray-900">{{ r.name }}</h3>
            <a :href="r.url" target="_blank" class="text-xs text-blue-500 hover:underline truncate block max-w-md">{{ r.url }}</a>
          </div>
          <div class="flex gap-2">
            <button @click="run(r)" :disabled="running === r.id" class="px-3 py-1.5 bg-blue-600 text-white rounded text-sm font-medium disabled:opacity-50">
              {{ running === r.id ? 'Running…' : 'Run' }}
            </button>
            <button @click="remove(r.id)" class="px-3 py-1.5 bg-red-100 text-red-600 rounded text-sm">Delete</button>
          </div>
        </div>
        <div class="mt-2 flex gap-4 text-xs text-gray-500">
          <span>{{ r.use_browser ? 'JS rendering' : 'Static' }}</span>
          <span v-if="r.pagination && r.pagination.mode !== 'none'">{{ r.pagination.mode }} (max {{ r.pagination.max_pages || 5 }})</span>
          <span v-if="r.schedule">every {{ r.schedule.interval_hours }}h, next {{ new Date(r.schedule.next_run_at).toLocaleString() }}</span>
        </div>
        <div v-if="results[r.id]" class="mt-3 bg-gray-50 rounded p-3">
          <p class="text-xs text-gray-500 mb-2">{{ results[r.id].length }} items extracted</p>
          <table class="w-full text-xs">
            <thead><tr class="border-b"><th v-for="f in Object.keys(results[r.id][0] || {})" :key="f" class="px-2 py-1 text-left">{{ f }}</th></tr></thead>
            <tbody>
              <tr v-for="(item, i) in results[r.id].slice(0, 5)" :key="i" class="border-b">
                <td v-for="f in Object.keys(results[r.id][0] || {})" :key="f" class="px-2 py-1 max-w-48 truncate">{{ item[f] || '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref, onMounted } from 'vue'

const recipes = ref<any[]>([])
const showCreate = ref(false)
const saving = ref(false)
const running = ref<string | null>(null)
const loading = ref(true)
const results = reactive<Record<string, any[]>>({})
const error = ref('')
const previewItems = ref<any[]>([])

const form = reactive({
  name: '', url: '', item: '', fields: 'name=a.title\nprice=.price\nlink=a@href',
  mode: 'none', paramName: 'page', maxPages: 5, useBrowser: false, intervalHours: 0,
})

function parseFields(): Record<string, string> {
  const fields: Record<string, string> = {}
  for (const line of form.fields.split('\n')) {
    const idx = line.indexOf('=')
    if (idx > 0) fields[line.slice(0, idx).trim()] = line.slice(idx + 1).trim()
  }
  return fields
}

async function load() {
  try {
    const res = await fetch('/api/recipes').then(r => r.json())
    recipes.value = res.recipes || []
  } catch (e: any) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

async function createRecipe() {
  saving.value = true
  error.value = ''
  try {
    const body: any = {
      name: form.name, url: form.url,
      selectors: { item: form.item, fields: parseFields() },
      pagination: form.mode === 'none' ? { mode: 'none' } : {
        mode: form.mode, param_name: form.paramName, max_pages: Number(form.maxPages) || 5,
      },
      useBrowser: form.useBrowser,
      intervalHours: form.intervalHours > 0 ? form.intervalHours : undefined,
    }
    const res = await fetch('/api/recipes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    if (!res.ok) throw new Error((await res.json()).error || 'Save failed')
    showCreate.value = false
    await load()
  } catch (e: any) {
    error.value = e.message
  } finally {
    saving.value = false
  }
}

async function previewFields() {
  error.value = ''
  previewItems.value = []
  try {
    const res = await fetch('/api/preview', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: form.url,
        selectors: { item: form.item, fields: parseFields() },
        use_browser: form.useBrowser,
      }),
    })
    const json = await res.json()
    if (!res.ok) throw new Error(json.error || 'Preview failed')
    previewItems.value = json.items || []
    if ((json.items || []).length === 0) error.value = 'No items matched — check selectors'
  } catch (e: any) {
    error.value = e.message
  }
}

async function run(r: any) {
  running.value = r.id
  try {
    const res = await fetch(`/api/recipes/${r.id}/run`, { method: 'POST' }).then(x => x.json())
    results[r.id] = res.items || []
  } catch (e: any) {
    error.value = e.message
  } finally {
    running.value = null
  }
}

async function remove(id: string) {
  await fetch(`/api/recipes/${id}`, { method: 'DELETE' })
  await load()
}

onMounted(load)
</script>