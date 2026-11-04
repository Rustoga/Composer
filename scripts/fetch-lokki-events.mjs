import { writeFile } from 'node:fs/promises'
import https from 'node:https'
import http from 'node:http'

// Lokki - Free events scraper for Helsinki, Espoo and Vantaa.
// Source: Linked Events open API (MyHelsinki avoin data). We fetch the normal
// event stream and then keep only genuinely free items by checking the API's free
// flags and common price text patterns, which matches the behavior of the
// reference page more closely than a strict `is_free=true` filter alone.

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
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
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

function priceTextFromEvent(ev) {
  const offers = Array.isArray(ev && ev.offers) ? ev.offers : []
  const textParts = []

  if (ev && typeof ev.price === 'string') textParts.push(ev.price)
  if (ev && typeof ev.price === 'object') textParts.push(pick(ev.price))

  for (const offer of offers) {
    if (!offer) continue
    if (typeof offer.price === 'string') textParts.push(offer.price)
    if (offer.price && typeof offer.price === 'object') {
      textParts.push(pick(offer.price))
    }
    if (typeof offer.description === 'string') textParts.push(offer.description)
    if (offer.description && typeof offer.description === 'object') {
      textParts.push(pick(offer.description))
    }
    if (offer.is_free === true) textParts.push('ilmainen')
  }

  if (ev && typeof ev.description === 'string') textParts.push(ev.description)
  if (ev && ev.sub_events && Array.isArray(ev.sub_events)) {
    for (const se of ev.sub_events) {
      if (se && se.offers) {
        for (const off of se.offers) {
          if (!off) continue
          if (typeof off.price === 'string') textParts.push(off.price)
          if (off.price && typeof off.price === 'object') {
            textParts.push(pick(off.price))
          }
          if (off.is_free === true) textParts.push('ilmainen')
        }
      }
    }
  }

  return [
    pick(ev && ev.name),
    stripHtml(pick(ev && ev.description)),
    ...textParts,
  ]
    .join(' ')
    .toLowerCase()
}

function isFreeEvent(ev) {
  if (!ev) return false

  if (ev.is_free === true) return true

  const offers = Array.isArray(ev.offers) ? ev.offers : []
  if (offers.some((offer) => offer && offer.is_free === true)) return true

  if (ev.sub_events && Array.isArray(ev.sub_events)) {
    if (ev.sub_events.some((se) => se && se.is_free === true)) return true
    for (const se of ev.sub_events) {
      const so = Array.isArray(se.offers) ? se.offers : []
      if (so.some((o) => o && o.is_free === true)) return true
    }
  }

  return FREE_PRICE.test(priceTextFromEvent(ev))
}

function freeProof(ev) {
  if (!ev) return 'Ilmainen'
  if (ev.is_free === true) return 'Ilmainen (is_free)'

  const offers = Array.isArray(ev.offers) ? ev.offers : []
  const offerFree = offers.find((o) => o && o.is_free === true)
  if (offerFree) return 'Ilmainen (offer.is_free)'

  if (ev.sub_events && Array.isArray(ev.sub_events)) {
    for (const se of ev.sub_events) {
      const of = Array.isArray(se.offers)
        ? se.offers.find((o) => o && o.is_free === true)
        : null
      if (of) return 'Ilmainen (sub-event offer.is_free)'
    }
  }

  const price = pick((offers[0] && offers[0].price) || ev.price) || ''
  return price ? `Hinta: ${price}` : 'Ilmainen'
}

function regionFromId(id, locality) {
  if (locality && ['Helsinki', 'Espoo', 'Vantaa'].includes(locality))
    return locality
  const m = /event\/([a-z0-9_]+):/i.exec(id || '')
  const src = m ? m[1].toLowerCase() : ''
  const MAP = { helsinki: 'Helsinki', 'helsinki-extra': 'Helsinki', hkm: 'Helsinki', espoo: 'Espoo', espoo_le: 'Espoo', vantaa: 'Vantaa' }
  if (MAP[src]) return MAP[src]
  if (['Helsinki', 'Espoo', 'Vantaa'].includes(locality)) return locality
  return null
}

