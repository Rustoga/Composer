#!/usr/bin/env python3
import argparse
import hashlib
import json
import re
import time
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse
from zoneinfo import ZoneInfo

import certifi
import requests

TZ_HEL = ZoneInfo("Europe/Helsinki")
ROOT_DIR = Path(__file__).resolve().parent.parent
SNAPSHOT_PATH = ROOT_DIR / "herkku" / "herkku_snapshot.json"
HEALTH_LOG_PATH = ROOT_DIR / "logs" / "scraper_health.json"

def url_of(host: str, path: str) -> str:
    return "https" + "://" + host + path
HEADERS = {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    "Accept-Language": "fi-FI,fi;q=0.9,en;q=0.8",
}

TREAT_KEYWORDS = [
    "irtokark", "makeis", "suklaa", "karkki", "marmeladi", "lakrits",
    "salmiak", "pulla", "leivos", "munkki", "croissant", "jäätelö",
    "viennetta", "keksi", "donitsi", "viineri", "kakku", "paistopiste",
    "kahvi", "glögi", "pipari", "fazer", "marabou", "panda", "malaco",
    "haribo", "arnolds", "gateau", "kanniston", "energy", "energiajuoma",
    "red bull", "battery", "monster", "burn",
]
NON_TREAT_WORDS = [
    "makkara", "maksamakkara", "herkkumaksamakkara", "herkkusieni", "sieni",
    "kinkku", "broileri", "kana", "lohi", "juusto", "maito", "peruna",
    "kurkku", "tomaatti", "salaatti", "pesuaine", "vaippa", "koiran",
    "kissan",
]
CINEMA_KEYWORDS = ["elokuva", "kino", "leffa", "näytös", "cinema", "superpäivä", "leffapäivä"]

class SourceHealthMonitor:
    def __init__(self, previous_health: Dict[str, Any]):
        self.prev_sources = previous_health.get("sources", {})
        self.sources: Dict[str, Dict[str, Any]] = {}

    def record(self, source_key: str, status: str, items_found: int, latency_ms: int, http_status: Optional[int] = None, error_reason: Optional[str] = None) -> None:
        prev_streak = self.prev_sources.get(source_key, {}).get("consecutive_failures", 0)
        self.sources[source_key] = {
            "status": status,
            "items_found": items_found,
            "latency_ms": latency_ms,
            "http_status": http_status,
            "error_reason": error_reason,
            "consecutive_failures": (prev_streak + 1) if status in ("blocked", "error") else 0,
            "checked_at": datetime.now(TZ_HEL).isoformat(),
        }

    def summary(self) -> Dict[str, Any]:
        total = len(self.sources)
        ok_count = sum(1 for s in self.sources.values() if s["status"] in ("ok", "empty"))
        failing = [k for k, v in self.sources.items() if v.get("consecutive_failures", 0) >= 2]
        return {"ok_sources": ok_count, "total_sources": total, "needs_attention": failing, "sources": self.sources}
def load_json(path: Path, default: Any) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8")) if path.exists() else default
    except Exception:
        return default

def make_id(source: str, title: str, store: str) -> str:
    return f"{source}_{hashlib.sha256(f'{source}|{title}|{store}'.encode('utf-8')).hexdigest()[:12]}"

def is_valid_deep_url(url: str) -> bool:
    if not url or not url.startswith("https://"):
        return False
    p = urlparse(url)
    return bool(p.netloc) and (len(p.path.strip("/")) > 0 or bool(p.query) or bool(p.fragment))

def is_valid_finland_coords(lat: Optional[float], lon: Optional[float]) -> bool:
    return lat is not None and lon is not None and 59.5 <= float(lat) <= 70.1 and 19.0 <= float(lon) <= 31.6

def infer_region(text: str) -> str:
    low = (text or "").lower()
    if any(k in low for k in ["espoo", "isoomena", "iso omena", "sello", "ainoa"]):
        return "Espoo"
    if any(k in low for k in ["vantaa", "jumbo", "dixi", "myyrmanni"]):
        return "Vantaa"
    return "Helsinki"

def target_region(text: str) -> Optional[str]:
    low = (text or "").lower()
    if any(k in low for k in ["espoo", "isoomena", "iso omena", "sello", "ainoa", "omena"]):
        return "Espoo"
    if any(k in low for k in ["vantaa", "jumbo", "dixi", "myyrmanni", "flamingo"]):
        return "Vantaa"
    if any(k in low for k in ["helsinki", "lauttasaari", "lauttis", "käpylä", "itis", "tennispalatsi", "kinopalatsi", "maxim", "malmi", "pasila", "kallio", "kamppi", "ruoholahti", "haaga", "munkkiniemi", "töölö", "kluuvi", "viikki", "myllypuro", "kontula", "vuosaari", "herttoniemi", "laajasalo"]):
        return "Helsinki"
    return None

