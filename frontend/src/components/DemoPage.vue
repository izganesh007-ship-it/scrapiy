<template>
  <div class="container mx-auto px-4 py-8 max-w-4xl">
    <h1 class="text-2xl font-bold text-gray-900 mb-1">How scraping works — live</h1>
    <p class="text-gray-600 mb-6 text-sm">A scraper only does 4 things. Run them in order on a real website and watch each step.</p>

    <!-- Target picker -->
    <div class="bg-white rounded-lg shadow p-4 mb-6">
      <label class="block text-xs font-medium text-gray-500 mb-1">Target page (real, public site)</label>
      <div class="flex gap-2">
        <input v-model="url" class="flex-1 px-3 py-2 border rounded-lg text-sm font-mono" />
        <select v-model.number="presetIdx" @change="url = presets[presetIdx].url" class="px-3 py-2 border rounded-lg text-sm">
          <option v-for="(p, i) in presets" :key="p.url" :value="i">{{ p.label }}</option>
        </select>
      </div>
    </div>

    <!-- STEP 1 -->
    <div class="bg-white rounded-lg shadow p-5 mb-4">
      <div class="flex items-start gap-4">
        <div class="step-badge" :class="done[0] ? 'bg-green-500' : 'bg-blue-600'">{{ done[0] ? '✓' : '1' }}</div>
        <div class="flex-1">
          <h3 class="font-semibold text-gray-900">Fetch the page</h3>
          <p class="text-sm text-gray-600 mt-0.5">The scraper downloads the page's HTML — the exact same thing your browser does when you visit a site. No magic yet.</p>
          <button @click="runFetch" :disabled="busy === 0" class="mt-3 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium disabled:opacity-50">
            {{ busy === 0 ? 'Fetching…' : done[0] ? 'Fetch again' : 'Fetch the page' }}
          </button>
          <p v-if="errors[0]" class="text-red-500 text-xs mt-2">{{ errors[0] }}</p>
          <div v-if="done[0]" class="mt-3 bg-green-50 border border-green-200 rounded-lg p-3 text-sm">
            <p class="text-green-800">✓ Downloaded <b>{{ fetchInfo.kb }} KB</b> of HTML in {{ fetchInfo.ms }}ms (tier {{ fetchInfo.tier }}) — page: <i>{{ fetchInfo.title }}</i></p>
            <details class="mt-2">
              <summary class="text-xs text-gray-500 cursor-pointer">Peek at the raw HTML</summary>
              <pre class="text-xs bg-gray-900 text-gray-200 rounded p-3 mt-2 overflow-x-auto max-h-48 whitespace-pre-wrap">{{ fetchInfo.snippet }}</pre>
            </details>
          </div>
        </div>
      </div>
    </div>

    <!-- STEP 2 -->
    <div class="bg-white rounded-lg shadow p-5 mb-4" :class="!done[0] && 'opacity-50'">
      <div class="flex items-start gap-4">
        <div class="step-badge" :class="done[1] ? 'bg-green-500' : done[0] ? 'bg-blue-600' : 'bg-gray-300'">{{ done[1] ? '✓' : '2' }}</div>
        <div class="flex-1">
          <h3 class="font-semibold text-gray-900">Find the repeating cards</h3>
          <p class="text-sm text-gray-600 mt-0.5">Product listings are just the same chunk of HTML repeated. The scraper hunts for a container that appears over and over — that's a "card".</p>
          <button @click="runDetect" :disabled="!done[0] || busy === 1" class="mt-3 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed">
            {{ busy === 1 ? 'Scanning…' : done[1] ? 'Scan again' : 'Find product cards' }}
          </button>
          <p v-if="errors[1]" class="text-red-500 text-xs mt-2">{{ errors[1] }}</p>
          <div v-if="done[1]" class="mt-3 bg-green-50 border border-green-200 rounded-lg p-3 text-sm">
            <p class="text-green-800">✓ Found <b>{{ detectInfo.count }} cards</b> matching <code class="bg-white px-1.5 py-0.5 rounded border">{{ detectInfo.selector }}</code></p>
            <p class="text-xs text-gray-500 mt-1">That selector is the recipe's secret — click any one card and you get a product.</p>
            <details v-if="detectInfo.cardHtml" class="mt-2">
              <summary class="text-xs text-gray-500 cursor-pointer">See one matched card's HTML</summary>
              <pre class="text-xs bg-gray-900 text-emerald-300 rounded p-3 mt-2 overflow-x-auto max-h-48 whitespace-pre-wrap">{{ detectInfo.cardHtml }}</pre>
            </details>
          </div>
        </div>
      </div>
    </div>

    <!-- STEP 3 -->
    <div class="bg-white rounded-lg shadow p-5 mb-4" :class="!done[1] && 'opacity-50'">
      <div class="flex items-start gap-4">
        <div class="step-badge" :class="done[2] ? 'bg-green-500' : done[1] ? 'bg-blue-600' : 'bg-gray-300'">{{ done[2] ? '✓' : '3' }}</div>
        <div class="flex-1">
          <h3 class="font-semibold text-gray-900">Extract the fields</h3>
          <p class="text-sm text-gray-600 mt-0.5">Inside each card, pull out the pieces you care about: the name, the price, the link. Repeat for every card.</p>
          <button @click="done[2] = true" :disabled="!done[1] || done[2]" class="mt-3 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed">
            {{ done[2] ? 'Extracted' : 'Extract name, price & link' }}
          </button>
          <div v-if="done[2]" class="mt-3 border rounded-lg overflow-x-auto">
            <table class="w-full text-sm">
              <thead>
                <tr class="bg-gray-50 border-b text-left text-xs text-gray-600">
                  <th class="px-3 py-2">Name</th>
                  <th class="px-3 py-2">Price</th>
                  <th class="px-3 py-2">Link</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(item, i) in items.slice(0, 8)" :key="i" class="border-b last:border-0">
                  <td class="px-3 py-2 font-medium">{{ item.name }}</td>
                  <td class="px-3 py-2 text-green-700">{{ item.price }}</td>
                  <td class="px-3 py-2"><a :href="item.link" target="_blank" class="text-blue-500 hover:underline text-xs">open ↗</a></td>
                </tr>
              </tbody>
            </table>
            <p v-if="items.length > 8" class="text-xs text-gray-400 px-3 py-2">+ {{ items.length - 8 }} more rows in the CSV</p>
          </div>
        </div>
      </div>
    </div>

    <!-- STEP 4 -->
    <div class="bg-white rounded-lg shadow p-5 mb-8" :class="!done[2] && 'opacity-50'">
      <div class="flex items-start gap-4">
        <div class="step-badge" :class="done[3] ? 'bg-green-500' : done[2] ? 'bg-blue-600' : 'bg-gray-300'">{{ done[3] ? '✓' : '4' }}</div>
        <div class="flex-1">
          <h3 class="font-semibold text-gray-900">Export the data</h3>
          <p class="text-sm text-gray-600 mt-0.5">Done. Download it as a spreadsheet — or save this whole flow as a Recipe and re-run it anytime, even from code.</p>
          <div class="mt-3 flex flex-wrap gap-2">
            <button @click="downloadCsv" :disabled="!done[2]" class="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed">
              ⬇ Download CSV ({{ items.length }} rows)
            </button>
            <button @click="saveAsRecipe" :disabled="!done[2] || savingRecipe" class="px-4 py-2 bg-gray-800 text-white rounded-lg text-sm font-medium disabled:opacity-50">
              {{ savingRecipe ? 'Saving…' : done[3] ? '✓ Saved — open Recipes' : 'Save as Recipe' }}
            </button>
          </div>
          <p v-if="recipeError" class="text-red-500 text-xs mt-2">{{ recipeError }}</p>
        </div>
      </div>
    </div>

    <!-- Going further -->
    <div class="grid md:grid-cols-2 gap-4">
      <div class="bg-white rounded-lg shadow p-5">
        <div class="flex items-center gap-2 mb-1">
          <span class="text-xs font-mono px-2 py-0.5 rounded bg-purple-100 text-purple-700">tier 2 · headless browser</span>
        </div>
        <h3 class="font-semibold text-gray-900">What about JavaScript sites?</h3>
        <p class="text-xs text-gray-500 mt-1 mb-3">Some pages build themselves with JS. For those, the ladder switches to a real headless browser (free 10 min/day on Cloudflare).</p>
        <button @click="runBrowserDemo" :disabled="browserBusy" class="w-full py-2 bg-purple-600 text-white rounded font-medium text-sm disabled:opacity-50">
          {{ browserBusy ? 'Rendering in browser…' : browserCount !== null ? `✓ ${browserCount} items via headless browser — run again` : 'Try it on a JS-only page' }}
        </button>
        <p v-if="browserError" class="text-red-500 text-xs mt-2">{{ browserError }}</p>
      </div>
      <div class="bg-white rounded-lg shadow p-5">
        <h3 class="font-semibold text-gray-900">Use it from your own code</h3>
        <p class="text-xs text-gray-500 mt-1 mb-3">Save the flow as a Recipe, create an API key, then call it from anywhere:</p>
        <pre class="text-xs bg-gray-900 text-gray-200 rounded p-3 overflow-x-auto">{{ curlSnippet }}</pre>
        <button @click="copyText(curlSnippet)" class="mt-2 px-3 py-1.5 bg-gray-100 rounded text-sm">Copy</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'

