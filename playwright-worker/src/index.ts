import express from 'express'
import { chromium } from 'playwright'

/**
 * Railway-compatible Playwright worker
 * Receives jobs via HTTP POST from Cloudflare Worker
 * Processes JS-heavy pages with Playwright
 * Calls back to Worker API with results
 */

const app = express()
app.use(express.json({ limit: '1mb' }))

interface ScrapeJob {
  jobId: string
  url: string
}

interface ScrapeResult {
  name: string
  price: string
  link: string
}

const API_BASE = process.env.API_BASE || 'http://localhost:8787'
const PORT = process.env.PORT || 3001

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

app.post('/api/scrape', async (req, res) => {
  const { jobId, url } = req.body as ScrapeJob

  if (!jobId || !url) {
    return res.status(400).json({ error: 'jobId and url required' })
  }

  console.log(`[${new Date().toISOString()}] Starting scrape job ${jobId}: ${url}`)

  try {
    // Update job status to running
    await fetch(`${API_BASE}/api/jobs/${jobId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'running', progress: 10 })
    }).catch(() => {})

    const browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    })

    const page = await browser.newPage()
    
    // Set realistic viewport and user agent
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.setExtraHTTPHeaders({
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    })

    await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 })

    // Update progress
    await fetch(`${API_BASE}/api/jobs/${jobId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ progress: 50 })
    }).catch(() => {})

    // Extract product data - generic selectors for common patterns
    const products = await page.evaluate(() => {
      const selectors = [
        '[data-product]',
        '[data-testid*="product"]',
        '.product-item',
        '.product-card',
        '.product',
        'article.product',
        'li.product',
        '[itemtype*="Product"]',
        '.item',
        '.grid-item'
      ]

      let items: Element[] = []
      for (const sel of selectors) {
        items = Array.from(document.querySelectorAll(sel))
        if (items.length > 0) break
      }

      // Fallback: any repeating structure with price-like content
      if (items.length === 0) {
        const all = document.querySelectorAll('div, article, li, section')
        items = Array.from(all).filter(el => {
          const text = el.textContent || ''
          return text.match(/\$\s*\d+|\d+\.\d{2}\s*(USD|EUR|GBP|€|£)/i)
        }).slice(0, 20)
      }

      return items.map(el => {
        const nameEl = el.querySelector('[data-testid*="name"], .title, .name, h1, h2, h3, h4, [itemprop="name"]')
        const priceEl = el.querySelector('[data-testid*="price"], .price, .cost, [itemprop="price"], [data-price]')
        const linkEl = el.querySelector('a[href]')

        return {
          name: nameEl?.textContent?.trim() || '',
          price: priceEl?.textContent?.trim() || '',
          link: linkEl?.href || ''
        }
      }).filter(p => p.name || p.price)
    })

    console.log(`[${new Date().toISOString()}] Job ${jobId} extracted ${products.length} products`)

    // Update job with results
    await fetch(`${API_BASE}/api/jobs/${jobId}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ results: products })
    })

    await browser.close()

    res.json({ success: true, jobId, count: products.length })
  } catch (err: any) {
    console.error(`[${new Date().toISOString()}] Job ${jobId} failed:`, err.message)

    await fetch(`${API_BASE}/api/jobs/${jobId}/fail`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message })
    }).catch(() => {})

    res.status(500).json({ error: err.message })
  }
})

app.listen(PORT, () => {
  console.log(`Playwright worker listening on port ${PORT}`)
  console.log(`API base: ${API_BASE}`)
})