EXCLUDE_KEYWORDS = [
    "ruisleipä", "paahtoleipä", "kauraleipä", "moniviljaleipä", "sämpylä", "patonki",
    "näkkileipä", "rieska", "ruispala", "jälkiuuni", "vehnäjauho", "hiiva",
    "kaurajuoma", "kauramaito", "barista", "soijajuoma", "mantelijuoma", "maito",
    "kevytmaito", "rasvaton", "piimä", "jugurtti", "jogurtti", "rahka", "raejuusto",
    "juusto", "edam", "oltermanni", "voi", "margariini", "levite", "suodatinjauhatus",
    "kahvipapu", "juhla mokka", "presidentti", "kultakatriina", "klementiini",
    "mandariini", "appelsiini", "banaani", "omena", "kurkku", "tomaatti", "salaatti",
    "peruna", "porkkana", "sipuli", "herkkusieni", "sieni", "makkara",
    "maksamakkara", "kinkku", "leikkele", "broileri", "kana", "jauheliha", "lohi",
    "kirjolohi", "tonnikala", "kananmuna", "puuro", "hiutale", "makaroni", "spagetti",
    "riisi", "koiran", "kissan", "kissanhiekka", "vaippa", "pesuaine", "huuhteluaine",
    "shampoo", "saippua", "hammastahna", "wc-paperi", "talouspaperi", "paistinpannu",
    "kattila", "keitto", "soppa", "pinaatti",
]

CATEGORY_KEYWORDS = {
    "irtokarkki": ["irtokark", "irtomakeis", "makeis", "karkki", "karkkipussi", "marmeladi", "lakrits", "salmiak", "toffee", "fudge", "vaahtokark", "hedelmäaakkos", "tutti frutti", "remix", "pantteri", "aakkoset", "hyvää makumaasta", "ärräbox", "karkkiboksi", "pihlaja", "omar", "dumle", "candy", "pick and mix", "pick & mix", "sweets", "gummies", "licorice", "liquorice", "fazer", "malaco", "haribo", "panda", "cloetta", "brunberg", "halva"],
    "suklaa": ["suklaa", "suklaalevy", "suklaapatukka", "konvehti", "suklaarasia", "keksi", "täytekeksi", "suklaakeksi", "vohveli", "pipari", "piparkakku", "chocolate", "praline", "truffle", "brownie", "cookie", "biscuit", "wafer", "marabou", "geisha", "karl fazer", "kinder", "twix", "snickers", "mars", "bounty", "daim", "oreo", "domino", "jaffa", "ritter sport", "lindt", "toblerone"],
    "leipomo": ["korvapuusti", "pulla", "kanelipulla", "voisilmäpulla", "kardemummapulla", "rahkapulla", "vaniljapulla", "croissant", "kroissantti", "mantelikroissantti", "suklaakroissantti", "leivos", "munkki", "hillomunkki", "berliininmunkki", "donitsi", "viineri", "kakku", "mutakakku", "juustokakku", "porkkanakakku", "tuulihattu", "marenki", "runeberg", "laskiaispulla", "banaanileipä", "paistopiste", "konditoria", "leipomo", "hävikki", "yllätyskassi", "almond croissant", "pain au chocolat", "cinnamon bun", "cardamom bun", "pastry", "pastries", "bakery", "donut", "doughnut", "muffin", "cupcake", "scone", "tart", "cake", "surplus bag", "magic bag", "gateau", "arnolds", "kanniston", "robert's coffee", "espresso house", "fazer café", "picnic", "waynes", "backers"],
    "pizza": ["pizza", "kiviuunipizza", "pannupizza", "uunipizza", "pakastepizza", "pizzapala", "calzone", "sipsi", "perunalastu", "juustonaksu", "popcorn", "nachot", "hampurilainen", "burgeri", "hodari", "ranskalaiset", "slice", "crisps", "chips", "nachos", "burger", "hot dog", "fries", "grandiosa", "dr. oetker", "ristorante", "casa di mama", "apetit", "kotipizza", "pizzarium", "pringles", "estrella", "taffel"],
    "jäätelö": ["jäätelö", "jäätelöpaketti", "jäätelöpuikko", "tuutti", "jäätelökakku", "sorbetti", "gelato", "pehmis", "ice cream", "sundae", "viennetta", "ben & jerry", "häagen-dazs", "pingviini", "aino", "classic", "magnum", "solero", "twister", "3 kaveria", "kolmen kaverin"],
    "energy": ["energiajuoma", "energy drink", "battery", "red bull", "monster", "nocco", "ed ", "teho", "celsius", "prime", "burn", "cult", "mad-croc"],
    "leffa": ["elokuva", "leffa", "leffapäivä", "superpäivä", "päivänäytös", "senioribio", "vauvakino", "näytös", "ensi-ilta", "elokuvateatteri", "ulkoilmaelokuva", "ilmaisnäytös", "leffalippu", "cinema", "movie", "film", "screening", "matinee", "film festival", "finnkino", "tennispalatsi", "kinopalatsi", "itis", "omena", "sello", "kino regina", "orion", "riviera", "bio rex", "korjaamo kino", "engel", "maxim"],
}

