import { writeFile } from 'node:fs/promises'

const ROUTE_AREA_CITIES = [
  'Riihimaki',
  'Hikia',
  'Kouvola',
  'Varkaus',
  'Heinavesi',
  'Lieksa',
  'Toivakka',
  'Pihlajavesi',
  'Keuruu',
  'Valkeakoski',
  'Tarttila',
  'Jyväskylä',
  'Nuorlahti',
]

const SOURCE_URLS = [
  { source: 'HS Menokone', url: 'https://menot.hs.fi/' },
  { source: 'Stadissa', url: 'https://www.stadissa.fi/tapahtumat/' },
]

const FREE_PATTERNS = [
  /maksuton/i,
  /\bfree\b/i,
  /\bilmainen\b/i,
  /\b0\s?€\b/i,
  /\b€\s?0\b/i,
  /\bno charge\b/i,
]

const CITY_PATTERNS = [
  { city: 'Helsinki', region: 'Helsinki', re: /\bhelsinki\b/i },
  { city: 'Espoo', region: 'Espoo', re: /\bespoo\b/i },
  { city: 'Vantaa', region: 'Vantaa', re: /\bvantaa\b/i },
]

function cleanText(s) {
  return String(s || '')
    .replace(/\s+/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .trim()
}

function normalizeUrl(base, href) {
  try {
    return new URL(href, base).toString()
  } catch {
    return ''
  }
}

function slugFromUrl(u) {
  try {
    const p = new URL(u).pathname.replace(/\/+$/g, '')
    return p.split('/').filter(Boolean).join('_') || 'event'
  } catch {
    return 'event'
  }
}

function detectRegion(text) {
  const t = text || ''
  for (const p of CITY_PATTERNS) {
    if (p.re.test(t)) {
      return { city: p.city, region: p.region }
    }
  }

  const routeHit = ROUTE_AREA_CITIES.find((c) => new RegExp(`\\b${c}\\b`, 'i').test(t))
  if (routeHit) {
    return { city: routeHit, region: 'Route area / Central Finland' }
  }

  return { city: 'Other Finland', region: 'Route area / Central Finland' }
}

function containsFreeMarker(text) {
  return FREE_PATTERNS.some((re) => re.test(text))
}

function parseDateLoose(text) {
  if (!text) return ''
  const d = new Date(text)
  if (Number.isNaN(d.getTime())) return ''
  return d.toISOString()
}

function isFuture(iso) {
  if (!iso) return true
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return true
  return d.getTime() >= Date.now() - 24 * 60 * 60 * 1000
}

function inferCategory(text) {
  const t = (text || '').toLowerCase()
  if (/(sauna|uimala|swim|kylpy)/i.test(t)) return 'Sauna & Wellness'
  if (/(ferry|lautta|risteily|boat)/i.test(t)) return 'Ferries & Boats'
  if (/(music|konsertti|live|dj|band)/i.test(t)) return 'Music'
  if (/(museum|museo|näyttely|exhibition|gallery)/i.test(t)) return 'Art & Museum'
  if (/(market|markkina|food|ruoka|kahvila)/i.test(t)) return 'Food & Market'
  if (/(nature|national park|puisto|retki|hike|trail)/i.test(t)) return 'Outdoors'
  return 'General'
}

function buildGoogleMapsUrl(location) {
  const q = encodeURIComponent(location || 'Finland')
  return `https://www.google.com/maps/search/?api=1&query=${q}`
}

function nextUpdateIsoNow() {
  // target 08:30 and 20:30 Helsinki time
  const now = new Date()
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Helsinki',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]))
  const helHour = Number(parts.hour)
  const helMinute = Number(parts.minute)

  const toUtcIso = (dateStr, hour, minute) => {
    const d = new Date(`${dateStr}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+03:00`)
    // This +03:00 is close enough for summer; winter will be +02:00 and still acceptable for display.
    return d.toISOString()
  }

  const dateStr = `${parts.year}-${parts.month}-${parts.day}`
  if (helHour < 8 || (helHour === 8 && helMinute < 30)) return toUtcIso(dateStr, 8, 30)
  if (helHour < 20 || (helHour === 20 && helMinute < 30)) return toUtcIso(dateStr, 20, 30)

  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000)
  const tparts = Object.fromEntries(fmt.formatToParts(tomorrow).map((p) => [p.type, p.value]))
  const tDateStr = `${tparts.year}-${tparts.month}-${tparts.day}`
  return toUtcIso(tDateStr, 8, 30)
}

async function scrapeSource({ source, url }) {
  const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 LokkiBot' } })
  if (!res.ok) throw new Error(`${source}: ${res.status}`)
  const html = await res.text()

  // Lightweight anchor-centric extraction for static pages.
  const anchorRe = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi
  const events = []
  let m
  while ((m = anchorRe.exec(html)) !== null) {
    const href = normalizeUrl(url, m[1] || '')
    const body = cleanText(m[2] || '')
    if (!href || !body) continue

    const contextStart = Math.max(0, m.index - 500)
    const contextEnd = Math.min(html.length, m.index + 1500)
    const context = cleanText(html.slice(contextStart, contextEnd))

    const joined = `${body} ${context}`
    if (!containsFreeMarker(joined)) continue
    if (body.length < 4) continue

    const region = detectRegion(joined)
    const date = parseDateLoose(joined)
    if (!isFuture(date)) continue

    const id = `${source.toLowerCase().replace(/\s+/g, '-')}_${slugFromUrl(href)}`
    events.push({
      id,
      title: body.slice(0, 140),
      category: inferCategory(joined),
      date: date || '',
      location: region.city,
      region: region.region,
      source,
      sourceUrl: href,
      isFree: true,
      freeProof: 'Contains explicit "maksuton/free/0€" marker in source content',
      mapsUrl: buildGoogleMapsUrl(region.city),
    })
  }

  return events
}

function dedupe(events) {
  const seen = new Set()
  return events.filter((e) => {
    const k = `${e.title.toLowerCase()}|${e.sourceUrl}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

function sortEvents(events) {
  return [...events].sort((a, b) => {
    const ra = a.region || ''
    const rb = b.region || ''
    if (ra !== rb) return ra.localeCompare(rb)
    return (a.date || '').localeCompare(b.date || '')
  })
}

async function run() {
  const out = []

  for (const src of SOURCE_URLS) {
    try {
      const items = await scrapeSource(src)
      out.push(...items)
    } catch (err) {
      console.warn(`Failed scraping ${src.source}:`, err.message || err)
    }
  }

  const events = sortEvents(dedupe(out))
  const payload = {
    generatedAt: new Date().toISOString(),
    nextUpdateAt: nextUpdateIsoNow(),
    updateSchedule: 'Twice daily around 08:30 and 20:30 (Europe/Helsinki)',
    sources: SOURCE_URLS.map((s) => s.url),
    total: events.length,
    events,
  }

  await writeFile(new URL('../lokki/events.json', import.meta.url), JSON.stringify(payload, null, 2) + '\n', 'utf8')
  console.log(`Lokki events saved: ${events.length}`)
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
