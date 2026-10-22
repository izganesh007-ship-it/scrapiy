<template>
  <div class="container mx-auto px-4 py-8 max-w-6xl">
    <h1 class="text-2xl font-bold text-gray-900 mb-2">Visual Selector</h1>
    <p class="text-gray-600 mb-6 text-sm">Load a page, click a repeating card, then pick its fields. Save as a reusable recipe.</p>

    <!-- Step 1: URL -->
    <div class="bg-white rounded-lg shadow p-6 mb-6">
      <div class="flex gap-3">
        <input v-model="url" placeholder="https://example.com/products" class="flex-1 px-4 py-3 border rounded-lg" />
        <label class="flex items-center gap-2 text-sm px-2">
          <input type="checkbox" v-model="useBrowser" /> JS render
        </label>
        <button @click="loadPage()" :disabled="!url.trim() || loading" class="px-6 py-3 bg-blue-600 text-white rounded-lg font-medium disabled:opacity-50">
          {{ loading ? 'Loading…' : 'Load Page' }}
        </button>
      </div>
      <p v-if="error" class="text-red-500 mt-3 text-sm">{{ error }}</p>
      <p v-if="htmlLoaded" class="text-gray-400 text-xs mt-2">fetched via tier {{ tierUsed }}</p>
    </div>

    <div v-if="htmlLoaded" class="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <!-- Clickable page preview -->
      <div class="lg:col-span-2 bg-white rounded-lg shadow p-4">
        <p class="text-sm font-medium mb-2">
          {{ pickingField ? `Now click the element for field "${pickingField}"` : 'Click a repeating card (e.g. one product box)' }}
        </p>
        <iframe ref="frame" sandbox="allow-scripts" class="w-full border rounded bg-white" style="height: 600px"></iframe>
      </div>

      <!-- Selector builder -->
      <div class="space-y-4">
        <div class="bg-white rounded-lg shadow p-4">
          <h3 class="font-semibold text-sm mb-2">Item (card) selector</h3>
          <code class="text-xs bg-gray-100 px-2 py-1 rounded block break-all">{{ itemSelector || '— not picked yet —' }}</code>
          <button v-if="itemSelector" @click="rePickItem" class="text-xs text-blue-500 mt-1">re-pick</button>
        </div>

        <div class="bg-white rounded-lg shadow p-4">
          <p class="font-semibold text-sm mb-2">Fields</p>
          <div class="flex gap-2 mb-2">
            <input v-model="newFieldName" placeholder="field name (price, title…)" class="flex-1 px-2 py-1 border rounded text-sm" />
            <button @click="armField" :disabled="!itemSelector || !newFieldName.trim()" class="px-3 py-1 bg-blue-600 text-white rounded text-sm disabled:opacity-50">
              Pick
            </button>
          </div>
          <ul class="text-xs space-y-1">
            <li v-for="(sel, fname) in fieldSelectors" :key="fname" class="flex justify-between items-center bg-gray-50 px-2 py-1 rounded">
              <span><b>{{ fname }}</b>: <code>{{ sel }}</code></span>
              <button @click="removeField(String(fname))" class="text-red-500 px-1">✕</button>
            </li>
          </ul>
        </div>

        <button @click="preview()" :disabled="previewing || !itemSelector || Object.keys(fieldSelectors).length === 0" class="w-full py-2 bg-green-600 text-white rounded font-medium disabled:opacity-50">
          {{ previewing ? 'Previewing…' : 'Preview extraction' }}
        </button>
        <div v-if="previewItems.length" class="bg-gray-50 rounded p-3 text-xs">
          <p class="font-medium mb-1">{{ previewItems.length }} items:</p>
          <pre class="whitespace-pre-wrap max-h-44 overflow-auto">{{ JSON.stringify(previewItems.slice(0, 3), null, 1) }}</pre>
        </div>

        <div>
          <input v-model="recipeName" placeholder="Recipe name" class="w-full px-3 py-2 border rounded text-sm mb-2" />
          <button @click="saveRecipe()" :disabled="saving || !itemSelector || Object.keys(fieldSelectors).length === 0" class="w-full py-2 bg-blue-600 text-white rounded font-medium disabled:opacity-50">
            Save as Recipe
          </button>
          <p v-if="saved" class="text-green-600 text-sm mt-2">Saved! Open the Recipes tab to run it.</p>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, onUnmounted } from 'vue'

const url = ref('')
const useBrowser = ref(false)
const htmlLoaded = ref(false)
const loading = ref(false)
const previewing = ref(false)
const saving = ref(false)
const saved = ref(false)
const error = ref('')
const tierUsed = ref(1)
const itemSelector = ref('')
const newFieldName = ref('')
const pickingField = ref(false)
const previewItems = ref<any[]>([])
const recipeName = ref('')
const frame = ref<HTMLIFrameElement | null>(null)

const fieldSelectors = reactive<Record<string, string>>({})

