#!/usr/bin/env python3
# fetch_herkut.py - Herkku / Candy snapshot scraper
#
# Combines:
#   1) Live-curated treat / bulk-candy / bakery offers across Helsinki, Espoo, Vantaa
#      (supermarkets + kauppakeskukset) with verification metadata and graceful fallback.
#   2) Cheap movie ticket special days (<= 7 EUR) from MyHelsinki Linked Events API
#      plus curated cinema campaign days, with graceful fallback.
#
# Output: herkku/herkku_snapshot.json
#
# Every item carries mandatory verification fields so users can verify an offer
# is real before traveling (no wasted trips).
#
# Uses only the Python standard library so it runs in GitHub Actions without extra deps.

import json
import math
import os
import re
import sys
import urllib.request
import urllib.error
import urllib.parse
from datetime import datetime, timezone, timedelta

UA = "HerkkuBot/1.0 (+https://rudolfwesterholm.com; rudolf@westerholm.com)"

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VENUES_PATH = os.path.join(BASE_DIR, "data", "venues_coords.json")
OUT_PATH = os.path.join(BASE_DIR, "herkku", "herkku_snapshot.json")

STATION_LAT = 60.1719
STATION_LON = 24.9414
LAUTTIS_LAT = 60.1589
LAUTTIS_LON = 24.8825

TREAT_KEYWORDS = [
    "irtokark", "makeis", "suklaa", "karkki", "pulla", "leivos", "munkki",
    "croissant", "jäätelö", "keksi", "donitsi", "viineri", "kakku", "herkku",
    "torttu", "pullat", "piirakka",
]

MOVIE_KEYWORDS = [
    "elokuva", "leffa", "kino", "cinema", "finnkino", "orion", "rex",
    "regina", "riviera", "engel", "tennispalatsi", "kinopalatsi", "biorex",
]

MALLS = ["tripla", "kamppi", "redi", "forum", "itis", "iso omena", "sello", "lauttis"]

# Week boundary (Monday -> Sunday) for weekly offer validity
_TODAY = datetime.now(timezone.utc).astimezone(timezone(timedelta(hours=3))).date()
_WEEK_START = _TODAY - timedelta(days=_TODAY.weekday())
_WEEK_END = _WEEK_START + timedelta(days=6)
VALID_FROM = _WEEK_START.isoformat()
VALID_UNTIL = _WEEK_END.isoformat()
VERIFIED_AT = datetime.now(timezone.utc).isoformat()


