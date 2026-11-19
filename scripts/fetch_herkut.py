#!/usr/bin/env python3
# fetch_herkut.py - Herkku / Candy snapshot scraper
#
# Combines:
#   1) Live-curated treat / bulk-candy / bakery offers from public retail sources
#   2) Cheap movie ticket special days (<= 7 EUR) from MyHelsinki Linked Events API
#
# ZERO fake / hallucinated deals. Every item is parsed from a real, live source.
# If no live source returns verified items, the snapshot is empty (honest empty state).
#
# Output: herkku/herkku_snapshot.json
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

MALLS = ["tripla", "kamppi", "redi", "forum", "itis", "iso omena", "sello", "lauttis"]


def helsinki_today():
    """Today's date in Europe/Helsinki timezone."""
    hel = timezone(timedelta(hours=3))
    return datetime.now(hel).date()


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
    """Walking time at 80 m/min (~4.8 km/h brisk walking)."""
    if km is None:
        return None
    mins = (km * 1000) / 80.0
    if mins < 1:
        return "< 1 min"
    if mins < 60:
        return f"{round(mins)} min"
    h = math.floor(mins / 60)
    m = round(mins % 60)
    return f"{h} h" if m == 0 else f"{h} h {m} min"


def load_venues():
    with open(VENUES_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def venue_by_key(venues, key):
    for v in venues:
        if v["key"] == key:
            return v
    return None


def venue_by_name(venues, name):
    for v in venues:
        if v.get("name") and v["name"].lower() in name.lower():
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


def finnish_weekday(d):
    weekdays = ["ma", "ti", "ke", "to", "pe", "la", "su"]
    return weekdays[d.weekday()]


def build_valid_label(valid_from, valid_until, date_str):
    """Build a clear Finnish validity label."""
    today = helsinki_today()
    vf = None
    vu = None
    if valid_from:
        try:
            vf = datetime.fromisoformat(valid_from).date()
        except Exception:
            pass
    if valid_until:
        try:
            vu = datetime.fromisoformat(valid_until).date()
        except Exception:
            pass

    if vu and vu < today:
        return "vanhentunut"  # filtered out by caller

    if date_str:
        return date_str

    if vf and vu:
        if vu == today:
            return f"🔥 Viimeinen päivä! (tänään {today.day}.{today.month}. asti)"
        if vf <= today:
            days_left = (vu - today).days
            vf_wd = finnish_weekday(vf)
            vf_d = str(vf.day)
            vf_m = str(vf.month)
            vu_wd = finnish_weekday(vu)
            vu_d = str(vu.day)
            vu_m = str(vu.month)
            return "🗓️ Voimassa " + vf_wd + " " + vf_d + "." + vf_m + "-" + vu_wd + " " + vu_d + "." + vu_m + " asti (vielä " + str(days_left) + " pv)"
        vf_wd = finnish_weekday(vf)
        vf_d = str(vf.day)
        vf_m = str(vf.month)
        vu_wd = finnish_weekday(vu)
        vu_d = str(vu.day)
        vu_m = str(vu.month)
        return "🗓️ Voimassa " + vf_wd + " " + vf_d + "." + vf_m + "-" + vu_wd + " " + vu_d + "." + vu_m + "."
    if vf:
        vf_wd = finnish_weekday(vf)
        vf_d = str(vf.day)
        vf_m = str(vf.month)
        return "🗓️ Voimassa alkaen " + vf_wd + " " + vf_d + "." + vf_m + "."
    return ""


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
    valid_from=None,
    valid_until=None,
    source_type="live_verified",
    source_name="",
    deal_url="",
    store_offers_url="",
    street="",
    locality="",
    venue_key=None,
    lat=None,
    lon=None,
    tags=None,
    badge="🍬 Herkku",
    date_str="",
):
    price_numeric = price_kg if price_kg is not None else price_eur
    price_display = fmt_price_kg(price_kg) if price_kg is not None else fmt_price_eur(price_eur)
    km, walking = distance_from(lat, lon, STATION_LAT, STATION_LON)
    valid_label = build_valid_label(valid_from, valid_until, date_str)

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
        "valid_from": valid_from or "",
        "valid_until": valid_until or "",
        "valid": valid_label,
        "source_type": source_type,
        "source_name": source_name,
        "deal_url": deal_url,
        "store_offers_url": store_offers_url,
        "street": street,
        "locality": locality,
        "venue_key": venue_key,
        "lat": lat,
        "lon": lon,
        "station_km": km,
        "station_walking": walking,
        "distKm": km,
        "distWalking": walking,
        "maps_url": maps_url(street, locality, lat, lon),
        "badge": badge,
        "tags": tags or [],
        "date_str": date_str,
    }