// Selection script injected into the fetched page. Click handler computes a
// structural CSS path and postMessages it to the parent (this component).
const INJECT = `<script>
(function(){
  var style=document.createElement('style');
  style.textContent='[data-scra-hover]{outline:2px solid #3b82f6 !important;cursor:pointer !important}';
  document.head.appendChild(style);
  function path(el){
    var parts=[],node=el,depth=0,tag='';
    while(node&&node.nodeType===1&&depth<6){
      var tag=node.tagName.toLowerCase();
      if(tag==='html'||tag==='body')break;
      var cls=(node.getAttribute('class')||'').trim().split(/\\s+/)
        .filter(function(c){return c&&!/^(col|row|grid|flex|px-|py-|m[tblr]?-|p[tblr]?-|text-)/.test(c)});
      if(cls.length){parts.unshift(tag+'.'+cls[0]);break;}
      if(node.id){parts.unshift('#'+node.id);break;}
      parts.unshift(tag);node=node.parentElement;depth++;
    }
    return parts.join(' > ')||'body';
  }
  var armed=null; // null | 'item' | 'field'
  window.addEventListener('message',function(e){
    if(e.data&&e.data.type==='scra-arm'){armed=e.data.mode||'item';}
  });
  document.addEventListener('mouseover',function(ev){
    if(!armed)return;ev.target.setAttribute('data-scra-hover','');
  },true);
  document.addEventListener('mouseout',function(ev){ev.target.removeAttribute('data-scra-hover');},true);
  document.addEventListener('click',function(ev){
    if(!armed)return;
    ev.preventDefault();ev.stopPropagation();
    var sel=path(ev.target);
    var mode=armed;armed=null;
    parent.postMessage({type:'scra-pick',mode:mode,selector:sel},'*');
  },true);
})();
<\/script>`

function onMessage(ev: MessageEvent) {
  const d: any = ev.data
  if (!d || d.type !== 'scra-pick') return
  if (d.mode === 'field' && d.name && d.selector) {
    fieldSelectors[d.name] = d.selector
  } else if (d.selector) {
    itemSelector.value = d.selector
  }
}
onMounted(() => window.addEventListener('message', onMessage))
onUnmounted(() => window.removeEventListener('message', onMessage))

async function loadPage() {
  loading.value = true
  error.value = ''
  htmlLoaded.value = false
  saved.value = false
  previewItems.value = []
  itemSelector.value = ''
  recipeName.value = ''
  Object.keys(fieldSelectors).forEach(k => delete fieldSelectors[k])
  try {
    const res = await fetch('/api/render', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: url.value, use_browser: useBrowser.value }),
    })
    const json = await res.json()
    if (!res.ok || !json.success) throw new Error(json.error || 'Render failed')
    tierUsed.value = json.tier

    let base = ''
    try { base = `<base href="${new URL(url.value).href}">` } catch { /* relative */ }
    const injected = json.html.replace(/<head([^>]*)>/i, `<head$1>${base}${INJECT}`)
    if (frame.value) frame.value.srcdoc = injected
    htmlLoaded.value = true
  } catch (e: any) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

function armPick(mode: 'item' | 'field', name?: string) {
  frame.value?.contentWindow?.postMessage({ type: 'scra-arm', mode, name }, '*')
}

function pickItem() {
  if (frame.value) frame.value.contentWindow?.postMessage({ type: 'scra-arm', mode: 'item' }, '*')
}

function armField() {
  const name = newFieldName.value.trim()
  if (!name) return
  if (frame.value) frame.value.contentWindow?.postMessage({ type: 'scra-arm', mode: 'field', name }, '*')
}

function rePickItem() {
  itemSelector.value = ''
  pickItem()
}

function removeField(name: string) {
  delete fieldSelectors[name]
}

async function preview() {
  previewing.value = true
  error.value = ''
  try {
    const res = await fetch('/api/preview', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: url.value,
        selectors: { item: itemSelector.value, fields: { ...fieldSelectors } },
        use_browser: useBrowser.value,
      }),
    })
    const json = await res.json()
    if (!res.ok) throw new Error(json.error || 'Preview failed')
    previewItems.value = json.items || []
    if ((json.items || []).length === 0) error.value = 'No items matched'
  } catch (e: any) {
    error.value = e.message
  } finally {
    previewing.value = false
  }
}

async function saveRecipe() {
  saving.value = true
  error.value = ''
  try {
    const res = await fetch('/api/recipes', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: recipeName.value,
        url: url.value,
        selectors: { item: itemSelector.value, fields: { ...fieldSelectors } },
        pagination: { mode: 'none' },
        useBrowser: useBrowser.value,
      }),
    })
    if (!res.ok) throw new Error((await res.json()).error || 'Save failed')
    saved.value = true
  } catch (e: any) {
    error.value = e.message
  } finally {
    saving.value = false
  }
}
</script>