def classify_category(text: str) -> Optional[str]:
    low = (text or "").lower()
    for w in EXCLUDE_KEYWORDS:
        if w in low:
            if w == "leipä" and ("banaanileipä" in low or "rusinaleipä" in low):
                continue
            return None
    for cat in ["irtokarkki", "suklaa", "leipomo", "pizza", "jäätelö", "energy", "leffa"]:
        if any(k in low for k in CATEGORY_KEYWORDS.get(cat, [])):
            return cat
    return None

def extract_normal_price(text: str) -> Optional[float]:
    for pat in [r"norm\.?\s*(\d+[,.]\d{1,2})\s*€", r"normaalihinta\s*(\d+[,.]\d{1,2})\s*€", r"ovh\s*(\d+[,.]\d{1,2})\s*€", r"30\s*pv\s*alin[^\d]*(\d+[,.]\d{1,2})\s*€"]:
        m = re.search(pat, text or "", re.IGNORECASE)
        if m:
            return float(m.group(1).replace(",", "."))
    return None

def benchmark_for(category: str, price_eur: float, price_kg: Optional[float]) -> float:
    if category == "irtokarkki":
        return 10.90 if price_kg is not None else 3.20
    if category == "suklaa":
        return 5.50 if price_eur > 3.80 else 3.80
    if category == "pizza":
        return 12.50 if price_eur > 4.20 else 4.20
    return {"leipomo": 4.20, "jäätelö": 4.90, "energy": 2.45, "leffa": 14.50}.get(category, 4.0)

def is_good_deal(category: str, price_eur: float, price_kg: Optional[float], discount_pct: int) -> bool:
    if category == "irtokarkki":
        if price_kg is not None and price_kg <= 7.90:
            return True
        if price_eur <= 2.20:
            return True
        if discount_pct >= 20:
            return True
        return False
    if category == "suklaa":
        return price_eur <= 4.20 or discount_pct >= 20
    if category == "leipomo":
        return price_eur <= 4.50 or discount_pct >= 25
    if category == "pizza":
        return price_eur <= 7.00 or discount_pct >= 20
    if category == "jäätelö":
        return price_eur <= 3.00 or discount_pct >= 25
    if category == "energy":
        return price_eur <= 5.50 or discount_pct >= 20
    if category == "leffa":
        return price_eur <= 7.00
    return False

def deal_tier(price_eur: float, discount_pct: int) -> str:
    if discount_pct >= 35 or price_eur <= 2.00:
        return "huippudiili"
    return "hyva_tarjous"

def get_next_update_iso(now_hel: datetime) -> str:
    t06 = now_hel.replace(hour=6, minute=0, second=0, microsecond=0)
    t19 = now_hel.replace(hour=19, minute=0, second=0, microsecond=0)
    if now_hel < t06:
        return t06.isoformat()
    if now_hel < t19:
        return t19.isoformat()
    return (t06 + timedelta(days=1)).isoformat()