# ---------------------------------------------------------------------------
# Live fetchers (best-effort; standard library only). Returns [] on failure.
# ---------------------------------------------------------------------------

def try_kruoka_treats(venues):
    """Attempt to fetch K-Ruoka current weekly offers. Returns [] on failure - no fakes."""
    items = []
    try:
        text = fetch_text("https://www.k-ruoka.fi/tarjoukset", timeout=15)
        low = text.lower()
        if not any(k in low for k in TREAT_KEYWORDS):
            return items
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
    """Attempt to fetch Lidl Suomi weekly tarjoukset. Returns [] on failure - no fakes."""
    items = []
    try:
        text = fetch_text("https://www.lidl.fi/tarjoukset", timeout=15)
        low = text.lower()
        if not any(k in low for k in TREAT_KEYWORDS):
            return items
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
    """Attempt to fetch S-Kaupat / Hok-Elanto weekly tarjoukset. Returns [] on failure - no fakes."""
    items = []
    try:
        text = fetch_text("https://www.s-kanava.fi", timeout=15)
        low = text.lower()
        if not any(k in low for k in TREAT_KEYWORDS):
            return items
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
# Movie fetching from MyHelsinki Linked Events API (live, verified <= 7 EUR)
# ---------------------------------------------------------------------------

def fetch_linkedevents_movies(venues):
    """Fetch cinema events <= 7 EUR from MyHelsinki Linked Events API."""
    results = []
    today_iso = datetime.now(timezone.utc).date().isoformat()
    url = (
        "https://api.hel.fi/linkedevents/v1/event/"
        f"?language=fi&page_size=100&start={today_iso}&include=location"
    )
    pages = 0
    seen = set()
    today = helsinki_today()
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

                name = pick(ev.get("name")) or "Elokuvanäytös"
                desc = strip_html(pick(ev.get("description")))
                loc = ev.get("location") or {}
                locality = pick(loc.get("address_locality")) or "Helsinki"
                street = pick(loc.get("street_address")) or ""
                pos = loc.get("position") or {}
                coords = pos.get("coordinates") if isinstance(pos.get("coordinates"), list) else None
                lon = coords[0] if coords else None
                lat = coords[1] if coords else None

                # Resolve venue from coords.json
                v = None
                for venue in venues:
                    if venue.get("street") and venue["street"].lower() in street.lower():
                        v = venue
                        break
                    if venue.get("name") and venue["name"].lower() in name.lower():
                        v = venue
                        break

                lat = lat or (v["lat"] if v else None)
                lon = lon or (v["lon"] if v else None)
                street = street or (v["street"] if v else "")
                locality = locality or (v["locality"] if v else "")
                mall_name = v["mall"] if v and v.get("mall") else None

                # Extract price <= 7 EUR
                price_eur = extract_eur_price(text, max_eur=7.0)
                if price_eur is None:
                    for off in (ev.get("offers") or []):
                        p = extract_eur_price(pick(off.get("price")) or "", max_eur=7.0)
                        if p is not None:
                            price_eur = p
                            break
                if price_eur is None or price_eur > 7.0:
                    continue

                # Parse dates
                start = ev.get("start_time")
                end = ev.get("end_time")
                date_str = ""
                valid_from = None
                valid_until = None
                if start:
                    try:
                        d = datetime.fromisoformat(start.replace("Z", "+00:00"))
                        d_date = d.date()
                        d_wd = finnish_weekday(d_date)
                        d_day = str(d_date.day)
                        d_month = str(d_date.month)
                        date_str = d_wd + " " + d_day + "." + d_month + " klo " + f"{d.hour:02d}:" + f"{d.minute:02d}"
                        valid_from = d_date.isoformat()
                        if end:
                            try:
                                ed = datetime.fromisoformat(end.replace("Z", "+00:00"))
                                valid_until = ed.date().isoformat()
                            except Exception:
                                valid_until = valid_from
                        else:
                            valid_until = valid_from
                    except Exception:
                        date_str = start

                # Filter out past events
                if valid_until:
                    try:
                        vu = datetime.fromisoformat(valid_until).date()
                        if vu < today:
                            continue
                    except Exception:
                        pass

                region = region_for(locality)
                info_url = ev.get("info_url") or ev.get("@id") or ""
                results.append(
                    build_item(
                        id="movie:" + slug(ev.get("@id") or name),
                        title=name,
                        store_name="Finnkino / Kino",
                        mall_name=mall_name,
                        region=region,
                        category="Leffapäivät",
                        price_kg=None,
                        price_eur=price_eur,
                        valid_from=valid_from,
                        valid_until=valid_until,
                        source_type="live_verified",
                        source_name="Linked Events (MyHelsinki avoin data)",
                        deal_url=info_url,
                        store_offers_url=info_url,
                        street=street,
                        locality=locality,
                        venue_key=v["key"] if v else None,
                        lat=lat,
                        lon=lon,
                        tags=["leffa", "elokuva"],
                        badge="🎟️ Elokuva",
                        date_str=date_str,
                    )
                )
            url = (data.get("meta") or {}).get("next")
    except Exception as exc:
        print(f"[warn] Linked Events fetch failed: {exc}", file=sys.stderr)
    return results


