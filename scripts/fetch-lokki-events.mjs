import { writeFile } from 'node:fs/promises'
import https from 'node:https'
import http from 'node:http'

// Lokki - Free events scraper for Helsinki, Espoo and Vantaa.
// Source: Linked Events open API (MyHelsinki avoin data) - reliable JSON with
// is_free flag, coordinates, addresses and info_url. This replaces the old
// fragile HTML scraping of HS Menokone / Stadissa.

const UA =
  'LokkiBot/1.0 (+https://rudolfwesterholm.com; rudolf@westerholm.com)'
const API_BASE = 'https://api.hel.fi/linkedevents/v1/event/'

const FREE_PRICE = /ilmainen|vapaa\s*pääsy|maksuton|\bfree\b|no charge|0\s?€|€\s?0/i

function fetchText(url, redirects = 4) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http
    const req = lib.get(
      url,
      { headers: { 'user-agent': UA, accept: 'application/json' } },
      (res) => {
        const { statusCode, headers } = res
        if (
          statusCode >= 300 &&
          statusCode < 400 &&
          headers.location &&
          redirects > 0
        ) {
          res.resume()
          const next = new URL(headers.location, url).toString()
          return resolve(fetchText(next, redirects - 1))
        }
        if (statusCode !== 200) {
          res.resume()
          return reject(new Error(`HTTP ${statusCode} for ${url}`))
        }
        let data = ''
        res.setEncoding('utf8')
        res.on('data', (c) => (data += c))
        res.on('end', () => resolve(data))
      }
    )
    req.on('error', reject)
    req.setTimeout(30000, () => req.destroy(new Error('timeout')))
  })
}

async function fetchJson(url) {
  return JSON.parse(await fetchText(url))
}

function pick(obj, lang = 'fi') {
  if (!obj) return ''
  return (
    obj[lang] || obj.fi || obj.en || obj.sv || Object.values(obj)[0] || ''
  )
}

