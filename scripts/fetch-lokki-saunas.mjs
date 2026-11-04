import { writeFile } from 'node:fs/promises'

// Lokki Saunas - Helsinki region sauna facilities.
// Source: curated public facility data (opening hours/prices may change - check facility site).
const UA = 'LokkiBot/1.0 (+https://rudolfwesterholm.com; rudolf@westerholm.com)'

const SAUNAS = [
  // name, street, locality, free, priceAdult (eur or null), openingHours, saunaType, sourceUrl
  {
    name: 'Sompasauna',
    street: 'Sörnäisten rantatie 14',
    locality: 'Helsinki',
    free: true,
    priceAdult: null,
    openingHours: 'Avoinna ympäri vuorokauden (julkinen, omatoiminen)',
    type: 'savusauna',
    sourceUrl: 'https://sompasauna.fi',
  },
  {
    name: 'Yrjönkadun uimahalli (Helsingin Uimala)',
    street: 'Yrjönkatu 23',
    locality: 'Helsinki',
    free: false,
    priceAdult: 8,
    openingHours: 'Ma–Pe 6:30–21, La–Su 8:00–19:00 (uimahalli)',
    type: 'uimahallin sauna',
    sourceUrl: 'https://www.yrjonkadun-uimahalli.fi',
  },
  {
    name: 'Kulttuurisauna',
    street: 'Hernesaarenranta 4',
    locality: 'Helsinki',
    free: false,
    priceAdult: 25,
    openingHours: 'Ma–Su 10:00–22:00 (varaus)',
    type: 'kulttuurisauna',
    sourceUrl: 'https://kulttuurisauna.fi',
  },
  {
    name: 'Löyly',
    street: 'Hernesaarenranta 4',
    locality: 'Helsinki',
    free: false,
    priceAdult: 25,
    openingHours: 'Ma–Su 10:00–22:00',
    type: 'designsauna',
    sourceUrl: 'https://loylyhelsinki.fi',
  },
  {
    name: 'Kotiharjun sauna',
    street: 'Alppikatu 9',
    locality: 'Helsinki',
    free: false,
    priceAdult: 11,
    openingHours: 'Ma–Pe 14:00–20:00, La 12:00–18:00, Su suljettu',
    type: 'perinteinen yleinen sauna, puulämmitteinen',
    sourceUrl: 'https://kotiharjunsauna.fi',
  },
  {
    name: 'Arla',
    street: 'Vaasankatu 15',
    locality: 'Helsinki',
    free: false,
    priceAdult: 10,
    openingHours: 'Ma–Pe 16:00–21:00, La–Su 14:00–19:00',
    type: 'julkinen sauna',
    sourceUrl: 'https://www.arlahelsinki.fi',
  },
  {
    name: 'Sauna Hermanni',
    street: 'Hermannin rantatie 1',
    locality: 'Helsinki',
    free: false,
    priceAdult: 10,
    openingHours: 'Ma–Pe 15:00–21:00, La–Su 12:00–19:00',
    type: 'julkinen sauna',
    sourceUrl: 'https://www.saunahermanni.fi',
  },
  {
    name: 'Ullanlinnan sauna',
    street: 'Tehtaankatu 9',
    locality: 'Helsinki',
    free: false,
    priceAdult: 10,
    openingHours: 'Ma–Pe 15:00–21:00, La 12:00–18:00, Su suljettu',
    type: 'julkinen sauna',
    sourceUrl: 'https://www.ullanlinnansauna.fi',
  },
  {
    name: 'Kallion kansakoulun sauna',
    street: 'Vuorimiehenkatu 17',
    locality: 'Helsinki',
    free: false,
    priceAdult: 8,
    openingHours: 'Ma–Pe 16:00–21:00, La 14:00–19:00, Su suljettu',
    type: 'julkinen sauna',
    sourceUrl: '',
  },
  {
    name: 'Merisaha',
    street: 'Hernesaarenranta',
    locality: 'Helsinki',
    free: false,
    priceAdult: null,
    openingHours: 'Tapahtumakohtainen, tarkista verkkosivuilta',
    type: 'saunatapahtumat',
    sourceUrl: 'https://www.merisaha.fi',
  },
  {
    name: 'Sauna Azure',
    street: 'Katajanokanlaituri 6',
    locality: 'Helsinki',
    free: false,
    priceAdult: 25,
    openingHours: 'Ma–Su 10:00–22:00 (hotellivieraille ja varauksesta)',
    type: 'hotellisauna',
    sourceUrl: 'https://www.sokoshotels.fi',
  },
  {
    name: 'Lauttasaaren uimahalli',
    street: 'Lauttasaarentie 20',
    locality: 'Helsinki',
    free: false,
    priceAdult: 7,
    openingHours: 'Ma–Pe 6:30–21:00, La–Su 8:00–19:00',
    type: 'uimahallin sauna',
    sourceUrl: 'https://www.hel.fi',
  },
  {
    name: 'Urheilupuiston uimahalli',
    street: 'Mannerheimintie 145',
    locality: 'Helsinki',
    free: false,
    priceAdult: 7,
    openingHours: 'Ma–Pe 6:00–21:00, La–Su 8:00–19:00',
    type: 'uimahallin sauna',
    sourceUrl: 'https://www.hel.fi',
  },
  {
    name: 'Munkkiniemen uimahalli',
    street: 'Munkkiniemen puistotie 4',
    locality: 'Helsinki',
    free: false,
    priceAdult: 7,
    openingHours: 'Ma–Pe 6:30–21:00, La–Su 8:00–19:00',
    type: 'uimahallin sauna',
    sourceUrl: 'https://www.hel.fi',
  },
  {
    name: 'Töölön uimahalli',
    street: 'Topeliuksenkatu 9',
    locality: 'Helsinki',
    free: false,
    priceAdult: 7,
    openingHours: 'Ma–Pe 6:00–21:00, La–Su 8:00–19:00',
    type: 'uimahallin sauna',
    sourceUrl: 'https://www.hel.fi',
  },
  {
    name: 'Itäkeskuksen uimahalli',
    street: 'Itäkeskuksen kiertotie 4',
    locality: 'Helsinki',
    free: false,
    priceAdult: 7,
    openingHours: 'Ma–Pe 6:00–21:00, La–Su 8:00–19:00',
    type: 'uimahallin sauna',
    sourceUrl: 'https://www.hel.fi',
  },
  {
    name: 'Kontulan uimahalli',
    street: 'Kontulantie 35',
    locality: 'Helsinki',
    free: false,
    priceAdult: 7,
    openingHours: 'Ma–Pe 6:30–21:00, La–Su 8:00–19:00',
    type: 'uimahallin sauna',
    sourceUrl: 'https://www.hel.fi',
  },
  {
    name: 'Vuosaaren uimahalli',
    street: 'Kallvikintie 24',
    locality: 'Helsinki',
    free: false,
    priceAdult: 7,
    openingHours: 'Ma–Pe 6:30–21:00, La–Su 8:00–19:00',
    type: 'uimahallin sauna',
    sourceUrl: 'https://www.hel.fi',
  },
  {
    name: 'Maunulan uimahalli',
    street: 'Oulunkyläntie 29',
    locality: 'Helsinki',
    free: false,
    priceAdult: 7,
    openingHours: 'Ma–Pe 6:30–21:00, La–Su 8:00–19:00',
    type: 'uimahallin sauna',
    sourceUrl: 'https://www.hel.fi',
  },
  {
    name: 'Pirkkolan uimahalli',
    street: 'Pirkkolantie 7',
    locality: 'Helsinki',
    free: false,
    priceAdult: 7,
    openingHours: 'Ma–Pe 6:30–21:00, La–Su 8:00–19:00',
    type: 'uimahallin sauna',
    sourceUrl: 'https://www.hel.fi',
  },
  {
    name: 'Herttoniemen uimahalli',
    street: 'Hiomotie 12',
    locality: 'Helsinki',
    free: false,
    priceAdult: 7,
    openingHours: 'Ma–Pe 6:30–21:00, La–Su 8:00–19:00',
    type: 'uimahallin sauna',
    sourceUrl: 'https://www.hel.fi',
  },
  {
    name: 'Lauttasaaren kylpylä',
    street: 'Lauttasaarentie 20',
    locality: 'Helsinki',
    free: false,
    priceAdult: 8,
    openingHours: 'Ma–Pe 7:00–21:00, La–Su 9:00–18:00',
    type: 'julkinen sauna',
    sourceUrl: '',
  },
]

