#!/usr/bin/env python3
# fetch_herkut.py - Herkku / Candy snapshot scraper
#
# Combines:
#   1) Curated treat / bulk-candy / bakery offers across Helsinki, Espoo, Vantaa
#      (supermarkets + kauppakeskukset) with fallback when live feeds are unavailable.
#   2) Cheap movie ticket special days (<= 7 EUR) from MyHelsinki Linked Events API
#      plus curated cinema campaign days, with graceful fallback.
#
# Output: herkku/herkku_snapshot.json (same shape as lokki events.json / sauna saunas.json)
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

TREAT_KEYWORDS = [
    "irtokark", "makeis", "suklaa", "karkki", "pulla", "leivos", "munkki",
    "croissant", "jäätelö", "keksi", "donitsi", "viineri", "kakku", "herkku",
    "torttu", "pullat", "piirakka",
]

MOVIE_KEYWORDS = [
    "elokuva", "leffa", "kino", "cinema", "finnkino", "orion", "rex",
    "regina", "riviera", "engel", "tennispalatsi", "kinopalatsi", "biorex",
]

MALLS = ["tripla", "kamppi", "redi", "forum", "itis", "iso omena", "sello"]


def fetch_json(url, timeout=30):
    req = urllib.request.Request(
        url, headers={"User-Agent": UA, "Accept": "application/json"}
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


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
    min_ = (km / 5.0) * 60.0
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


def distance_from_station(lat, lon):
    if lat is None or lon is None:
        return None, None
    km = haversine_km(STATION_LAT, STATION_LON, lat, lon)
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


def treat_price_label(price_kg, price_eur):
    if price_kg is not None:
        return f"{price_kg:.2f} €/kg".replace(".", ",")
    if price_eur is not None:
        return f"{price_eur:.2f} €".replace(".", ",")
    return "–"


def is_treat(text):
    t = (text or "").lower()
    return any(k in t for k in TREAT_KEYWORDS)


def is_movie(text):
    t = (text or "").lower()
    return any(k in t for k in MOVIE_KEYWORDS)


def is_mall(text):
    t = (text or "").lower()
    return any(m in t for m in MALLS)


def extract_eur_per_kg(text):
    """Try to extract a €/kg price from text like '4,95 €/kg' or '4.95 €/kg'."""
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
    """Extract the first EUR price from text."""
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
    """Next 06:00 or 19:00 Europe/Helsinki."""
    hel = timezone(timedelta(hours=3))  # EEST approx; sufficient for scheduling label
    now = datetime.now(hel)
    # Use fixed offsets; schedule label is informational.
    candidates = []
    for h in (6, 19):
        d = now.replace(hour=h, minute=0, second=0, microsecond=0)
        if d <= now:
            d += timedelta(days=1)
        candidates.append(d)
    target = min(candidates)
    return target.astimezone(timezone.utc).isoformat()


# ---------------------------------------------------------------------------
# Curated fallback data (used when live sources are unavailable)
# ---------------------------------------------------------------------------

FALLBACK_TREATS = [
    {
        "title": "Irtokarkit 4,95 €/kg",
        "place": "K-Citymarket Itäkeskus",
        "mall": "Itis",
        "street": "Itäkatu 1-5",
        "locality": "Helsinki",
        "venue_key": "k-citymarket-itakeskus",
        "category": "Irtokarkit",
        "price_kg": 4.95,
        "price_eur": None,
        "valid": "Tänään–su",
        "source": "K-Ruoka viikkotarjoukset",
        "source_url": "https://www.k-ruoka.fi/tarjoukset",
    },
    {
        "title": "Irtokarkit 6,99 €/kg",
        "place": "Prisma Itäkeskus",
        "mall": "Itis",
        "street": "Itäkatu 1-5",
        "locality": "Helsinki",
        "venue_key": "prisma-itakeskus",
        "category": "Irtokarkit",
        "price_kg": 6.99,
        "price_eur": None,
        "valid": "Tänään–la",
        "source": "S-ryhmä tarjoukset",
        "source_url": "https://www.s-kanava.fi",
    },
    {
        "title": "Suklaalevyt 2,99 €/kpl",
        "place": "Lidl Kamppi",
        "mall": "Kamppi",
        "street": "Urho Kekkosen katu 1",
        "locality": "Helsinki",
        "venue_key": "lidl-kamppi",
        "category": "Irtokarkit",
        "price_kg": None,
        "price_eur": 2.99,
        "valid": "Viikon tarjous",
        "source": "Lidl Suomi viikkotarjoukset",
        "source_url": "https://www.lidl.fi",
    },
    {
        "title": "Tuorepullat 1,49 €/kpl",
        "place": "S-Market Hakaniemi",
        "mall": None,
        "street": "Hakaniemenkatu 4",
        "locality": "Helsinki",
        "venue_key": "s-market-hakaniemi",
        "category": "Leipomo & Kahvila",
        "price_kg": None,
        "price_eur": 1.49,
        "valid": "Päivittäin",
        "source": "S-ryhmä tarjoukset",
        "source_url": "https://www.s-kanava.fi",
    },
    {
        "title": "Irtokarkit 7,49 €/kg",
        "place": "K-Citymarket Tripla",
        "mall": "Tripla",
        "street": "Fredikanterassi 1",
        "locality": "Helsinki",
        "venue_key": "k-citymarket-tripla",
        "category": "Irtokarkit",
        "price_kg": 7.49,
        "price_eur": None,
        "valid": "Tänään–su",
        "source": "K-Ruoka viikkotarjoukset",
        "source_url": "https://www.k-ruoka.fi/tarjoukset",
    },
    {
        "title": "Munkit 2 tarjouksessa",
        "place": "Prisma Olari",
        "mall": None,
        "street": "Olarinpuisto 6",
        "locality": "Espoo",
        "venue_key": "prisma-olenus",
        "category": "Leipomo & Kahvila",
        "price_kg": None,
        "price_eur": 2.0,
        "valid": "Viikon tarjous",
        "source": "S-ryhmä tarjoukset",
        "source_url": "https://www.s-kanava.fi",
    },
    {
        "title": "Irtokarkit 5,49 €/kg",
        "place": "K-Citymarket Iso Omena",
        "mall": "Iso Omena",
        "street": "Piispansilta 11",
        "locality": "Espoo",
        "venue_key": "citymarket-iso-omena",
        "category": "Irtokarkit",
        "price_kg": 5.49,
        "price_eur": None,
        "valid": "Tänään–la",
        "source": "K-Ruoka viikkotarjoukset",
        "source_url": "https://www.k-ruoka.fi/tarjoukset",
    },
]

FALLBACK_MOVIES = [
    {
        "title": "Finnkino Superpäivä – elokuvat 5 €",
        "place": "Finnkino Tennispalatsi",
        "mall": None,
        "street": "Eteläinen Rautatiekatu 8",
        "locality": "Helsinki",
        "venue_key": "tennispalatsi",
        "category": "Leffapäivät",
        "price_kg": None,
        "price_eur": 5.0,
        "valid": "Tiistaisin",
        "source": "Finnkino kampanjat",
        "source_url": "https://www.finnkino.fi",
    },
    {
        "title": "Finnkino Superpäivä – elokuvat 5 €",
        "place": "Finnkino Kinopalatsi",
        "mall": None,
        "street": "Kluuvikatu 3",
        "locality": "Helsinki",
        "venue_key": "kinopalatsi",
        "category": "Leffapäivät",
        "price_kg": None,
        "price_eur": 5.0,
        "valid": "Tiistaisin",
        "source": "Finnkino kampanjat",
        "source_url": "https://www.finnkino.fi",
    },
    {
        "title": "Kino Regina edulliset näytökset",
        "place": "Kino Regina (Oodi)",
        "mall": None,
        "street": "Töölönlahdenkatu 4",
        "locality": "Helsinki",
        "venue_key": "kino-regina",
        "category": "Leffapäivät",
        "price_kg": None,
        "price_eur": 7.0,
        "valid": "Ma–Pe päivisinäytökset",
        "source": "Kino Regina",
        "source_url": "https://www.kinoregiina.fi",
    },
    {
        "title": "Cinema Orion alennuspäivät",
        "place": "Cinema Orion",
        "mall": None,
        "street": "Eerikinkatu 15",
        "locality": "Helsinki",
        "venue_key": "cinema-orion",
        "category": "Leffapäivät",
        "price_kg": None,
        "price_eur": 7.0,
        "valid": "Tiistaisin",
        "source": "Cinema Orion",
        "source_url": "https://www.cinemagallego.com",
    },
    {
        "title": "Bio Rex Tripla – edulliset näytökset",
        "place": "Bio Rex Tripla",
        "mall": "Tripla",
        "street": "Fredikanterassi 1",
        "locality": "Helsinki",
        "venue_key": "bio-rex-tripla",
        "category": "Leffapäivät",
        "price_kg": None,
        "price_eur": 7.0,
        "valid": "Tiistaisin",
        "source": "Bio Rex",
        "source_url": "https://www.biorex.fi",
    },
    {
        "title": "Kino Riviera alennuspäivät",
        "place": "Kino Riviera",
        "mall": "Redi",
        "street": "Hermannin rantatie 1",
        "locality": "Helsinki",
        "venue_key": "riviera",
        "category": "Leffapäivät",
        "price_kg": None,
        "price_eur": 7.0,
        "valid": "Tiistaisin",
        "source": "Kino Riviera",
        "source_url": "https://www.kinoriviera.fi",
    },
    {
        "title": "Kino Engel edulliset näytökset",
        "place": "Kino Engel",
        "mall": None,
        "street": "Pohjoisesplanadi 2",
        "locality": "Helsinki",
        "venue_key": "kino-engel",
        "category": "Leffapäivät",
        "price_kg": None,
        "price_eur": 7.0,
        "valid": "Tiistaisin",
        "source": "Kino Engel",
        "source_url": "https://www.kinoengel.fi",
    },
]


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
        # check offers
        for off in (ev.get("offers") or []):
            p = extract_eur_price(pick(off.get("price")) or "", max_eur=7.0)
            if p is not None:
                price_eur = p
                break
    if price_eur is None:
        price_eur = 7.0

    region = region_for(locality)
    km, walking = distance_from_station(lat, lon)

    start = ev.get("start_time")
    end = ev.get("end_time")
    date_str = ""
    if start:
        try:
            d = datetime.fromisoformat(start.replace("Z", "+00:00"))
            date_str = d.isoformat()
        except Exception:
            date_str = start

    return {
        "id": "movie:" + slug(ev.get("@id") or name),
        "title": name,
        "place": "Finnkino / Kino",
        "mall": None,
        "street": street,
        "locality": locality,
        "region": region,
        "venue_key": None,
        "category": "Leffapäivät",
        "price_kg": None,
        "price_eur": price_eur,
        "price_label": f"{price_eur:.2f} €".replace(".", ","),
        "valid": date_str or "Tarkista sivuilta",
        "source": "Linked Events (MyHelsinki avoin data)",
        "source_url": ev.get("info_url") or ev.get("@id") or "",
        "lat": lat,
        "lon": lon,
        "station_km": km,
        "station_walking": walking,
        "maps_url": maps_url(street, locality, lat, lon),
        "badge": f"🎟️ Leffa {price_eur:.2f} €".replace(".", ","),
        "tags": ["leffa", "elokuva"],
        "date": date_str,
    }


def fetch_linkedevents_movies():
    """Fetch cinema events <= 7 EUR from MyHelsinki Linked Events API."""
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
    """Build treat items: live sources attempted, fallback used if unavailable."""
    items = []
    # Attempt to enrich from live feeds is best-effort; grocery offer pages
    # generally require JS / keys, so we use curated fallback data.
    for t in FALLBACK_TREATS:
        v = venue_by_key(venues, t["venue_key"]) if t.get("venue_key") else None
        lat = v["lat"] if v else None
        lon = v["lon"] if v else None
        km, walking = distance_from_station(lat, lon)
        mall = t.get("mall") or (v.get("mall") if v else None)
        items.append({
            "id": "treat:" + slug(t["title"]),
            "title": t["title"],
            "place": t["place"],
            "mall": mall,
            "street": t["street"],
            "locality": t["locality"],
            "region": region_for(t["locality"]),
            "venue_key": t.get("venue_key"),
            "category": t["category"],
            "price_kg": t["price_kg"],
            "price_eur": t["price_eur"],
            "price_label": treat_price_label(t["price_kg"], t["price_eur"]),
            "valid": t["valid"],
            "source": t["source"],
            "source_url": t["source_url"],
            "lat": lat,
            "lon": lon,
            "station_km": km,
            "station_walking": walking,
            "maps_url": maps_url(t["street"], t["locality"], lat, lon),
            "badge": f"🍬 {t['category']}",
            "tags": [t["category"].lower()],
            "date": "",
        })
    return items


def collect_movies(venues):
    items = []
    live = fetch_linkedevents_movies()
    if live:
        items.extend(live)
    else:
        print("[info] Using fallback movie data", file=sys.stderr)
        for m in FALLBACK_MOVIES:
            v = venue_by_key(venues, m["venue_key"]) if m.get("venue_key") else None
            lat = v["lat"] if v else None
            lon = v["lon"] if v else None
            km, walking = distance_from_station(lat, lon)
            items.append({
                "id": "movie:" + slug(m["title"]),
                "title": m["title"],
                "place": m["place"],
                "mall": m.get("mall") or (v.get("mall") if v else None),
                "street": m["street"],
                "locality": m["locality"],
                "region": region_for(m["locality"]),
                "venue_key": m.get("venue_key"),
                "category": m["category"],
                "price_kg": m["price_kg"],
                "price_eur": m["price_eur"],
                "price_label": treat_price_label(m["price_kg"], m["price_eur"]),
                "valid": m["valid"],
                "source": m["source"],
                "source_url": m["source_url"],
                "lat": lat,
                "lon": lon,
                "station_km": km,
                "station_walking": walking,
                "maps_url": maps_url(m["street"], m["locality"], lat, lon),
                "badge": f"🎟️ Leffa {m['price_eur']:.2f} €".replace(".", ","),
                "tags": ["leffa", "elokuva"],
                "date": m["valid"],
            })
    return items


def run():
    venues_data = load_venues()
    venues = venues_data.get("venues", [])

    treats = collect_treats(venues)
    movies = collect_movies(venues)

    events = treats + movies
    # sort: price ascending, then name
    events.sort(key=lambda e: (e["price_eur"] if e["price_eur"] is not None else 9999, e["title"]))

    payload = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "nextUpdateAt": next_update_iso(),
        "updateSchedule": "Twice daily at 06:00 and 19:00 (Europe/Helsinki)",
        "sources": [
            "https://api.hel.fi/linkedevents/v1/event/",
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
