import { writeFile } from 'node:fs/promises'

// Lokki Saunas - Helsinki region sauna facilities.
// Source: curated public facility data (opening hours/prices may change - check facility site).
const UA = 'LokkiBot/1.0 (+https://rudolfwesterholm.com; rudolf@westerholm.com)'

const SAUNAS = [
  {
    name: 'Sompasauna',
    street: 'Sörnäisten rantatie 14',
    locality: 'Helsinki',
    lat: 60.1770,
    lon: 24.9560,
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
    lat: 60.1690,
    lon: 24.9320,
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
    lat: 60.1546,
    lon: 24.9196,
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
    lat: 60.1546,
    lon: 24.9196,
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
    lat: 60.1834,
    lon: 24.9365,
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
    lat: 60.1786,
    lon: 24.9441,
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
    lat: 60.1871,
    lon: 24.9633,
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
    lat: 60.1584,
    lon: 24.9399,
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
    lat: 60.1707,
    lon: 24.9436,
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
    lat: 60.1546,
    lon: 24.9196,
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
    lat: 60.1655,
    lon: 24.9542,
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
    lat: 60.1574,
    lon: 24.9027,
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
    lat: 60.1894,
    lon: 24.9189,
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
    lat: 60.2047,
    lon: 24.8786,
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
    lat: 60.1830,
    lon: 24.9223,
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
    lat: 60.2155,
    lon: 25.0647,
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
    lat: 60.2312,
    lon: 25.0848,
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
    lat: 60.2180,
    lon: 25.1650,
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
    lat: 60.2234,
    lon: 24.9006,
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
    lat: 60.2204,
    lon: 24.9524,
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
    lat: 60.1914,
    lon: 25.0140,
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
    lat: 60.1574,
    lon: 24.9027,
    free: false,
    priceAdult: 8,
    openingHours: 'Ma–Pe 7:00–21:00, La–Su 9:00–18:00',
    type: 'julkinen sauna',
    sourceUrl: '',
  },
  {
    name: 'Rajaportin sauna',
    street: 'Pispalan valtatie 79',
    locality: 'Tampere',
    lat: 61.4978,
    lon: 23.7608,
    free: false,
    priceAdult: 10,
    priceDetails: {
      label: 'Päivähinta',
      items: [
        { days: 'ma, ke', adult: 8, reduced: 7 },
        { days: 'pe, la', adult: 12, reduced: 11 },
      ],
      note: '(*) alennusryhmät: eläkeläiset, opiskelijat, työttömät, lapset',
    },
    openingHours: 'Ma–Pe 16:00–22:00, La–Su 12:00–20:00',
    type: 'julkinen sauna, vanhin julkinen sauna',
    sourceUrl: 'https://www.rajaportinsauna.fi',
  },
  {
    name: 'Tampereen uimahalli',
    street: 'Tullinkulman puistokatu 4',
    locality: 'Tampere',
    lat: 61.4975,
    lon: 23.7588,
    free: false,
    priceAdult: 7,
    openingHours: 'Ma–Pe 6:00–21:00, La–Su 8:00–19:00',
    type: 'uimahallin sauna',
    sourceUrl: 'https://www.tampere.fi',
  },
  {
    name: 'Rauhaniemen kansankylpylä',
    street: 'Rauhankatu 32',
    locality: 'Turku',
    lat: 60.4392,
    lon: 22.2192,
    free: false,
    priceAdult: 9,
    openingHours: 'Ma–Pe 10:00–21:00, La–Su 10:00–19:00',
    type: 'julkinen merenrantasauna',
    sourceUrl: 'https://www.turku.fi',
  },
  {
    name: 'Impivaaran uimahalli',
    street: 'Impivaarankatu 4',
    locality: 'Turku',
    lat: 60.4430,
    lon: 22.2300,
    free: false,
    priceAdult: 7,
    openingHours: 'Ma–Pe 6:00–21:00, La–Su 8:00–19:00',
    type: 'uimahallin sauna',
    sourceUrl: 'https://www.turku.fi',
  },
  {
    name: 'Lutakko',
    street: 'Lutakontie 9',
    locality: 'Jyväskylä',
    lat: 62.2426,
    lon: 25.7444,
    free: false,
    priceAdult: 10,
    openingHours: 'Ma–Pe 14:00–21:00, La–Su 12:00–19:00',
    type: 'julkinen yleinen sauna',
    sourceUrl: 'https://www.jyvaskyla.fi',
  },
  {
    name: 'Oulun uimahalli',
    street: 'Lohikatu 8',
    locality: 'Oulu',
    lat: 65.0121,
    lon: 25.4681,
    free: false,
    priceAdult: 7,
    openingHours: 'Ma–Pe 6:00–21:00, La–Su 8:00–19:00',
    type: 'uimahallin sauna',
    sourceUrl: 'https://www.ouka.fi',
  },
  {
    name: 'Kuopion uimahalli',
    street: 'Puijonkatu 25',
    locality: 'Kuopio',
    lat: 62.8924,
    lon: 27.6780,
    free: false,
    priceAdult: 7,
    openingHours: 'Ma–Pe 6:00–21:00, La–Su 8:00–19:00',
    type: 'uimahallin sauna',
    sourceUrl: 'https://www.kuopio.fi',
  },
  {
    name: 'Lahden uimahalli',
    street: 'Rautatienkatu 14',
    locality: 'Lahti',
    lat: 60.9827,
    lon: 25.6613,
    free: false,
    priceAdult: 7,
    openingHours: 'Ma–Pe 6:00–21:00, La–Su 8:00–19:00',
    type: 'uimahallin sauna',
    sourceUrl: 'https://www.lahti.fi',
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
  return 'Muu Suomi'
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

function reittiopasUrlFromStation(street, locality) {
  const to = [street, locality].filter(Boolean).join(', ') || 'Helsinki'
  const stationNames = {
    Helsinki: 'Helsingin rautatieasema',
    Espoo: 'Espoon rautatieasema',
    Vantaa: 'Vantaan rautatieasema',
    Tampere: 'Tampereen rautatieasema',
    Turku: 'Turun rautatieasema',
    Jyväskylä: 'Jyväskylän rautatieasema',
    Oulu: 'Oulun rautatieasema',
    Kuopio: 'Kuopion rautatieasema',
    Lahti: 'Lahden rautatieasema',
  }
  const from = stationNames[locality] || `${locality} rautatieasema`
  return `https://www.reittiopas.fi/?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
}

// Train station coordinates per Finnish city
const STATIONS = {
  Helsinki: { lat: 60.170937, lon: 24.941451 },
  Espoo: { lat: 60.2055, lon: 24.6548 },
  Vantaa: { lat: 60.2885, lon: 25.0496 },
  Tampere: { lat: 61.4973, lon: 23.7618 },
  Turku: { lat: 60.4515, lon: 22.2574 },
  Jyväskylä: { lat: 62.2423, lon: 25.7416 },
  Oulu: { lat: 65.0095, lon: 25.4698 },
  Kuopio: { lat: 62.8931, lon: 27.6775 },
  Lahti: { lat: 60.9827, lon: 25.6611 },
}

function stationFor(locality) {
  return STATIONS[locality] || STATIONS.Helsinki
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const toRad = (d) => (d * Math.PI) / 180
  const R = 6371
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function walkingMin(km) {
  // ~5 km/h walking speed
  const min = (km / 5) * 60
  if (min < 1) return '< 1 min'
  if (min < 60) return `${Math.round(min)} min`
  const h = Math.floor(min / 60)
  const m = Math.round(min % 60)
  return m === 0 ? `${h} h` : `${h} h ${m} min`
}

function stationDistance(lat, lon, locality) {
  if (lat == null || lon == null) return null
  const s = stationFor(locality)
  const km = haversineKm(s.lat, s.lon, lat, lon)
  return { km, walking: walkingMin(km) }
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
    const dist = stationDistance(s.lat, s.lon, s.locality)
    const id = `${s.locality}:${slug(s.name)}`
    return {
      id: slug(id),
      title: s.name,
      date: '', // facilities don't have a single date
      location: s.locality || 'Helsinki',
      street: s.street,
      region: region,
      category: saunaTypeBadge(s.type),
      source: 'Curated public facility data (Helsinki/Tampere saunas)',
      sourceUrl: s.sourceUrl || '',
      mapsUrl: mapsUrl(s.street, s.locality),
      reittiopasUrl: reittiopasUrl(s.street, s.locality),
      reittiopasUrlFromStation: reittiopasUrlFromStation(s.street, s.locality),
      shortDesc: `${s.type} - ${s.openingHours}`,
      audienceTag: '',
      isFree: free,
      priceAdult: priceAdult,
      openingHours: s.openingHours,
      saunaType: s.type,
      sauna: true,
      stationKm: dist ? dist.km : null,
      stationWalking: dist ? dist.walking : null,
      priceDetails: s.priceDetails || null,
      rating: null, // Google Maps ratings require a Places API key
    }
  })

  events.sort((a, b) => (a.title || '').localeCompare(b.title || ''))

  const payload = {
    generatedAt: new Date().toISOString(),
    total: events.length,
    sources: ['Curated Helsinki/Tampere sauna facility data'],
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