def fetch_resq_club(monitor: SourceHealthMonitor, now_hel: datetime) -> List[Dict[str, Any]]:
    t0 = time.monotonic()
    items: List[Dict[str, Any]] = []
    try:
        from playwright.sync_api import sync_playwright
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            page = browser.new_page(user_agent=HEADERS["User-Agent"], locale="fi-FI")
            resp = page.goto("https://resq-club.com/app", wait_until="domcontentloaded", timeout=25000)
            page.wait_for_timeout(4000)
            status = resp.status if resp else 200
            html = page.content()
            browser.close()
        latency = int((time.monotonic() - t0) * 1000)
        if status and status >= 400:
            monitor.record("resq_club", "blocked" if status in (403, 429) else "error", 0, latency, status, f"HTTP {status}")
            return []
        for block in html.split('<div class="offerRow"')[1:]:
            oid_m = re.search(r'oid="([^"]+)"', block)
            price_m = re.search(r'<span class="price">([\d.,]+)</span>', block)
            name_m = re.search(r'<div class="offerRowName">(.*?)</div>', block, re.S)
            prov_m = re.search(r'<div class="offerRowProviderName">(.*?)</div>', block, re.S)
            if not (oid_m and price_m and name_m):
                continue
            oid = oid_m.group(1)
            try:
                p_eur = float(price_m.group(1).replace(",", "."))
            except ValueError:
                continue
            if p_eur <= 0 or p_eur > 7.0:
                continue
            oname = re.sub(r"<[^>]+>", "", name_m.group(1)).strip()
            vname = re.sub(r"<[^>]+>", "", prov_m.group(1)).strip() if prov_m else "ResQ-kumppani"
            if any(w in (oname + " " + vname).lower() for w in EXCLUDE_KEYWORDS) and not (("banaanileipä" in (oname+vname).lower()) or ("rusinaleipä" in (oname+vname).lower())):
                continue
            cat = classify_category(oname)
            if cat is None:
                continue
            normal = extract_normal_price(oname) or benchmark_for(cat, p_eur, None)
            discount = round((1 - p_eur / normal) * 100) if normal and normal > p_eur else 0
            tier = deal_tier(p_eur, discount)
            if not is_good_deal(cat, p_eur, None, discount):
                continue
            addr = vname
            reg = target_region(f"{addr} {vname}")
            if reg is None:
                continue
            lat, lon = 60.1699, 24.9384
            durl = url_of("resq-club.com", f"/app/offers/{oid}")
            items.append({
                "id": make_id("resq", oname, vname),
                "title": f"{oname} – {vname}",
                "store_name": vname,
                "mall_name": "Lauttis" if "lauttasaari" in addr.lower() or "lauttis" in vname.lower() else "",
                "address": addr,
                "region": reg,
                "category": cat,
                "price_eur": round(p_eur, 2),
                "price_kg": None,
                "normal_price_eur": round(normal, 2) if normal else None,
                "discount_pct": discount,
                "deal_tier": tier,
                "price_display": f"{p_eur:.2f}".replace(".", ",") + " €",
                "valid_from": now_hel.strftime("%Y-%m-%d"),
                "valid_until": now_hel.strftime("%Y-%m-%d"),
                "custom_time_label": "Nouto tänään (ResQ)",
                "lat": lat,
                "lon": lon,
                "source_type": "live_verified",
                "source_name": "ResQ Club",
                "deal_url": durl,
                "store_offers_url": durl,
                "maps_url": url_of("www.google.com", f"/maps/search/?api=1&query={lat},{lon}"),
                "verified_at": now_hel.isoformat(),
            })
        monitor.record("resq_club", "ok" if items else "empty", len(items), latency, status)
    except Exception as exc:
        monitor.record("resq_club", "error", 0, int((time.monotonic() - t0) * 1000), None, str(exc)[:180])
    return items