function stripHtml(s) {
  return String(s || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function slug(s) {
  return String(s || 'event')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

function isFreeEvent(ev) {
  const off = (ev.offers && ev.offers[0]) || {}
  if (off.is_free === true) return true
  const price = pick(off.price) || ''
  return FREE_PRICE.test(price)
}

function freeProof(ev) {
  const off = (ev.offers && ev.offers[0]) || {}
  if (off.is_free === true) return 'Ilmainen (is_free)'
  const price = pick(off.price)
  return price ? `Hinta: ${price}` : 'Ilmainen'
}

function regionFromId(id, locality) {
  if (locality && ['Helsinki', 'Espoo', 'Vantaa'].includes(locality))
    return locality
  const m = /event\/([a-z0-9]+):/i.exec(id || '')
  const src = m ? m[1].toLowerCase() : ''
  const MAP = { helsinki: 'Helsinki', hkm: 'Helsinki', espoo: 'Espoo', vantaa: 'Vantaa' }
  if (MAP[src]) return MAP[src]
  return locality || 'Muu Suomi'
}

function getLocation(ev) {
  const loc = ev.location || {}
  const locality = pick(loc.address_locality) || ''
  const street = pick(loc.street_address) || ''
  const lat = loc.lat != null ? Number(loc.lat) : null
  const lon = loc.lon != null ? Number(loc.lon) : null
  const region = regionFromId(ev['@id'], locality)
  return { locality, street, lat, lon, region }
}

function mapsUrl(loc) {
  if (loc.lat != null && loc.lon != null) {
    return `https://www.google.com/maps/search/?api=1&query=${loc.lat},${loc.lon}`
  }
  const q = encodeURIComponent(
    [loc.street, loc.locality].filter(Boolean).join(', ') || 'Helsinki'
  )
  return `https://www.google.com/maps/search/?api=1&query=${q}`
}

function reittiopasUrl(loc) {
  if (loc.lat != null && loc.lon != null) {
    return `https://www.reittiopas.fi/#!to@${loc.lon},${loc.lat}`
  }
  const q = encodeURIComponent(
    [loc.street, loc.locality].filter(Boolean).join(', ') || 'Helsinki'
  )
  return `https://www.reittiopas.fi/?to=${q}`
}

function isSauna(ev, name, desc) {
  return /sauna|uimala|kylpyl|uimahalli|uima-allas/i.test(
    `${name} ${desc}`
  )
}

function inferCategory(text) {
  const t = (text || '').toLowerCase()
  if (/(sauna|uimala|swim|kylpy)/i.test(t)) return 'Sauna & Wellness'
  if (/(ferry|lautta|risteily|boat)/i.test(t)) return 'Ferries & Boats'
  if (/(music|konsertti|live|dj|band|keikka|festivaali)/i.test(t))
    return 'Music'
  if (/(museum|museo|näyttely|exhibition|gallery|taide)/i.test(t))
    return 'Art & Museum'
  if (/(market|markkina|food|ruoka|kahvila|ravintola)/i.test(t))
    return 'Food & Market'
  if (/(nature|national park|puisto|retki|hike|trail|ulkoilma)/i.test(t))
    return 'Outdoors'
  return 'General'
}

function parseIso(s) {
  if (!s) return null
  const d = new Date(s)
  if (isNaN(d.getTime())) return null
  const y = d.getUTCFullYear()
  if (y < 2000 || y > 2100) return null // guard against malformed years (e.g. 0026)
  return d
}

function isFuture(d) {
  if (!d) return false
  return d.getTime() >= Date.now() - 24 * 3600 * 1000
}

function helsinkiParts() {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Helsinki',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  return Object.fromEntries(fmt.formatToParts(new Date()).map((p) => [p.type, p.value]))
}

function nextUpdateIso() {
  const p = helsinkiParts()
  const h = Number(p.hour)
  const minute = Number(p.minute)
  const dateStr = `${p.year}-${p.month}-${p.day}`
  let targetHour
  if (h < 6) targetHour = 6
  else if (h < 19) targetHour = 19
  else targetHour = 30 // next day 06:00
  if (targetHour === 30) {
    const t = new Date(Date.now() + 24 * 3600 * 1000)
    const tp = Object.fromEntries(
      new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/Helsinki',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      })
        .formatToParts(t)
        .map((x) => [x.type, x.value])
    )
    return new Date(
      `${tp.year}-${tp.month}-${tp.day}T06:00:00+03:00`
    ).toISOString()
  }
  return new Date(
    `${dateStr}T${String(targetHour).padStart(2, '0')}:00:00+03:00`
  ).toISOString()
}

async function collect() {
  const events = []
  const seen = new Set()
  const today = new Date().toISOString().slice(0, 10)
  let url = `${API_BASE}?language=fi&page_size=100&sort=start_time&start=${today}`
  let pages = 0

  while (url && pages < 8) {
    pages++
    const data = await fetchJson(url)
    for (const ev of data.data || []) {
      if (!isFreeEvent(ev)) continue
      const start = parseIso(ev.start_time)
      if (!isFuture(start)) continue

      const name = pick(ev.name) || 'Tapahtuma'
      const desc = stripHtml(pick(ev.description))
      const loc = getLocation(ev)
      const infoUrl = pick(ev.info_url) || ev['@id'] || ''
      const id = ev['@id'] || infoUrl || name
      const dateKey = start ? start.toISOString().slice(0, 10) : ''
      const key = `${name}|${dateKey}|${loc.locality}|${loc.street}`

      if (seen.has(key)) continue
      seen.add(key)

      const sauna = isSauna(ev, name, desc)
      events.push({
        id: slug(id),
        title: name,
        date: start ? start.toISOString() : '',
        location: loc.locality || 'Helsinki',
        street: loc.street,
        region: loc.region,
        category: inferCategory(`${name} ${desc}`),
        source: 'Linked Events (MyHelsinki avoin data)',
        sourceUrl: infoUrl,
        mapsUrl: mapsUrl(loc),
        reittiopasUrl: reittiopasUrl(loc),
        isFree: true,
        freeProof: freeProof(ev),
        sauna,
      })
    }
    url = (data.meta && data.meta.next) || null
  }

  events.sort((a, b) => (a.date || '').localeCompare(b.date || ''))
  return events
}

async function run() {
  const events = await collect()
  const payload = {
    generatedAt: new Date().toISOString(),
    nextUpdateAt: nextUpdateIso(),
    updateSchedule: 'Twice daily at 06:00 and 19:00 (Europe/Helsinki)',
    sources: ['https://api.hel.fi/linkedevents/v1/event/'],
    total: events.length,
    events,
  }

  const outPath = new URL('../lokki/events.json', import.meta.url)
  await writeFile(outPath, JSON.stringify(payload, null, 2) + '\n', 'utf8')
  console.log(`Lokki events saved: ${events.length}`)
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
