/**
 * Shared extraction engine: applies auto-detection or custom selectors to
 * fetched HTML, handles pagination, returns item arrays.
 */
import * as cheerio from 'cheerio'
import type { CheerioAPI } from 'cheerio'
import { detectCards, detectFieldName, detectPrice } from './cardDetector'
import type { Card } from './cardDetector'

export type { Card } from './cardDetector'

export interface CustomSelectors {
  item?: string        // repeated container selector, e.g. '.product-card'
  fields: Record<string, string> // {name: '.title', price: '.price', link: 'a@href', image: 'img@src'}
}

export interface PaginationConfig {
  mode: 'none' | 'next_link' | 'page_param'
  param_name?: string      // for page_param, e.g. 'page'
  max_pages?: number       // default 5, hard cap 50
}

export interface ExtractionItem {
  [field: string]: string | undefined
}

/** Resolve a field spec like 'a@href' or 'img@src' or '.title' against an element's scope. */
function resolveField($: CheerioAPI, scope: any, spec: string, baseUrl: string): string | undefined {
  let selector = spec
  let attr: string | null = null
  const at = spec.lastIndexOf('@')
  if (at > 0 && !spec.slice(at + 1).includes(' ')) {
    selector = spec.slice(0, at)
    attr = spec.slice(at + 1)
  }

  const el = selector ? scope.find(selector).first() : scope
  if (!el || el.length === 0) return undefined

  let value: string | undefined
  if (attr === 'text') value = el.text().trim()
  else if (attr === 'html') value = el.html() || undefined
  else if (attr) value = el.attr(attr)
  else value = el.text().trim()

  if (!value) return undefined
  // absolutize URLs
  if ((attr === 'href' || attr === 'src') && !value.startsWith('http')) {
    try { value = new URL(value, baseUrl).href } catch { /* keep relative */ }
  }
  return value
}

/** Build a CSS selector path for a clicked element (visual selector support). */
export function buildSelectorPath(el: Element, doc: CheerioAPI): string {
  const parts: string[] = []
  let node: any = el
  let depth = 0
  while (node && node.type === 'tag' && depth < 6) {
    const tag = (node.name || '').toLowerCase()
    if (!tag || tag === 'html' || tag === 'body') break
    const cls = ((node as any).attribs?.class || '').trim()
    const meaningful = cls.split(/\s+/).filter((c: string) => c && !/^(col|row|grid|flex|px-|py-|m-|p-|text-)/.test(c))
    if (meaningful.length > 0) {
      parts.unshift(`${tag}.${meaningful[0]}`)
      break // class anchor found — stop climbing
    }
    const id = (node as any).attribs?.id
    if (id) { parts.unshift(`#${id}`); break }
    parts.unshift(tag)
    node = node.parent
    depth++
  }
  const path = parts.join(' > ')
  return path || (el as any).name || '*'
}

/** A real product card carries a currency amount; nav/pagination li's don't. */
const PRICE_TEXT = /[\u0024\u20AC\u00A3\u00A5\u20B9]\s*\d|\d+[.,]\d{2}/
const PRICE_EXTRACT = /[\u0024\u20AC\u00A3\u00A5\u20B9]\s*\d+[.,]?\d*/

// Names that betray a nav/footer card rather than a product
const NAV_WORDS = new Set(['home', 'about', 'contact', 'next', 'previous', 'prev', 'more', 'cart',
  'login', 'sign in', 'register', 'blog', 'search', 'menu', 'faq', 'help', 'checkout', 'books',
  'fiction', 'nonfiction', 'mystery', 'history', 'default'])

function goodName(name: string | null): boolean {
  if (!name) return false
  const n = name.trim().toLowerCase()
  return n.length >= 3 && n !== 'unknown' && !NAV_WORDS.has(n)
}

/**
 * Extract repeated items from HTML using auto-detection.
 * Scores each candidate group by how many of its cards look like real products
 * (currency price + non-nav name), then returns all cards of the best group.
 */