const presets = [
  { label: 'Laptop store (static)', url: 'https://webscraper.io/test-sites/e-commerce/static/computers/laptops' },
  { label: 'Book store (classic)', url: 'http://books.toscrape.com/' },
]
const presetIdx = ref(0)
const url = ref(presets[0].url)

const done = ref([false, false, false, false])
const busy = ref(-1)
const errors = ref(['', '', '', ''])

const fetchInfo = ref({ kb: 0, ms: 0, tier: 1, title: '', snippet: '' })
let rawHtml = ''
const detectInfo = ref({ count: 0, selector: '', cardHtml: '' })
const items = ref<any[]>([])
const savingRecipe = ref(false)
const recipeError = ref('')
const browserBusy = ref(false)
const browserError = ref('')
const browserCount = ref<number | null>(null)

function resetFrom(step: number) {
  done.value = done.value.map((d, i) => (i < step ? d : false))
  errors.value = ['', '', '', '']
  if (step <= 1) { items.value = []; detectInfo.value = { count: 0, selector: '', cardHtml: '' } }
}

/** Step 1 — download the HTML. */
async function runFetch() {
  busy.value = 0
  errors.value[0] = ''
  resetFrom(1)
  const started = performance.now()
  try {
    const res = await fetch('/api/render', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: url.value, use_browser: false }),
    })
    const json = await res.json()
    if (!res.ok || !json.success) throw new Error(json.error || 'Fetch failed')
    rawHtml = json.html
    const titleMatch = rawHtml.match(/<title[^>]*>([^<]+)<\/title>/i)
    fetchInfo.value = {
      kb: Math.round(rawHtml.length / 102.4) / 10,
      ms: Math.round(performance.now() - started),
      tier: json.tier,
      title: titleMatch ? titleMatch[1].trim() : '(untitled)',
      snippet: rawHtml.slice(0, 700),
    }
    done.value[0] = true
  } catch (e: any) {
    errors.value[0] = e.message
  } finally {
    busy.value = -1
  }
}

