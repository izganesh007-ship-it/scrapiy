/**
 * Scrapiy Frontend - Entry point (Vue 3)
 * macOS-style shell: frosted sticky nav, light/dark toggle, page transitions.
 */

import { createApp, ref, defineComponent, h, Transition } from 'vue'
import ScraperPage from './components/ScraperPage.vue'
import RecipesPage from './components/RecipesPage.vue'
import VisualSelectorPage from './components/VisualSelectorPage.vue'
import KeysPage from './components/KeysPage.vue'
import DemoPage from './components/DemoPage.vue'
import './theme.css'

const routes: Record<string, any> = {
  demo: DemoPage,
  scraper: ScraperPage,
  visual: VisualSelectorPage,
  recipes: RecipesPage,
  keys: KeysPage,
}

const pages = [
  { id: 'demo', label: 'Live Demo' },
  { id: 'scraper', label: 'Scraper' },
  { id: 'visual', label: 'Visual Selector' },
  { id: 'recipes', label: 'Recipes' },
  { id: 'keys', label: 'API Keys' },
]

// Theme state (shared by nav toggle)
function initialTheme(): string {
  try { return localStorage.getItem('scrapiy-theme') || 'light' } catch { return 'light' }
}
const theme = ref(initialTheme())
function setTheme(t: string) {
  theme.value = t
  document.documentElement.setAttribute('data-theme', t)
  try { localStorage.setItem('scrapiy-theme', t) } catch { /* private mode */ }
}

const App = defineComponent({
  setup() {
    const current = ref('demo')
    const nav = (id: string) => {
      current.value = id
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
    return () =>
      h('div', { class: 'min-h-screen' }, [
        // macOS frosted menu bar
        h('header', { class: 'mac-nav' }, [
          h('div', { style: 'display:flex;gap:7px;align-items:center' }, [
            h('span', { style: 'width:12px;height:12px;border-radius:50%;background:#ff5f57;display:inline-block' }),
            h('span', { style: 'width:12px;height:12px;border-radius:50%;background:#febc2e;display:inline-block' }),
            h('span', { style: 'width:12px;height:12px;border-radius:50%;background:#28c840;display:inline-block' }),
          ]),
          h('span', { class: 'brand' }, 'Scrapiy'),
          ...pages.map(p =>
            h('button', {
              class: ['tab', current.value === p.id ? 'on' : ''],
              onClick: () => nav(p.id),
            }, p.label)
          ),
          h('div', { class: 'mac-toggle' }, [
            h('button', {
              class: theme.value === 'light' ? 'on' : '',
              title: 'Light appearance',
              onClick: () => setTheme('light'),
            }, '☀︎'),
            h('button', {
              class: theme.value === 'dark' ? 'on' : '',
              title: 'Dark appearance',
              onClick: () => setTheme('dark'),
            }, '☾'),
          ]),
        ]),
        // Page body with transition
        h('div', { style: 'padding:12px 0 40px' }, [
          h(Transition, { name: 'page', mode: 'out-in' }, () => h(routes[current.value] || DemoPage, { key: current.value })),
        ]),
      ])
  },
})

createApp(App).mount('#app')

// Global error handler
window.addEventListener('error', (event) => {
  console.error('Global error:', event.error)
})