def fetch_myhelsinki_events(monitor: SourceHealthMonitor, now_hel: datetime) -> List[Dict[str, Any]]:
    t0 = time.monotonic()
    url = url_of("api.hel.fi", "/linkedevents/v1/event/")
    items: List[Dict[str, Any]] = []
    try:
        resp = requests.get(
            url,
            params={"start": now_hel.strftime("%Y-%m-%d"), "end": (now_hel + timedelta(days=7)).strftime("%Y-%m-%d"), "include": "location", "page_size": 60},
            headers=HEADERS,
            timeout=15,
            verify=certifi.where(),
        )
        latency = int((time.monotonic() - t0) * 1000)
        if resp.status_code != 200:
            monitor.record("myhelsinki_events", "blocked" if resp.status_code in (403, 429) else "error", 0, latency, resp.status_code, f"HTTP {resp.status_code}")
            return []
        for ev in resp.json().get("data", []):
            title = ((ev.get("name") or {}).get("fi") or (ev.get("name") or {}).get("en") or "").strip()
            desc = ((ev.get("short_description") or {}).get("fi") or "").strip()
            if not title:
                continue
            blob = f"{title} {desc}".lower()
            if any(w in blob for w in EXCLUDE_KEYWORDS) and not (("banaanileipä" in blob) or ("rusinaleipä" in blob)):
                # still allow if title itself has treat? exclude wins
                pass
            if any(w in blob for w in EXCLUDE_KEYWORDS) and not (("banaanileipä" in blob) or ("rusinaleipä" in blob)):
                continue
            cat = classify_category(title)
            if cat is None:
                continue
            offers = ev.get("offers") or []
            p_eur: Optional[float] = 0.0 if any(o.get("is_free") for o in offers) else None
            if p_eur is None:
                for o in offers:
                    ptxt = (o.get("price") or {}).get("fi") or (o.get("price") or {}).get("en") or ""
                    m = re.search(r"(\d+(?:[.,]\d{1,2})?)\s*€", ptxt)
                    if m and float(m.group(1).replace(",", ".")) <= 7.0:
                        p_eur = float(m.group(1).replace(",", "."))
                        break
            if p_eur is None or p_eur > 7.0:
                continue
            normal = extract_normal_price(blob) or benchmark_for(cat, p_eur, None)
            discount = round((1 - p_eur / normal) * 100) if normal and normal > p_eur else 0
            tier = deal_tier(p_eur, discount)
            if not is_good_deal(cat, p_eur, None, discount):
                continue
            loc = ev.get("location") if isinstance(ev.get("location"), dict) else {}
            vname = ((loc.get("name") or {}).get("fi") or "Helsinki").strip()
            addr = ((loc.get("street_address") or {}).get("fi") or "Helsinki").strip()
            coords = (loc.get("position") or {}).get("coordinates") or [24.9384, 60.1699]
            try:
                lon, lat = float(coords[0]), float(coords[1])
            except (TypeError, ValueError, IndexError):
                lon, lat = 24.9384, 60.1699
            if not is_valid_finland_coords(lat, lon):
                lat, lon = 60.1699, 24.9384
            end_s = (ev.get("end_time") or ev.get("start_time") or now_hel.isoformat())[:10]
            durl = url_of("tapahtumat.hel.fi", f"/fi/tapahtumat/{ev.get('id', '')}")
            items.append({
                "id": make_id("hel", title, vname),
                "title": title,
                "store_name": vname,
                "mall_name": "",
                "address": addr,
                "region": reg,
                "category": cat,
                "price_eur": round(p_eur, 2),
                "normal_price_eur": round(normal, 2) if normal else None,
                "discount_pct": discount,
                "deal_tier": tier,
                "price_kg": None,
                "price_display": "Vapaa pääsy (0 €)" if p_eur == 0 else f"{p_eur:.2f}".replace(".", ",") + " €",
                "valid_from": now_hel.strftime("%Y-%m-%d"),
                "valid_until": end_s,
                "custom_time_label": f"Voimassa {end_s} asti",
                "lat": lat,
                "lon": lon,
                "source_type": "live_verified",
                "source_name": "MyHelsinki Linked Events",
                "deal_url": durl,
                "store_offers_url": durl,
                "maps_url": url_of("www.google.com", f"/maps/search/?api=1&query={lat},{lon}"),
                "verified_at": now_hel.isoformat(),
            })
        monitor.record("myhelsinki_events", "ok" if items else "empty", len(items), latency, resp.status_code)
    except Exception as exc:
        monitor.record("myhelsinki_events", "error", 0, int((time.monotonic() - t0) * 1000), None, str(exc)[:180])
    return items