function getLocation(ev) {
  const loc = ev.location || {}
  const locality = pick(loc.address_locality) || ''
  const street = pick(loc.street_address) || ''
  const pos = loc && loc.position ? loc.position : null
  const coordinates = pos && Array.isArray(pos.coordinates) ? pos.coordinates : null
  // GeoJSON: coordinates = [lon, lat]
  const lon = coordinates ? Number(coordinates[0]) : null
  const lat = coordinates ? Number(coordinates[1]) : null
  const region = regionFromId(ev['@id'], locality)
  return { locality, street, lat, lon, region }
}

function mapsUrl(loc) {
  const q = [loc.street, loc.locality].filter(Boolean).join(', ')
  if (q) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`
  }
  if (loc.lat != null && loc.lon != null) {
    return `https://www.google.com/maps/search/?api=1&query=${loc.lat},${loc.lon}`
  }
  return `https://www.google.com/maps/search/?api=1&query=Helsinki`
}

function reittiopasUrl(loc) {
  const to = [loc.street, loc.locality].filter(Boolean).join(', ') || 'Helsinki'
  return `https://www.reittiopas.fi/?from=Lauttasaari%20M&to=${encodeURIComponent(to)}`
}

function isSauna(ev, name, desc) {
  const d = stripHtml(desc || '').toLowerCase()
  const n = stripHtml(name || '').toLowerCase()
  const t = `${d} ${n}`

  // Strong: you can actually use/visit the sauna (activity/use words)
  const saunaUse = /saunonta|saunominen|saunotaan|saunomaan|saunaan|saunassa|saunavuoro|saunailta|saunomassa|pääsee\s+saunaan|sauna\s+on|sauna\s+käytössä|sauna\s+lämmin|sauna\s+lämpim/.test(d)

  // Weak but real: bare "sauna" mentioned in description (e.g. "sauna on lämmin", "sauna käy")
  const saunaMention = /\bsauna\b/.test(d)

  // Sauna-equipped facility mentioned in description
  const saunaPlace = /uimahalli|uimala|kylpylä/.test(d)

  // Only mentions a dressing/changing room in a sauna space — not usable
  const onlyDressingRoom = /pukuhuone|puku.?huone|vaihtaa\s+vaatteita/.test(d)

  if (saunaUse) return true
  if ((saunaMention || saunaPlace) && !onlyDressingRoom) return true
  // Bare "sauna" only in title (e.g. puppet show "Saunatonttu") is not a usable sauna
  return false
}

function extractAdultPrice(desc) {
  const t = desc || ''
  const patterns = [
    /(\d+)\s*€?\s*\/\s*aikuiset/i,
    /aikuiset\s+(\d+)\s*€?/i,
    /(\d+)\s*€?\s*aikuisille/i,
    /aikuisille\s+(\d+)\s*€?/i,
    /(\d+)\s*€?\s*\/\s*aikuinen/i,
    /aikuinen\s+(\d+)\s*€?/i,
    /(\d+)\s*€?\s*aikuisilta/i,
    /aikuisilta\s+(\d+)\s*€?/i,
    /hinta:\s*(\d+)\s*€?/i,
    /(\d+)\s*€?\s*aikuista/i,
  ]
  for (const pat of patterns) {
    const m = t.match(pat)
    if (m) return Number(m[1])
  }
  return null
}