def collect_treats(venues):
    """Build treat items from live sources only. No fakes."""
    items = []
    for fetcher in (try_kruoka_treats, try_lidl_treats, try_skaupat_treats):
        try:
            items.extend(fetcher(venues))
        except Exception as exc:
            print(f"[info] Live fetcher {fetcher.__name__} raised: {exc}", file=sys.stderr)

    today = helsinki_today()
    resolved = []
    for t in items:
        v = venue_by_key(venues, t.get("venue_key") or "") if t.get("venue_key") else None
        if not v:
            v = venue_by_name(venues, t.get("store_name", ""))

        lat = t.get("lat") or (v["lat"] if v else None)
        lon = t.get("lon") or (v["lon"] if v else None)
        street = t.get("street") or (v["street"] if v else "")
        locality = t.get("locality") or (v["locality"] if v else "")
        mall_name = t.get("mall_name") or (v.get("mall") if v else None)

        km, walking = distance_from(lat, lon, STATION_LAT, STATION_LON)
        price_numeric = t.get("price_kg") if t.get("price_kg") is not None else t.get("price_eur")

        # Weekly offer validity: today through today+7 days
        valid_from = today.isoformat()
        valid_until = (today + timedelta(days=7)).isoformat()
        try:
            vu = datetime.fromisoformat(valid_until).date()
            if vu < today:
                continue
        except Exception:
            pass
        end_date = today + timedelta(days=7)
        end_wd = finnish_weekday(end_date)
        end_day = str(end_date.day)
        end_month = str(end_date.month)

        resolved.append({
            **t,
            "lat": lat,
            "lon": lon,
            "street": street,
            "locality": locality,
            "mall_name": mall_name,
            "station_km": km,
            "station_walking": walking,
            "distKm": km,
            "distWalking": walking,
            "maps_url": maps_url(street, locality, lat, lon),
            "valid_from": valid_from,
            "valid_until": valid_until,
            "valid": "🗓️ Voimassa " + end_wd + " " + end_day + "." + end_month + " asti (vielä 7 pv)",
            "price_numeric": price_numeric,
        })
    return resolved


def collect_movies(venues):
    """Build movie items from live Linked Events API only. No fakes."""
    return fetch_linkedevents_movies(venues)


def run():
    venues_data = load_venues()
    venues = venues_data.get("venues", [])

    treats = collect_treats(venues)
    movies = collect_movies(venues)

    events = treats + movies
    # Unit-aware sort: separate price_kg and price_eur
    def sort_key(e):
        kg = e.get("price_kg")
        eur = e.get("price_eur")
        if kg is not None:
            return (0, kg, e["title"])
        if eur is not None:
            return (1, eur, e["title"])
        return (2, 9999, e["title"])
    events.sort(key=sort_key)

    today = helsinki_today().isoformat()
    payload = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "nextUpdateAt": next_update_iso(),
        "updateSchedule": "Twice daily at 06:00 and 19:00 (Europe/Helsinki)",
        "sources": [
            "https://api.hel.fi/linkedevents/v1/event/",
            "https://www.k-ruoka.fi/tarjoukset",
            "https://www.lidl.fi/tarjoukset",
            "https://www.s-kanava.fi",
        ],
        "total": len(events),
        "today": today,
        "treats": events,
    }

    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print(f"Herkku snapshot saved: {len(events)} items -> {OUT_PATH}")
    print(f"  Treats: {len(treats)}, Movies: {len(movies)}")


if __name__ == "__main__":
    run()