def fetch_finnkino_movies(monitor: SourceHealthMonitor, now_hel: datetime) -> List[Dict[str, Any]]:
    t0 = time.monotonic()
    url = url_of("www.finnkino.fi", "/xml/Schedule/")
    items: List[Dict[str, Any]] = []
    try:
        from playwright.sync_api import sync_playwright
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            page = browser.new_page(user_agent=HEADERS["User-Agent"], locale="fi-FI")
            resp = page.goto(url + "?area=1002&dt=" + now_hel.strftime("%d.%m.%Y"), wait_until="domcontentloaded", timeout=25000)
            page.wait_for_timeout(2000)
            status = resp.status if resp else None
            text = page.content()
            browser.close()
        latency = int((time.monotonic() - t0) * 1000)
        if status and status >= 400:
            monitor.record("finnkino_movies", "blocked" if status in (403, 429) else "error", 0, latency, status, f"HTTP {status}")
            return []
        try:
            root = ET.fromstring(text)
        except Exception:
            # Playwright may wrap XML in HTML; try extracting
            m = re.search(r"<Schedule.*</Schedule>", text, re.S)
            root = ET.fromstring(m.group(0)) if m else None
        if root is None:
            monitor.record("finnkino_movies", "error", 0, latency, status, "invalid XML")
            return []
        for show in root.findall(".//Show"):
            title = (show.findtext("Title") or "").strip()
            theatre = (show.findtext("Theatre") or "Finnkino").strip()
            pres = (show.findtext("PresentationMethodAndLanguage") or "").lower()
            surl = (show.findtext("ShowURL") or url_of("www.finnkino.fi", "/ohjelmisto")).strip()
            sdt = (show.findtext("dttmShowStart") or "")[:16]
            blob = f"{title.lower()} {pres}"
            price = 6.50 if ("superpäivä" in blob or "leffapäivä" in blob) else (7.00 if ("päivänäytös" in blob or "senioribio" in blob) else None)
            if price is None:
                continue
            cat = "leffa"
            normal = 14.50
            discount = round((1 - price / normal) * 100) if normal > price else 0
            tier = deal_tier(price, discount)
            if not is_good_deal(cat, price, price_kg, discount):
                continue
            items.append({
                "id": make_id("finnkino", f"{title}_{sdt}", theatre),
                "title": f"{title} ({sdt[11:16]})" if len(sdt) >= 16 else title,
                "store_name": theatre,
                "mall_name": "Itis" if "itis" in theatre.lower() else "",
                "address": f"{theatre}, Helsinki",
                "region": "Helsinki",
                "category": cat,
                "price_eur": price,
                "price_kg": None,
                "normal_price_eur": normal,
                "discount_pct": discount,
                "deal_tier": tier,
                "price_display": (f"{price:.2f}".replace(".", ",") + " €/kg") if unit_label == "€/kg" else (f"{price:.2f}".replace(".", ",") + " €"),
                "valid_from": now_hel.strftime("%Y-%m-%d"),
                "valid_until": now_hel.strftime("%Y-%m-%d"),
                "custom_time_label": f"Näytös tänään klo {sdt[11:16]}" if len(sdt) >= 16 else "Tänään",
                "lat": 60.1695,
                "lon": 24.9308,
                "source_type": "live_verified",
                "source_name": "Finnkino Aikataulu",
                "deal_url": surl if is_valid_deep_url(surl) else url_of("www.finnkino.fi", "/ohjelmisto"),
                "store_offers_url": url_of("www.finnkino.fi", "/ohjelmisto"),
                "maps_url": url_of("www.google.com", "/maps/search/?api=1&query=60.1695,24.9308"),
                "verified_at": now_hel.isoformat(),
            })
        monitor.record("finnkino_movies", "ok" if items else "empty", len(items), latency, status)
    except Exception as exc:
        monitor.record("finnkino_movies", "error", 0, int((time.monotonic() - t0) * 1000), None, str(exc)[:180])
    return items