function inferCategory(text, sauna) {
  const t = (text || '').toLowerCase()
  if (sauna) return 'Sauna & Wellness'
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

function eventPathFromId(id) {
  const m = /event\/([a-z0-9_]+):([a-z0-9_-]+)/i.exec(id || '')
  if (m) return `https://tapahtumat.hel.fi/fi/events/${m[1]}:${m[2]}/`
  return null
}

function audienceTag(desc) {
  const t = stripHtml(desc || '')
  const m = t.match(/tapahtuma on tarkoitettu[^.]*\.?/i)
  if (!m) return ''
  const segment = m[0]
  const low = segment.toLowerCase()
  if (/palvelukeskuskortti/.test(low)) return 'palvelukeskuskortti'
  if (/koko perhe|perhe/.test(low)) return 'Koko perhe'
  if (/aikuis/.test(low)) return 'Aikuisille'
  if (/lapsi/.test(low)) return 'Lapsille'
  if (/nuori/.test(low)) return 'Nuorille'
  if (/eläkel/.test(low)) return 'Eläkeläisille'
  if (/työtön/.test(low)) return 'Työttömille'
  return ''
}

const ACTIVITY_VERBS = [
  'maalaillaan', 'maalataan', 'muovaillaan', 'leikataan', 'liimataan',
  'piirretään', 'askarrellaan', 'luetaan', 'lasketaan', 'lasketaan',
  'lauletaan', 'tanssitaan', 'soitetaan', 'liikutaan', 'ulkoillaan',
  'pelataan', 'harjoitellaan', 'opetellaan', 'kokeillaan', 'tehdään',
  'rakennetaan', 'ommellaan', 'neulotaan', 'kirjoitetaan', 'luodaan',
]

function shortDesc(desc, title) {
  const t = stripHtml(desc || '')
  if (!t) return ''
  const titleNorm = stripHtml(title || '').toLowerCase()
  const sentences = t.split(/(?<=[.!?])\s+/).filter(Boolean)
  let chosen = ''
  for (const s of sentences) {
    const sLow = s.toLowerCase()
    if (sLow === titleNorm || sLow.includes(titleNorm)) continue
    chosen += (chosen ? ' ' : '') + s
    if (chosen.length > 150) break
  }
  chosen = chosen.trim().slice(0, 150)
  if (!chosen) return ''
  const hasVerb = ACTIVITY_VERBS.some((v) => chosen.toLowerCase().includes(v))
  return hasVerb || chosen.length < 150 ? chosen : ''
}

function parseIso(s) {
  if (!s) return null
  const d = new Date(s)
  if (isNaN(d.getTime())) return null
  const y = d.getUTCFullYear()
  if (y < 2000 || y > 2100) return null
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
  const dateStr = `${p.year}-${p.month}-${p.day}`
  let targetHour
  if (h < 6) targetHour = 6
  else if (h < 19) targetHour = 19
  else targetHour = 30

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
    return new Date(`${tp.year}-${tp.month}-${tp.day}T06:00:00+03:00`).toISOString()
  }

  return new Date(`${dateStr}T${String(targetHour).padStart(2, '0')}:00:00+03:00`).toISOString()
}

async function collect() {
  const events = []
  const seen = new Set()
  const today = new Date().toISOString().slice(0, 10)
  let url = `${API_BASE}?language=fi&page_size=100&start=${today}&include=location`
  let pages = 0

  while (url && pages < 20) {
    pages++
    const data = await fetchJson(url)

    for (const ev of data.data || []) {
      const start = parseIso(ev.start_time)
      if (!isFuture(start)) continue

      const name = pick(ev.name) || 'Tapahtuma'
      const desc = stripHtml(pick(ev.description))

      const sauna = isSauna(ev, name, desc)
      const priceAdult = extractAdultPrice(desc)

      // Contradicting info: real price in description wins over API free flag
      let isFree = isFreeEvent(ev)
      if (sauna && priceAdult != null) {
        isFree = false
      }

      // Non-sauna events: only free. Sauna events: free OR explicit adult price.
      if (!isFree && !sauna) continue
      if (sauna && !isFree && priceAdult == null) continue
      const loc = getLocation(ev)
      const humanUrl = eventPathFromId(ev['@id'])
      const infoUrl = pick(ev.info_url) || ''
      const sourceUrl = humanUrl || infoUrl || ev['@id'] || ''
      const id = ev['@id'] || infoUrl || name
      const dateKey = start ? start.toISOString().slice(0, 10) : ''
      const key = `${name}|${dateKey}|${loc.locality}|${loc.street}`

      if (seen.has(key)) continue
      seen.add(key)

      if (!loc.region) continue

      events.push({
        id: slug(id),
        title: name,
        date: start ? start.toISOString() : '',
        location: loc.locality || 'Helsinki',
        street: loc.street,
        region: loc.region,
        category: inferCategory(`${name} ${desc}`, sauna),
        source: 'Linked Events (MyHelsinki avoin data)',
        sourceUrl: sourceUrl,
        mapsUrl: mapsUrl(loc),
        reittiopasUrl: reittiopasUrl(loc),
        shortDesc: shortDesc(desc, name),
        audienceTag: audienceTag(desc),
        isFree,
        priceAdult,
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