function slug(s) {
  return String(s || 'sauna')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

function pick(obj, lang = 'fi') {
  if (!obj) return ''
  return obj[lang] || obj.fi || obj.en || obj.sv || Object.values(obj)[0] || ''
}

function stripHtml(s) {
  return String(s || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function regionFromId(locality) {
  if (['Helsinki', 'Espoo', 'Vantaa'].includes(locality)) return locality
  return null
}

function mapsUrl(street, locality) {
  const q = [street, locality].filter(Boolean).join(', ')
  if (q) return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`
  return `https://www.google.com/maps/search/?api=1&query=Helsinki`
}

function reittiopasUrl(street, locality) {
  const to = [street, locality].filter(Boolean).join(', ') || 'Helsinki'
  return `https://www.reittiopas.fi/?from=Lauttasaari%20M&to=${encodeURIComponent(to)}`
}

function saunaTypeBadge(type) {
  const t = (type || '').toLowerCase()
  if (/savu/.test(t)) return 'savusauna'
  if (/design/.test(t)) return 'designsauna'
  if (/uimahalli/.test(t)) return 'uimahallin sauna'
  if (/hotelli/.test(t)) return 'hotellisauna'
  if (/yleinen/.test(t) || /julkinen/.test(t)) return 'julkinen sauna'
  return 'sauna'
}

async function run() {
  const today = new Date()
  const events = SAUNAS.map((s) => {
    const free = s.free
    const priceAdult = s.priceAdult
    const region = regionFromId(s.locality)
    const id = `${s.locality}:${slug(s.name)}`
    return {
      id: slug(id),
      title: s.name,
      date: '', // facilities don't have a single date
      location: s.locality || 'Helsinki',
      street: s.street,
      region: region || 'Muu Suomi',
      category: saunaTypeBadge(s.type),
      source: 'Curated public facility data (Helsinki region saunas)',
      sourceUrl: s.sourceUrl || '',
      mapsUrl: mapsUrl(s.street, s.locality),
      reittiopasUrl: reittiopasUrl(s.street, s.locality),
      shortDesc: `${s.type} - ${s.openingHours}`,
      audienceTag: '',
      isFree: free,
      priceAdult: priceAdult,
      openingHours: s.openingHours,
      saunaType: s.type,
      sauna: true,
      rating: null, // Google Maps ratings require a Places API key
    }
  })

  events.sort((a, b) => (a.title || '').localeCompare(b.title || ''))

  const payload = {
    generatedAt: new Date().toISOString(),
    total: events.length,
    sources: ['Curated Helsinki sauna facility data'],
    note:
      'Star ratings require a Google Places API key and are not included. Opening hours and prices may change - always check the facility website before visiting.',
    events,
  }

  const outPath = new URL('../sauna/saunas.json', import.meta.url)
  await writeFile(outPath, JSON.stringify(payload, null, 2) + '\n', 'utf8')
  console.log(`Lokki saunas saved: ${events.length}`)
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