def fetch_supermarket(source_key: str, source_name: str, url: str, deep_url: str, store: str, mall: str, addr: str, lat: float, lon: float, monitor: SourceHealthMonitor, now_hel: datetime) -> List[Dict[str, Any]]:
    t0 = time.monotonic()
    items: List[Dict[str, Any]] = []
    try:
        from playwright.sync_api import sync_playwright
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            page = browser.new_page(user_agent=HEADERS["User-Agent"], locale="fi-FI")
            resp = page.goto(url, wait_until="domcontentloaded", timeout=25000)
            page.wait_for_timeout(2000)
            status = resp.status if resp else None
            body = page.inner_text("body")
            browser.close()
        latency = int((time.monotonic() - t0) * 1000)
        if status in (403, 429):
            monitor.record(source_key, "blocked", 0, latency, status, f"HTTP {status}")
            return []
        if status and status >= 400:
            monitor.record(source_key, "error", 0, latency, status, f"HTTP {status}")
            return []
        lines = [ln.strip() for ln in body.splitlines() if ln.strip()]
        badge_labels = {"uusi", "plussa-kortilla", "etuhinta", "tarjous", "kampanja", "rajoitettu erä", "norm.", "vertailuhinta"}
        def extract_title(idx: int) -> str:
            for j in (idx - 1, idx - 2, idx - 3):
                if j < 0:
                    continue
                cand = lines[j].strip()
                low = cand.lower()
                if not cand or len(cand) <= 3:
                    continue
                if low in badge_labels:
                    continue
                if any(b in low for b in badge_labels):
                    continue
                if low.startswith(("−", "-", "–")):
                    continue
                if re.match(r"^\d", low):
                    continue
                return cand
            return lines[idx].strip()
        for i, ln in enumerate(lines):
            low_ln = ln.lower()
            if any(b in low_ln for b in ["vertailuhinta", "norm."]):
                continue
            price = None
            price_kg = None
            unit_label = "€"
            mm = re.search(r"(\d+)\s*kpl\s*(\d+[,.]\d{2})\s*€", low_ln)
            if mm:
                count = int(mm.group(1))
                try:
                    total = float(mm.group(2).replace(",", "."))
                except ValueError:
                    total = 0.0
                per_item = (total / count) if count > 0 else total
                if per_item <= 7.0:
                    price = per_item
                    unit_label = "€/kpl"
            mk = re.search(r"(\d{1,2})[,.](\d{2})\s*€\s*/\s*kg", low_ln)
            if mk and price is None:
                val = float(f"{mk.group(1)}.{mk.group(2)}")
                price = val
                price_kg = val
                unit_label = "€/kg"
            if price is None:
                mp = re.search(r"(\d{1,2})[,.](\d{2})\s*€", ln)
                if not mp:
                    continue
                price = float(f"{mp.group(1)}.{mp.group(2)}")
                mc = re.search(r"(\d{1,2})[,.](\d{2})\s*€\s*/\s*kg", ln)
                if mc:
                    price_kg = float(f"{mc.group(1)}.{mc.group(2)}")
            if price is None:
                continue
            if price <= 0.15:
                continue
            if price > 7.0 and not (unit_label == "€/kg" and price <= 7.90):
                continue
            ctx_txt = " ".join(lines[max(0, i - 2): min(len(lines), i + 3)]).lower()
            title = extract_title(i)
            tlow = title.lower()
            ctx_low = ctx_txt.lower()
            if any(w in ctx_low or w in tlow for w in EXCLUDE_KEYWORDS):
                # leipä exception
                if not ("banaanileipä" in ctx_low or "rusinaleipä" in ctx_low):
                    pass
            if any(w in ctx_low or w in tlow for w in EXCLUDE_KEYWORDS) and not (("banaanileipä" in ctx_low or "banaanileipä" in tlow) or ("rusinaleipä" in ctx_low or "rusinaleipä" in tlow)):
                continue
            cat = classify_category(title)
            if cat is None:
                continue
            normal = extract_normal_price(ctx_txt) or extract_normal_price(title) or benchmark_for(cat, price, price_kg)
            discount = round((1 - price / normal) * 100) if normal and normal > price else 0
            tier = deal_tier(price, discount)
            if not is_good_deal(cat, price, price_kg, discount):
                continue
            v_end = (now_hel + timedelta(days=3)).strftime("%Y-%m-%d")
            items.append({
                "id": make_id(source_key, title, store),
                "title": title[:110],
                "store_name": store,
                "mall_name": mall,
                "address": addr,
                "region": "Helsinki",
                "category": cat,
                "price_eur": round(price, 2),
                "normal_price_eur": round(normal, 2) if normal else None,
                "discount_pct": discount,
                "deal_tier": tier,
                "price_kg": None,
                "price_display": (f"{price:.2f}".replace(".", ",") + " €/kg") if unit_label == "€/kg" else (f"{price:.2f}".replace(".", ",") + " €"),
                "valid_from": now_hel.strftime("%Y-%m-%d"),
                "valid_until": v_end,
                "custom_time_label": None,
                "lat": lat,
                "lon": lon,
                "source_type": "live_verified",
                "source_name": source_name,
                "deal_url": deep_url,
                "store_offers_url": deep_url,
                "maps_url": url_of("www.google.com", f"/maps/search/?api=1&query={lat},{lon}"),
                "verified_at": now_hel.isoformat(),
            })
        monitor.record(source_key, "ok" if items else "empty", len(items), latency, status)
    except Exception as exc:
        monitor.record(source_key, "error", 0, int((time.monotonic() - t0) * 1000), None, str(exc)[:180])
    return items