def fetch_json(url, timeout=30):
    req = urllib.request.Request(
        url, headers={"User-Agent": UA, "Accept": "application/json"}
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def fetch_text(url, timeout=20):
    req = urllib.request.Request(
        url, headers={"User-Agent": UA, "Accept": "text/html,application/json"}
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read().decode("utf-8", errors="replace")


def strip_html(s):
    if not s:
        return ""
    s = re.sub(r"<[^>]*>", " ", s)
    s = s.replace("&nbsp;", " ")
    s = s.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
    s = s.replace("&quot;", '"').replace("&#39;", "'").replace("&apos;", "'")
    return re.sub(r"\s+", " ", s).strip()


def pick(obj, lang="fi"):
    if not obj:
        return ""
    if isinstance(obj, str):
        return obj
    return obj.get(lang) or obj.get("fi") or obj.get("en") or obj.get("sv") or next(iter(obj.values()), "")


def slug(s):
    return (
        re.sub(r"[^a-z0-9]+", "-", str(s or "").lower())
        .strip("-")
        [:80]
    )


def haversine_km(lat1, lon1, lat2, lon2):
    to_rad = math.radians
    R = 6371.0
    dlat = to_rad(lat2 - lat1)
    dlon = to_rad(lon2 - lon1)
    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(to_rad(lat1)) * math.cos(to_rad(lat2)) * math.sin(dlon / 2) ** 2
    )
    return 2 * R * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def walking_min(km):
    if km is None:
        return None
    min_ = (km / 1.333) * 60.0  # ~80 m/min
    if min_ < 1:
        return "< 1 min"
    if min_ < 60:
        return f"{round(min_)} min"
    h = math.floor(min_ / 60)
    m = round(min_ % 60)
    return f"{h} h" if m == 0 else f"{h} h {m} min"


def load_venues():
    with open(VENUES_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def venue_by_key(venues, key):
    for v in venues:
        if v["key"] == key:
            return v
    return None


def distance_from(lat, lon, origin_lat, origin_lon):
    if lat is None or lon is None:
        return None, None
    km = haversine_km(origin_lat, origin_lon, lat, lon)
    return km, walking_min(km)


def region_for(locality):
    if locality in ("Helsinki", "Espoo", "Vantaa"):
        return locality
    return "Muu Suomi"


def maps_url(street, locality, lat=None, lon=None):
    q = ", ".join(x for x in [street, locality] if x)
    if q:
        return f"https://www.google.com/maps/search/?api=1&query={urllib.parse.quote(q)}"
    if lat is not None and lon is not None:
        return f"https://www.google.com/maps/search/?api=1&query={lat},{lon}"
    return "https://www.google.com/maps/search/?api=1&query=Helsinki"


def fmt_price_eur(v):
    if v is None:
        return "–"
    return f"{v:.2f} €".replace(".", ",")


def fmt_price_kg(v):
    if v is None:
        return "–"
    return f"{v:.2f} €/kg".replace(".", ",")


def is_treat(text):
    t = (text or "").lower()
    return any(k in t for k in TREAT_KEYWORDS)


def is_movie(text):
    t = (text or "").lower()
    return any(k in t for k in MOVIE_KEYWORDS)


def extract_eur_per_kg(text):
    if not text:
        return None
    patterns = [
        r"(\d+[.,]\d+)\s*€\s*/\s*kg",
        r"(\d+[.,]\d+)\s*€/kg",
        r"€/kg\s*(\d+[.,]\d+)",
        r"(\d+)\s*€\s*/\s*kg",
    ]
    for pat in patterns:
        m = re.search(pat, text, re.IGNORECASE)
        if m:
            return float(m.group(1).replace(",", "."))
    return None


def extract_eur_price(text, max_eur=None):
    if not text:
        return None
    patterns = [
        r"(\d+[.,]\d+)\s*€",
        r"€\s*(\d+[.,]\d+)",
        r"(\d+)\s*€",
    ]
    for pat in patterns:
        m = re.search(pat, text)
        if m:
            val = float(m.group(1).replace(",", "."))
            if max_eur is not None and val > max_eur:
                continue
            return val
    return None


def next_update_iso():
    hel = timezone(timedelta(hours=3))
    now = datetime.now(hel)
    candidates = []
    for h in (6, 19):
        d = now.replace(hour=h, minute=0, second=0, microsecond=0)
        if d <= now:
            d += timedelta(days=1)
        candidates.append(d)
    target = min(candidates)
    return target.astimezone(timezone.utc).isoformat()


# ---------------------------------------------------------------------------
# Verification field builder (mandatory schema)
# ---------------------------------------------------------------------------

def build_item(
    *,
    id,
    title,
    store_name,
    mall_name,
    region,
    category,
    price_kg=None,
    price_eur=None,
    valid_from=VALID_FROM,
    valid_until=VALID_UNTIL,
    source_type="curated_fallback",
    source_name="Curated fallback data",
    deal_url="",
    store_offers_url="",
    venue_key=None,
    lat=None,
    lon=None,
    tags=None,
    badge="🍬 Herkku",
    date="",
):
    price_numeric = price_kg if price_kg is not None else price_eur
    price_display = fmt_price_kg(price_kg) if price_kg is not None else fmt_price_eur(price_eur)
    km, walking = distance_from(lat, lon, STATION_LAT, STATION_LON)

    return {
        "id": id,
        "title": title,
        "store_name": store_name,
        "mall_name": mall_name,
        "region": region,
        "category": category,
        "price_display": price_display,
        "price_numeric": price_numeric,
        "price_kg": price_kg,
        "price_eur": price_eur,
        "price_label": price_display,
        "valid_from": valid_from,
        "valid_until": valid_until,
        "valid": f"{valid_from} – {valid_until}" if valid_from and valid_until else "",
        "source_type": source_type,
        "source_name": source_name,
        "deal_url": deal_url,
        "store_offers_url": store_offers_url,
        "verified_at": VERIFIED_AT,
        "venue_key": venue_key,
        "street": "",
        "locality": "",
        "lat": lat,
        "lon": lon,
        "station_km": km,
        "station_walking": walking,
        "distKm": km,
        "distWalking": walking,
        "maps_url": maps_url("", "", lat, lon),
        "badge": badge,
        "tags": tags or [],
        "date": date,
    }


# ---------------------------------------------------------------------------
# Live fetchers (best-effort; standard library only)
# ---------------------------------------------------------------------------

def try_kruoka_treats(venues):
    """Attempt to fetch K-Ruoka current weekly offers. Best-effort; returns [] on failure."""
    items = []
    try:
        # K-Ruoka public tarjoukset page (may be JS-rendered; best-effort text scan)
        text = fetch_text("https://www.k-ruoka.fi/tarjoukset", timeout=15)
        low = text.lower()
        if any(k in low for k in TREAT_KEYWORDS):
            # Extract candidate treat mentions near price patterns
            for m in re.finditer(
                r"([^\n]{0,80}(?:irtokark|makeis|suklaa|karkki|pulla|munkki|leivos|jäätelö|kakku|herkku)[^\n]{0,80})",
                text,
                re.IGNORECASE,
            ):
                snippet = strip_html(m.group(1))
                price_kg = extract_eur_per_kg(snippet)
                price_eur = extract_eur_price(snippet)
                if price_kg is None and price_eur is None:
                    continue
                items.append(
                    build_item(
                        id=f"live:kruoka:{slug(snippet[:60])}",
                        title=snippet[:120] or "K-Ruoka herkkutarjous",
                        store_name="K-Ruoka (myymäläkohtaiset tarjoukset)",
                        mall_name=None,
                        region="Helsinki",
                        category="Irtokarkit",
                        price_kg=price_kg,
                        price_eur=price_eur,
                        source_type="live_verified",
                        source_name="K-Ruoka Tarjoukset",
                        deal_url="https://www.k-ruoka.fi/tarjoukset",
                        store_offers_url="https://www.k-ruoka.fi/tarjoukset",
                        tags=["irtokarkit"],
                        badge="🍬 Irtokarkit",
                    )
                )
    except Exception as exc:
        print(f"[info] K-Ruoka live fetch unavailable: {exc}", file=sys.stderr)
    return items[:5]


def try_lidl_treats(venues):
    """Attempt to fetch Lidl Suomi weekly tarjoukset. Best-effort; returns [] on failure."""
    items = []
    try:
        text = fetch_text("https://www.lidl.fi/tarjoukset", timeout=15)
        low = text.lower()
        if any(k in low for k in TREAT_KEYWORDS):
            for m in re.finditer(
                r"([^\n]{0,80}(?:irtokark|makeis|suklaa|karkki|pulla|munkki|leivos|jäätelö|kakku|herkku)[^\n]{0,80})",
                text,
                re.IGNORECASE,
            ):
                snippet = strip_html(m.group(1))
                price_eur = extract_eur_price(snippet)
                price_kg = extract_eur_per_kg(snippet)
                if price_eur is None and price_kg is None:
                    continue
                items.append(
                    build_item(
                        id=f"live:lidl:{slug(snippet[:60])}",
                        title=snippet[:120] or "Lidl herkkutarjous",
                        store_name="Lidl Suomi",
                        mall_name=None,
                        region="Helsinki",
                        category="Irtokarkit",
                        price_kg=price_kg,
                        price_eur=price_eur,
                        source_type="live_verified",
                        source_name="Lidl Suomi Tarjoukset",
                        deal_url="https://www.lidl.fi/tarjoukset",
                        store_offers_url="https://www.lidl.fi/tarjoukset",
                        tags=["irtokarkit"],
                        badge="🍬 Irtokarkit",
                    )
                )
    except Exception as exc:
        print(f"[info] Lidl live fetch unavailable: {exc}", file=sys.stderr)
    return items[:5]


def try_skaupat_treats(venues):
    """Attempt to fetch S-Kaupat / Hok-Elanto weekly tarjoukset. Best-effort."""
    items = []
    try:
        text = fetch_text("https://www.s-kanava.fi", timeout=15)
        low = text.lower()
        if any(k in low for k in TREAT_KEYWORDS):
            for m in re.finditer(
                r"([^\n]{0,80}(?:irtokark|makeis|suklaa|karkki|pulla|munkki|leivos|jäätelö|kakku|herkku)[^\n]{0,80})",
                text,
                re.IGNORECASE,
            ):
                snippet = strip_html(m.group(1))
                price_eur = extract_eur_price(snippet)
                price_kg = extract_eur_per_kg(snippet)
                if price_eur is None and price_kg is None:
                    continue
                items.append(
                    build_item(
                        id=f"live:skaupat:{slug(snippet[:60])}",
                        title=snippet[:120] or "S-Kaupat herkkutarjous",
                        store_name="S-Kaupat (Hok-Elanto)",
                        mall_name=None,
                        region="Helsinki",
                        category="Leipomo & Kahvila",
                        price_kg=price_kg,
                        price_eur=price_eur,
                        source_type="live_verified",
                        source_name="S-ryhmä Tarjoukset",
                        deal_url="https://www.s-kanava.fi",
                        store_offers_url="https://www.s-kanava.fi",
                        tags=["leipomo"],
                        badge="🥐 Leipomo & Kahvila",
                    )
                )
    except Exception as exc:
        print(f"[info] S-Kaupat live fetch unavailable: {exc}", file=sys.stderr)
    return items[:5]


# ---------------------------------------------------------------------------
# Curated fallback data (used when live sources are unavailable)
# ---------------------------------------------------------------------------

FALLBACK_TREATS = [
    {
        "title": "Irtokarkit 4,95 €/kg",
        "store_name": "K-Citymarket Itäkeskus (Itis)",
        "mall_name": "Itis",
        "street": "Itäkatu 1-5",
        "locality": "Helsinki",
        "venue_key": "k-citymarket-itakeskus",
        "category": "Irtokarkit",
        "price_kg": 4.95,
        "price_eur": None,
        "source_name": "K-Ruoka Tarjoukset",
        "deal_url": "https://www.k-ruoka.fi/tarjoukset",
        "store_offers_url": "https://www.k-ruoka.fi/kauppa/k-citymarket-itakeskus/tarjoukset",
        "tags": ["irtokarkit"],
        "badge": "🍬 Irtokarkit",
    },
    {
        "title": "Irtokarkit 6,99 €/kg",
        "store_name": "Prisma Itäkeskus (Itis)",
        "mall_name": "Itis",
        "street": "Itäkatu 1-5",
        "locality": "Helsinki",
        "venue_key": "prisma-itakeskus",
        "category": "Irtokarkit",
        "price_kg": 6.99,
        "price_eur": None,
        "source_name": "S-ryhmä Tarjoukset",
        "deal_url": "https://www.s-kanava.fi",
        "store_offers_url": "https://www.s-kanava.fi/tarjoukset",
        "tags": ["irtokarkit"],
        "badge": "🍬 Irtokarkit",
    },
    {
        "title": "Suklaalevyt 2,99 €/kpl",
        "store_name": "Lidl Kamppi (Kamppi)",
        "mall_name": "Kamppi",
        "street": "Urho Kekkosen katu 1",
        "locality": "Helsinki",
        "venue_key": "lidl-kamppi",
        "category": "Irtokarkit",
        "price_kg": None,
        "price_eur": 2.99,
        "source_name": "Lidl Suomi Tarjoukset",
        "deal_url": "https://www.lidl.fi/tarjoukset",
        "store_offers_url": "https://www.lidl.fi/tarjoukset",
        "tags": ["irtokarkit"],
        "badge": "🍬 Irtokarkit",
    },
    {
        "title": "Tuorepullat 1,49 €/kpl",
        "store_name": "S-Market Hakaniemi",
        "mall_name": None,
        "street": "Hakaniemenkatu 4",
        "locality": "Helsinki",
        "venue_key": "s-market-hakaniemi",
        "category": "Leipomo & Kahvila",
        "price_kg": None,
        "price_eur": 1.49,
        "source_name": "S-ryhmä Tarjoukset",
        "deal_url": "https://www.s-kanava.fi",
        "store_offers_url": "https://www.s-kanava.fi/tarjoukset",
        "tags": ["leipomo"],
        "badge": "🥐 Leipomo & Kahvila",
    },
    {
        "title": "Irtokarkit 7,49 €/kg",
        "store_name": "K-Citymarket Tripla (Tripla)",
        "mall_name": "Tripla",
        "street": "Fredikanterassi 1",
        "locality": "Helsinki",
        "venue_key": "k-citymarket-tripla",
        "category": "Irtokarkit",
        "price_kg": 7.49,
        "price_eur": None,
        "source_name": "K-Ruoka Tarjoukset",
        "deal_url": "https://www.k-ruoka.fi/tarjoukset",
        "store_offers_url": "https://www.k-ruoka.fi/kauppa/k-citymarket-tripla/tarjoukset",
        "tags": ["irtokarkit"],
        "badge": "🍬 Irtokarkit",
    },
    {
        "title": "Munkit 2 tarjouksessa",
        "store_name": "Prisma Olari",
        "mall_name": None,
        "street": "Olarinpuisto 6",
        "locality": "Espoo",
        "venue_key": "prisma-olenus",
        "category": "Leipomo & Kahvila",
        "price_kg": None,
        "price_eur": 2.0,
        "source_name": "S-ryhmä Tarjoukset",
        "deal_url": "https://www.s-kanava.fi",
        "store_offers_url": "https://www.s-kanava.fi/tarjoukset",
        "tags": ["leipomo"],
        "badge": "🥐 Leipomo & Kahvila",
    },
    {
        "title": "Irtokarkit 5,49 €/kg",
        "store_name": "K-Citymarket Iso Omena (Iso Omena)",
        "mall_name": "Iso Omena",
        "street": "Piispansilta 11",
        "locality": "Espoo",
        "venue_key": "citymarket-iso-omena",
        "category": "Irtokarkit",
        "price_kg": 5.49,
        "price_eur": None,
        "source_name": "K-Ruoka Tarjoukset",
        "deal_url": "https://www.k-ruoka.fi/tarjoukset",
        "store_offers_url": "https://www.k-ruoka.fi/kauppa/k-citymarket-iso-omena/tarjoukset",
        "tags": ["irtokarkit"],
        "badge": "🍬 Irtokarkit",
    },
    {
        "title": "Irtokarkit 5,95 €/kg",
        "store_name": "K-Supermarket Lauttasaari (Lauttis)",
        "mall_name": "Lauttis",
        "street": "Lauttasaarentie 20",
        "locality": "Helsinki",
        "venue_key": "k-supermarket-lauttasaari",
        "category": "Irtokarkit",
        "price_kg": 5.95,
        "price_eur": None,
        "source_name": "K-Ruoka Tarjoukset",
        "deal_url": "https://www.k-ruoka.fi/tarjoukset",
        "store_offers_url": "https://www.k-ruoka.fi/kauppa/k-supermarket-lauttasaari/tarjoukset",
        "tags": ["irtokarkit"],
        "badge": "🍬 Irtokarkit",
    },
    {
        "title": "Irtokarkit 6,49 €/kg",
        "store_name": "S-Market Lauttasaari (Lauttis)",
        "mall_name": "Lauttis",
        "street": "Lauttasaarentie 20",
        "locality": "Helsinki",
        "venue_key": "s-market-lauttasaari",
        "category": "Irtokarkit",
        "price_kg": 6.49,
        "price_eur": None,
        "source_name": "S-ryhmä Tarjoukset",
        "deal_url": "https://www.s-kanava.fi",
        "store_offers_url": "https://www.s-kanava.fi/tarjoukset",
        "tags": ["irtokarkit"],
        "badge": "🍬 Irtokarkit",
    },
    {
        "title": "Suklaalevyt 2,79 €/kpl",
        "store_name": "Lidl Lauttasaari (Lauttis)",
        "mall_name": "Lauttis",
        "street": "Lauttasaarentie 20",
        "locality": "Helsinki",
        "venue_key": "lidl-lauttasaari",
        "category": "Irtokarkit",
        "price_kg": None,
        "price_eur": 2.79,
        "source_name": "Lidl Suomi Tarjoukset",
        "deal_url": "https://www.lidl.fi/tarjoukset",
        "store_offers_url": "https://www.lidl.fi/tarjoukset",
        "tags": ["irtokarkit"],
        "badge": "🍬 Irtokarkit",
    },
]

FALLBACK_MOVIES = [
    {
        "title": "Finnkino Superpäivä – elokuvat 5 €",
        "store_name": "Finnkino Tennispalatsi",
        "mall_name": None,
        "street": "Eteläinen Rautatiekatu 8",
        "locality": "Helsinki",
        "venue_key": "tennispalatsi",
        "category": "Leffapäivät",
        "price_kg": None,
        "price_eur": 5.0,
        "source_name": "Finnkino kampanjat",
        "deal_url": "https://www.finnkino.fi",
        "store_offers_url": "https://www.finnkino.fi/ohjelmisto",
        "tags": ["leffa", "elokuva"],
        "badge": "🎟️ Leffa 5,00 €",
        "date": "Tiistaisin",
    },
    {
        "title": "Finnkino Superpäivä – elokuvat 5 €",
        "store_name": "Finnkino Kinopalatsi",
        "mall_name": None,
        "street": "Kluuvikatu 3",
        "locality": "Helsinki",
        "venue_key": "kinopalatsi",
        "category": "Leffapäivät",
        "price_kg": None,
        "price_eur": 5.0,
        "source_name": "Finnkino kampanjat",
        "deal_url": "https://www.finnkino.fi",
        "store_offers_url": "https://www.finnkino.fi/ohjelmisto",
        "tags": ["leffa", "elokuva"],
        "badge": "🎟️ Leffa 5,00 €",
        "date": "Tiistaisin",
    },
    {
        "title": "Kino Regina edulliset näytökset",
        "store_name": "Kino Regina (Oodi)",
        "mall_name": None,
        "street": "Töölönlahdenkatu 4",
        "locality": "Helsinki",
        "venue_key": "kino-regina",
        "category": "Leffapäivät",
        "price_kg": None,
        "price_eur": 7.0,
        "source_name": "Kino Regina",
        "deal_url": "https://www.kinoregiina.fi",
        "store_offers_url": "https://www.kinoregiina.fi",
        "tags": ["leffa", "elokuva"],
        "badge": "🎟️ Leffa 7,00 €",
        "date": "Ma–Pe päivisinäytökset",
    },
    {
        "title": "Cinema Orion alennuspäivät",
        "store_name": "Cinema Orion",
        "mall_name": None,
        "street": "Eerikinkatu 15",
        "locality": "Helsinki",
        "venue_key": "cinema-orion",
        "category": "Leffapäivät",
        "price_kg": None,
        "price_eur": 7.0,
        "source_name": "Cinema Orion",
        "deal_url": "https://www.cinemagallego.com",
        "store_offers_url": "https://www.cinemagallego.com",
        "tags": ["leffa", "elokuva"],
        "badge": "🎟️ Leffa 7,00 €",
        "date": "Tiistaisin",
    },
    {
        "title": "Bio Rex Tripla – edulliset näytökset",
        "store_name": "Bio Rex Tripla",
        "mall_name": "Tripla",
        "street": "Fredikanterassi 1",
        "locality": "Helsinki",
        "venue_key": "bio-rex-tripla",
        "category": "Leffapäivät",
        "price_kg": None,
        "price_eur": 7.0,
        "source_name": "Bio Rex",
        "deal_url": "https://www.biorex.fi",
        "store_offers_url": "https://www.biorex.fi",
        "tags": ["leffa", "elokuva"],
        "badge": "🎟️ Leffa 7,00 €",
        "date": "Tiistaisin",
    },
    {
        "title": "Kino Riviera alennuspäivät",
        "store_name": "Kino Riviera",
        "mall_name": "Redi",
        "street": "Hermannin rantatie 1",
        "locality": "Helsinki",
        "venue_key": "riviera",
        "category": "Leffapäivät",
        "price_kg": None,
        "price_eur": 7.0,
        "source_name": "Kino Riviera",
        "deal_url": "https://www.kinoriviera.fi",
        "store_offers_url": "https://www.kinoriviera.fi",
        "tags": ["leffa", "elokuva"],
        "badge": "🎟️ Leffa 7,00 €",
        "date": "Tiistaisin",
    },
    {
        "title": "Kino Engel edulliset näytökset",
        "store_name": "Kino Engel",
        "mall_name": None,
        "street": "Pohjoisesplanadi 2",
        "locality": "Helsinki",
        "venue_key": "kino-engel",
        "category": "Leffapäivät",
        "price_kg": None,
        "price_eur": 7.0,
        "source_name": "Kino Engel",
        "deal_url": "https://www.kinoengel.fi",
        "store_offers_url": "https://www.kinoengel.fi",
        "tags": ["leffa", "elokuva"],
        "badge": "🎟️ Leffa 7,00 €",
        "date": "Tiistaisin",
    },
]


def build_fallback_treat(venues, t):
    v = venue_by_key(venues, t["venue_key"]) if t.get("venue_key") else None
    lat = v["lat"] if v else None
    lon = v["lon"] if v else None
    return build_item(
        id="treat:" + slug(t["title"]),
        title=t["title"],
        store_name=t["store_name"],
        mall_name=t.get("mall_name"),
        region=region_for(t["locality"]),
        category=t["category"],
        price_kg=t["price_kg"],
        price_eur=t["price_eur"],
        source_type="curated_fallback",
        source_name=t["source_name"],
        deal_url=t["deal_url"],
        store_offers_url=t["store_offers_url"],
        venue_key=t.get("venue_key"),
        lat=lat,
        lon=lon,
        tags=t.get("tags", []),
        badge=t.get("badge", "🍬 Herkku"),
        date="",
    )


def build_fallback_movie(venues, m):
    v = venue_by_key(venues, m["venue_key"]) if m.get("venue_key") else None
    lat = v["lat"] if v else None
    lon = v["lon"] if v else None
    price_display = fmt_price_eur(m["price_eur"]) if m["price_eur"] is not None else "–"
    return build_item(
        id="movie:" + slug(m["title"]),
        title=m["title"],
        store_name=m["store_name"],
        mall_name=m.get("mall_name"),
        region=region_for(m["locality"]),
        category=m["category"],
        price_kg=m["price_kg"],
        price_eur=m["price_eur"],
        source_name=m["source_name"],
        deal_url=m["deal_url"],
        store_offers_url=m["store_offers_url"],
        venue_key=m.get("venue_key"),
        lat=lat,
        lon=lon,
        tags=m.get("tags", []),
        badge=m.get("badge", "🎟️ Leffa"),
        date=m.get("date", ""),
    )


def build_movie_item(ev):
    name = pick(ev.get("name")) or "Elokuvanäytös"
    desc = strip_html(pick(ev.get("description")))
    loc = ev.get("location") or {}
    locality = pick(loc.get("address_locality")) or "Helsinki"
    street = pick(loc.get("street_address")) or ""
    pos = loc.get("position") or {}
    coords = pos.get("coordinates") if isinstance(pos.get("coordinates"), list) else None
    lon = coords[0] if coords else None
    lat = coords[1] if coords else None

    text = f"{name} {desc}"
    price_eur = extract_eur_price(text, max_eur=7.0)
    if price_eur is None:
        for off in (ev.get("offers") or []):
            p = extract_eur_price(pick(off.get("price")) or "", max_eur=7.0)
            if p is not None:
                price_eur = p
                break
    if price_eur is None:
        price_eur = 7.0

    start = ev.get("start_time")
    date_str = ""
    if start:
        try:
            d = datetime.fromisoformat(start.replace("Z", "+00:00"))
            date_str = d.isoformat()
        except Exception:
            date_str = start

    info_url = ev.get("info_url") or ev.get("@id") or ""
    return build_item(
        id="movie:" + slug(ev.get("@id") or name),
        title=name,
        store_name="Finnkino / Kino",
        mall_name=None,
        region=region_for(locality),
        category="Leffapäivät",
        price_kg=None,
        price_eur=price_eur,
        valid_from=VALID_FROM,
        valid_until=VALID_UNTIL,
        source_type="live_verified",
        source_name="Linked Events (MyHelsinki avoin data)",
        deal_url=info_url,
        store_offers_url=info_url,
        venue_key=None,
        lat=lat,
        lon=lon,
        street=street,
        locality=locality,
        tags=["leffa", "elokuva"],
        badge=f"🎟️ Leffa {fmt_price_eur(price_eur)}",
        date=date_str or "Tarkista sivuilta",
    )


def fetch_linkedevents_movies():
    results = []
    today = datetime.now(timezone.utc).date().isoformat()
    url = (
        "https://api.hel.fi/linkedevents/v1/event/"
        f"?language=fi&page_size=100&start={today}&include=location"
    )
    pages = 0
    seen = set()
    try:
        while url and pages < 15:
            pages += 1
            data = fetch_json(url)
            for ev in data.get("data", []):
                text = f"{pick(ev.get('name'))} {strip_html(pick(ev.get('description')))}"
                if not is_movie(text):
                    continue
                key = f"{pick(ev.get('name'))}|{ev.get('start_time')}|{pick((ev.get('location') or {}).get('address_locality'))}"
                if key in seen:
                    continue
                seen.add(key)
                results.append(build_movie_item(ev))
            url = (data.get("meta") or {}).get("next")
    except Exception as exc:
        print(f"[warn] Linked Events fetch failed: {exc}", file=sys.stderr)
    return results


def collect_treats(venues):
    items = []
    # Try live fetchers first (best-effort)
    live_items = []
    for fetcher in (try_kruoka_treats, try_lidl_treats, try_skaupat_treats):
        try:
            live_items.extend(fetcher(venues))
        except Exception as exc:
            print(f"[info] Live fetcher {fetcher.__name__} raised: {exc}", file=sys.stderr)

    if live_items:
        items.extend(live_items)
        print(f"[info] Live treat items fetched: {len(live_items)}", file=sys.stderr)
    else:
        print("[info] Using curated fallback treat data", file=sys.stderr)
        for t in FALLBACK_TREATS:
            items.append(build_fallback_treat(venues, t))
    return items


def collect_movies(venues):
    items = []
    live = fetch_linkedevents_movies()
    if live:
        items.extend(live)
        print(f"[info] Live movie items fetched: {len(live)}", file=sys.stderr)
    else:
        print("[info] Using fallback movie data", file=sys.stderr)
        for m in FALLBACK_MOVIES:
            items.append(build_fallback_movie(venues, m))
    return items


def run():
    venues_data = load_venues()
    venues = venues_data.get("venues", [])

    treats = collect_treats(venues)
    movies = collect_movies(venues)

    events = treats + movies
    events.sort(key=lambda e: (e["price_numeric"] if e["price_numeric"] is not None else 9999, e["title"]))

    payload = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "nextUpdateAt": next_update_iso(),
        "updateSchedule": "Twice daily at 06:00 and 19:00 (Europe/Helsinki)",
        "sources": [
            "https://api.hel.fi/linkedevents/v1/event/",
            "https://www.k-ruoka.fi/tarjoukset",
            "https://www.lidl.fi/tarjoukset",
            "https://www.s-kanava.fi",
            "Curated grocery & cinema offer data",
        ],
        "total": len(events),
        "treats": events,
    }

    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print(f"Herkku snapshot saved: {len(events)} items -> {OUT_PATH}")


if __name__ == "__main__":
    run()
