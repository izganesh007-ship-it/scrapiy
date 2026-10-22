import { load, type CheerioAPI, type Cheerio } from 'cheerio'
import type { Element } from 'domhandler'

const MIN_SIBLINGS = 3
const MAX_CHILD_TYPES = 12

export interface Card {
  selector: string
  name?: string
  price?: string
  link?: string
}

// Tags that commonly wrap repeated product cards
const WRAPPER_TAGS = new Set(['li', 'article', 'div', 'tr', 'section', 'figure'])

// Class tokens that are layout scaffolding, not product semantics
const LAYOUT_CLASS = /^(col|grid|row|item|box|cell|responsive|flex-|d-flex|px-|py-|m-|p-|mt-|mb-|ml-|mr-|text-)/
const PRODUCTISH_CLASS = /(product|item|card|goods|offer|book|listing|result|tile|entry)/i

/**
 * Find repeated cards by grouping siblings that share tag + class.
 * Product grids render repeated <li className="product"/>, <article>,
 * or <div class="card product"> elements under one container.
 */
export function detectCards(doc: CheerioAPI, html: string): Card[] {
  const groups = new Map<string, { selector: string; tags: Set<string>; count: number; depth: number }>()

  doc('body').find('*').each((_, node) => {
    const nodeEl = node as Element
    if (!WRAPPER_TAGS.has(nodeEl.name)) return

    const el = doc(node)
    const parent = el.parent()
    if (!parent.length) return

    // Trim class string to avoid empty token
    const rawCls = (el.attr('class') || '').trim()
    let keyClass = ''
    let key = nodeEl.name
    if (rawCls.length > 0) {
      const classTokens = rawCls.split(/\s+/).filter(Boolean)
      const meaningful = classTokens.find(c => !LAYOUT_CLASS.test(c) && PRODUCTISH_CLASS.test(c))
      const fallback = classTokens.find(c => !LAYOUT_CLASS.test(c)) || ''
      keyClass = meaningful || fallback || ''
      if (keyClass) key = `${nodeEl.name}.${keyClass}`
    }

    // Count siblings with same tag + same class token
    let siblingCount = 0
    parent.children().each((_, e) => {
      if (e.name !== nodeEl.name) return
      const s = (doc(e).attr('class') || '').trim()
      const tokens = s.split(/\s+/)
      if (keyClass === '' || tokens.includes(keyClass)) siblingCount++
    })
    if (siblingCount < MIN_SIBLINGS) return

    // Structural diversity inside siblings (avoid nav menus / simple link lists)
    const tagTypes = new Set<string>()
    const siblingsForTypes = keyClass ? el.siblings(`.${keyClass}`) : el.siblings()
    siblingsForTypes.slice(0, 6).each((_, s) => {
      doc(s).find('*').each((_, c) => { if (c.name) tagTypes.add(c.name) })
    })
    if (tagTypes.size < 2) return

    // Product-likeness: how many siblings contain price-like text + a link
    let priceLike = 0
    let withLink = 0
    let scanned = 0
    parent.children().each((_, e) => {
      if (e.name !== nodeEl.name) return
      if (keyClass && !(doc(e).attr('class') || '').split(/\s+/).includes(keyClass)) return
      if (scanned >= 8) return
      scanned++
      const elHtml = doc(e).html() || ''
      if (/[\$\€\£\¥\₹]?\s*\d+[.,]?\d*/.test(textOf(doc(e)))) priceLike++
      if (/<a[^>]+href/i.test(elHtml)) withLink++
    })
    const priceRatio = scanned ? priceLike / scanned : 0
    const linkRatio = scanned ? withLink / scanned : 0
    // Require a meaningful share of members to look like products
    if (priceRatio < 0.5 || linkRatio < 0.5) return

    let depth = 0
    let p = parent
    while (p.length && p[0].name !== 'body') { depth++; p = p.parent() }

    const prev = groups.get(key)
    if (!prev || siblingCount > prev.count) {
      groups.set(key, { selector: key, tags: tagTypes, count: siblingCount, depth })
    }
  })

  const candidates = [...groups.values()]
    .filter(g => g.count >= MIN_SIBLINGS)
    .sort((a, b) => b.count - a.count || a.depth - b.depth)

  const selected: Card[] = []
  for (const c of candidates) {
    selected.push({ selector: c.selector, name: '', price: '' })
    if (selected.length >= 5) break
  }
  return selected
}