def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--self-check", action="store_true")
    args = parser.parse_args()

    now_hel = datetime.now(TZ_HEL)
    today_str = now_hel.strftime("%Y-%m-%d")
    SNAPSHOT_PATH.parent.mkdir(parents=True, exist_ok=True)
    HEALTH_LOG_PATH.parent.mkdir(parents=True, exist_ok=True)

    prev_snap = load_json(SNAPSHOT_PATH, {})
    prev_health = load_json(HEALTH_LOG_PATH, {})
    monitor = SourceHealthMonitor(prev_health)

    u_kruoka = url_of("www.k-ruoka.fi", "/artikkelit/k-supermarket/k-supermarket-tarjoukset")
    u_kruoka_alt = url_of("www.k-ruoka.fi", "/kauppa/tuotehaku/makeiset-ja-snacksit")
    u_lidl = url_of("www.lidl.fi", "/h/ruoka-ja-juoma/h10068374")
    u_skaupat_candy = url_of("www.s-kaupat.fi", "/tuotteet/makeiset-ja-herkut")
    u_skaupat_fallback = url_of("www.s-kaupat.fi", "/tuotteet?query=makeiset")

    by_source = {
        "resq_club": fetch_resq_club(monitor, now_hel),
        "myhelsinki_events": fetch_myhelsinki_events(monitor, now_hel),
        "finnkino_movies": fetch_finnkino_movies(monitor, now_hel),
        "k_ruoka": fetch_supermarket("k_ruoka", "K-Ruoka Tarjoukset", u_kruoka, u_kruoka, "K-Supermarket Lauttasaari (Lauttis)", "Lauttis", "Lauttasaarentie 28, 00200 Helsinki", 60.1589, 24.8825, monitor, now_hel),
        "lidl": fetch_supermarket("lidl", "Lidl Tarjoukset", u_lidl, u_lidl, "Lidl Lauttasaari", "Lauttasaari", "Heikkiläntie 2, 00210 Helsinki", 60.1572, 24.8861, monitor, now_hel),
        "s_group": fetch_supermarket("s_group", "S-ryhmä Tarjoukset", u_skaupat_candy, u_skaupat_candy, "S-market Lauttasaari", "Lauttasaari", "Lauttasaarentie 23, 00200 Helsinki", 60.1594, 24.8832, monitor, now_hel),
    }
    if not by_source.get("s_group"):
        by_source["s_group"] = fetch_supermarket("s_group", "S-ryhmä Tarjoukset", u_skaupat_fallback, u_skaupat_fallback, "S-market Lauttasaari", "Lauttasaari", "Lauttasaarentie 23, 00200 Helsinki", 60.1594, 24.8832, monitor, now_hel)

    labels = {
        "resq_club": "ResQ Club",
        "myhelsinki_events": "MyHelsinki Linked Events",
        "finnkino_movies": "Finnkino Aikataulu",
        "k_ruoka": "K-Ruoka Tarjoukset",
        "lidl": "Lidl Tarjoukset",
        "s_group": "S-ryhmä Tarjoukset",
    }
    merged: List[Dict[str, Any]] = []
    for skey, sitems in by_source.items():
        if sitems:
            merged.extend(sitems)
        elif monitor.sources.get(skey, {}).get("status") in ("blocked", "error"):
            for old in prev_snap.get("treats", []):
                if old.get("source_name") == labels.get(skey):
                    c = dict(old)
                    c["source_type"] = "cached_fallback"
                    merged.append(c)

    seen, valid = set(), []
    for it in merged:
        if float(it.get("price_eur") or 99) > 7.0:
            continue
        blob = str(it.get("title") or "").lower()
        if any(w in blob for w in EXCLUDE_KEYWORDS):
            continue
        if not is_valid_deep_url(it.get("deal_url") or ""):
            continue
        if str(it.get("valid_until") or "") < today_str:
            continue
        if it.get("id") in seen:
            continue
        seen.add(it["id"])
        valid.append(it)

    diag = monitor.summary()
    out = {
        "generatedAt": now_hel.isoformat(),
        "nextUpdateAt": get_next_update_iso(now_hel),
        "updateSchedule": ["06:00", "19:00"],
        "timezone": "Europe/Helsinki",
        "sourceHealth": {"okSources": diag["ok_sources"], "totalSources": diag["total_sources"], "sources": diag["sources"]},
        "diagnostics": diag,
        "treats": valid,
    }
    if not getattr(args, "dry_run", False):
        SNAPSHOT_PATH.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
        HEALTH_LOG_PATH.write_text(json.dumps(diag, ensure_ascii=False, indent=2), encoding="utf-8")
    else:
        print("DRY RUN: no files written")
    print(f"Done: {len(valid)} verified items ({diag['ok_sources']}/{diag['total_sources']} sources OK)")

if __name__ == "__main__":
    main()