/** Step 2 — auto-detect the repeated card group (also caches extracted items for step 3). */
async function runDetect() {
  busy.value = 1
  errors.value[1] = ''
  resetFrom(2)
  try {
    const res = await fetch('/api/preview', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: url.value, auto: true }),
    })
    const json = await res.json()
    if (!res.ok) throw new Error(json.error || 'Detection failed')
    items.value = json.items || []
    if (items.value.length === 0) throw new Error('No repeated product cards found on this page')

    // Pull one matched card's HTML out of the step-1 page for show & tell
    let cardHtml = ''
    try {
      const doc = new DOMParser().parseFromString(rawHtml, 'text/html')
      const wanted = (items.value[0].name || '').slice(0, 20)
      for (const el of doc.querySelectorAll(json.selector || '*')) {
        if (el.textContent?.includes(wanted)) { cardHtml = el.outerHTML; break }
      }
    } catch { /* snippet is best-effort */ }

    detectInfo.value = {
      count: json.count,
      selector: json.selector || '(auto)',
      cardHtml: cardHtml ? cardHtml.slice(0, 600) + (cardHtml.length > 600 ? '\n…' : '') : '',
    }
    done.value[1] = true
  } catch (e: any) {
    errors.value[1] = e.message
  } finally {
    busy.value = -1
  }
}

/** Step 4 — CSV straight from the extracted rows. */
function downloadCsv() {
  if (!items.value.length) return
  const fields = Object.keys(items.value[0])
  const esc = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const csv = [fields.join(','), ...items.value.map(r => fields.map(f => esc(r[f])).join(','))].join('\n')
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
  a.download = 'scrapiy-demo.csv'
  a.click()
  URL.revokeObjectURL(a.href)
  done.value[3] = true
}

/** Step 4b — persist this flow as a reusable Recipe. */
async function saveAsRecipe() {
  savingRecipe.value = true
  recipeError.value = ''
  try {
    const res = await fetch('/api/recipes', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `Demo — ${new URL(url.value).hostname}`,
        url: url.value,
        selectors: {},                      // empty = auto-detect each run
        pagination: { mode: 'page_param', param_name: 'page', max_pages: 3 },
        useBrowser: false,
      }),
    })
    if (!res.ok) throw new Error((await res.json()).error || 'Save failed')
    done.value[3] = true
  } catch (e: any) {
    recipeError.value = e.message
  } finally {
    savingRecipe.value = false
  }
}

/** Bonus — the tier-2 headless-browser path on a JS-only page. */
async function runBrowserDemo() {
  browserBusy.value = true
  browserError.value = ''
  try {
    const res = await fetch('/api/scan', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://webscraper.io/test-sites/e-commerce/ajax/computers/laptops', use_browser: true }),
    })
    const json = await res.json()
    if (!res.ok) throw new Error(json.error || 'Browser render failed')
    browserCount.value = (json.jobs || []).length
    if (browserCount.value === 0) browserError.value = 'Rendered but found no items (free browser minutes may be exhausted for today)'
  } catch (e: any) {
    browserError.value = e.message
  } finally {
    browserBusy.value = false
  }
}

async function copyText(text: string) {
  try { await navigator.clipboard.writeText(text) } catch { /* clipboard unavailable */ }
}

const curlSnippet = `curl -X POST ${location.origin}/api/v1/run \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: sk_live_YOUR_KEY" \\
  -d '{"recipe_id": "<recipe id>"}'`
</script>

<style scoped>
.step-badge {
  @apply w-8 h-8 rounded-full text-white font-bold flex items-center justify-center text-sm shrink-0;
}
</style>