/**
 * Auto-detect product name from a card element using JSON-LD and heuristics.
 */
export function detectFieldName(cardEl: Cheerio<Element>): string | null {
  let name = extractFromLd(cardEl.parents('*').toArray())

  if (!name) {
    const candidates = [
      '[itemprop="name"]',
      '.title',
      '.product-name',
      '.product-title',
      '.name',
      'h1', 'h2', 'h3', 'h4',
      'a[href]:not([href="#"])',
      '[data-testid*="name"]',
      '[data-cy*="name"]',
    ]
    for (const sel of candidates) {
      const found = cardEl.find(sel).first().text().trim()
      if (found && found.length > 2 && found.length < 150) {
        name = found
        break
      }
    }
  }
  return name
}

/**
 * Auto-detect price from a card element.
 */
export function detectPrice(cardEl: Cheerio<Element>): string | null {
  let price = extractPriceFromLd(cardEl.parents('*').toArray())

  if (!price) {
    const priceSelectors = [
      '[itemprop="price"]',
      '.price',
      '.cost',
      '.price-tag',
      '.price-amount',
      '.product-price',
      '[data-price]',
      '[data-testid*="price"]',
      '.money',
    ]
    for (const sel of priceSelectors) {
      const found = cardEl.find(sel).first().text().trim()
      if (found && /[\$\€\£\¥\₹]?\s*\d+[.,]?\d*/.test(found)) {
        price = found
        break
      }
    }
    if (!price) {
      const candidates = cardEl.find('*').filter((i: number, e: Element) => {
        const html = load(e).html() || ''
        return /[\$\€\£\¥\₹]?\s*\d+[.,]?\d*\s*(USD|EUR|GBP|INR|CAD|AUD)/i.test(html)
      })
      if (candidates.length > 0) {
        const lastEl = candidates.get(candidates.length - 1)
        price = lastEl ? load(lastEl).text().trim() : null
      }
    }
  }
  return price
}

function textOf(el: Cheerio<Element>): string {
  return el.text().trim()
}

function extractFromLd(parents: Element[]): string | null {
  for (const el of parents) {
    const html = load(el).html() || ''
    if (!html) continue
    const ld = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>(.*?)<\/script>/s)
    if (ld) {
      try {
        const json = JSON.parse(ld[1])
        if (typeof json === 'string' && json.length > 2) return json
        if (Array.isArray(json)) {
          for (const item of json) {
            const r = extractFromLdItem(item)
            if (r) return r
          }
        } else {
          const r = extractFromLdItem(json)
          if (r) return r
        }
      } catch { }
    }
  }
  return null
}

function extractFromLdItem(json: unknown): string | null {
  if (!json || typeof json !== 'object') return null
  const obj = json as Record<string, unknown>
  if (typeof obj.name === 'string' && obj.name.length > 2) return obj.name
  if (typeof obj.title === 'string' && obj.title.length > 2) return obj.title
  if (typeof obj.description === 'string' && obj.description.length > 2) return obj.description
  if (typeof obj.productName === 'string' && obj.productName.length > 2) return obj.productName
  return null
}

function extractPriceFromLd(parents: Element[]): string | null {
  for (const el of parents) {
    const html = load(el).html() || ''
    if (!html) continue
    const ld = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>(.*?)<\/script>/s)
    if (ld) {
      try {
        const json = JSON.parse(ld[1])
        const price = traverseJsonForPrice(json)
        if (price) return price
      } catch { }
    }
  }
  return null
}

function traverseJsonForPrice(json: unknown): string | null {
  if (!json || typeof json !== 'object') return null
  const obj = json as Record<string, unknown>
  if (typeof obj.price === 'number') return `$${obj.price.toFixed(2)}`
  if (typeof obj.price === 'string' && /\d/.test(obj.price)) return obj.price
  if (obj.offers && typeof obj.offers === 'object') {
    const price = traverseJsonForPrice(obj.offers)
    if (price) return price
  }
  for (const val of Object.values(obj)) {
    const price = traverseJsonForPrice(val)
    if (price) return price
  }
  return null
}