export function extractAuto(html: string, baseUrl: string, maxItems = 20): Card[] {
  const $ = cheerio.load(html)
  const cardGroups = detectCards($, html)
  if (cardGroups.length === 0) return []

  let best: { cards: Card[]; score: number } = { cards: [], score: 0 }

  for (const group of cardGroups.slice(0, 5)) {
    const cards: Card[] = []
    $(group.selector).each((_, node) => {
      if (cards.length >= maxItems) return
      const cardEl = $(node)
      const text = cardEl.text()
      if (!PRICE_TEXT.test(text)) return // nav/pagination cards lack prices

      const name = detectFieldName(cardEl as any)
      if (!goodName(name)) return // 'Home', pagination labels, etc.

      let price = detectPrice(cardEl as any)
      if (!price) {
        // ponytail: symbol-only prices (£23.99) — detectPrice wants a currency word, grab raw symbol+number instead
        const m = text.match(PRICE_EXTRACT)
        price = m ? m[0].trim() : null
      }

      let link: string | undefined
      const linkEl = cardEl.find('a[href]').first()
      if (linkEl.length > 0) {
        const href = linkEl.attr('href')
        if (href) { try { link = new URL(href, baseUrl).href } catch { link = href } }
      }
      cards.push({ selector: group.selector, name: name!.trim(), price: price || 'N/A', link })
    })
    // prefer product-ish selectors on ties, then more good cards
    const productish = /product|item|card|goods|offer|book|listing|result|tile|entry/i
    const bonus = productish.test(group.selector) ? 1 : 0

    // Nested-container selectors (bare 'div') match parents AND children of the
    // same card — dedupe by link/name so one product appears once.
    const seen = new Set<string>()
    const unique = cards.filter(c => {
      const k = c.link || `${c.name}|${c.price}`
      if (seen.has(k)) return false
      seen.add(k)
      return true
    })

    const score = unique.length + bonus * 0.5
    if (score > best.score) best = { cards: unique, score }
    if (best.cards.length >= maxItems) break
  }
  return best.cards
}

/** Extract using custom selectors from a recipe/visual selection. */
export function extractWithSelectors(html: string, baseUrl: string, selectors: CustomSelectors, maxItems = 200): ExtractionItem[] {
  if (!selectors.item || Object.keys(selectors.fields).length === 0) return []
  const $ = cheerio.load(html)
  const items: ExtractionItem[] = []
  $(selectors.item).each((_, node) => {
    if (items.length >= maxItems) return
    const scope = $(node)
    const item: ExtractionItem = {}
    for (const [fieldName, spec] of Object.entries(selectors.fields)) {
      item[fieldName] = resolveField($, scope, spec, baseUrl)
    }
    items.push(item)
  })
  return items
}

/** Find the next-page URL given a pagination config. Returns null when done. */
export function findNextPageUrl($: CheerioAPI, currentUrl: string, pagination: PaginationConfig): string | null {
  const maxPages = Math.min(pagination.max_pages ?? 5, 50)

  if (pagination.mode === 'next_link') {
    const candidates = [
      'a[rel="next"]',
      'a.next', 'a[aria-label*="next" i]', 'a[title*="next" i]',
      'a:contains("Next")', 'a:contains("next")', 'a:contains("»")', 'a:contains("›")',
    ]
    for (const sel of candidates) {
      const href = $(sel).first().attr('href')
      if (href) {
        try { return new URL(href, currentUrl).href } catch { /* skip */ }
      }
    }
    return null
  }

  if (pagination.mode === 'page_param') {
    try {
      const u = new URL(currentUrl)
      const param = pagination.param_name || 'page'
      const current = parseInt(u.searchParams.get(param) || '1', 10)
      if (isNaN(current) || current >= maxPages) return null
      u.searchParams.set(param, String(current + 1))
      return u.href
    } catch {
      return null
    }
  }

  return null
}
