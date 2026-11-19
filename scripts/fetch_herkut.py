#!/usr/bin/env python3
"""
Self-aware treat, bakery & cheap-cinema deal aggregator for ://rudolfwesterholm.com.
Sources:
  1. ResQ Club v2 Public API (bakery/café surplus offers in Helsinki/Espoo/Vantaa/Lauttasaari)
  2. MyHelsinki Linked Events API (free & <= 7 EUR cinema + coffee/pastry events)
  3. K-Ruoka public campaign offers (Playwright + requests fallback)
  4. Lidl Suomi weekly offers (Playwright + requests fallback)
  5. S-Group public campaign offers (Playwright + requests fallback)
"""

import argparse
import hashlib
import json
import re
import time
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
VENUES_PATH = ROOT_DIR / "data" / "venues_coords.json"
HEALTH_LOG_PATH = ROOT_DIR / "logs" / "scraper_health.json"

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "fi-FI,fi;q=0.9,en;q=0.8",
}

TREAT_KEYWORDS = [
    "irtokark", "makeis", "suklaa", "karkki", "pulla", "leivos",
    "munkki", "croissant", "jäätelö", "keksi", "donitsi", "viineri",
    "kakku", "herkku", "paistopiste", "kahvi", "glögi", "pipari",
    "fazer", "arnolds", "robert's coffee", "espresso house", "gateau",
    "kanniston", "picnic", "bakery", "pastry", "candy",
]

CINEMA_KEYWORDS = ["elokuva", "kino", "leffa", "näytös", "cinema"]


class SourceHealthMonitor:
    """Tracks latency, HTTP status, item counts, and consecutive failures per source."""

    def __init__(self, previous_health: Dict[str, Any]):
        self.prev_sources = previous_health.get("sources", {})
        self.sources: Dict[str, Dict[str, Any]] = {}

    def record(
        self,
        source_key: str,
        status: str,
        items_found: int,
        latency_ms: int,
        http_status: Optional[int] = None,
        error_reason: Optional[str] = None,
    ) -> None:
        prev_streak = self.prev_sources.get(source_key, {}).get("consecutive_failures", 0)
        is_failure = status in ("blocked", "error")
        self.sources[source_key] = {
            "status": status,
            "items_found": items_found,
            "latency_ms": latency_ms,
            "http_status": http_status,
            "error_reason": error_reason,
            "consecutive_failures": (prev_streak + 1) if is_failure else 0,
            "checked_at": datetime.now(TZ_HEL).isoformat(),
        }

    def summary(self) -> Dict[str, Any]:
        total = len(self.sources)
        ok_count = sum(1 for s in self.sources.values() if s["status"] in ("ok", "empty"))
        failing = [
            k for k, v in self.sources.items() if v.get("consecutive_failures", 0) >= 2
        ]
        return {
            "ok_sources": ok_count,
            "total_sources": total,
            "needs_attention": failing,
            "sources": self.sources,
        }


def load_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default


def make_id(source: str, title: str, store: str) -> str:
    digest = hashlib.sha256(f"{source}|{title}|{store}".encode("utf-8")).hexdigest()[:12]
    return f"{source}_{digest}"


def parse_price_eur(text: str) -> Optional[float]:
    if not text:
        return None
    m = re.search(r"(\d+[.,]\d{1,2})\s*€", text)
    if m:
        return float(m.group(1).replace(",", "."))
    m2 = re.search(r"(\d+)\s*€", text)
    if m2:
        return float(m2.group(1))
    return None


def parse_price_kg(text: str) -> Optional[float]:
    if not text:
        return None
    m = re.search(r"(\d+[.,]\d{1,2})\s*€\s*/\s*kg", text, re.IGNORECASE)
    if m:
        return float(m.group(1).replace(",", "."))
    return None


def is_valid_deep_url(url: str) -> bool:
    if not url or not url.startswith("https://"):
        return False
    parsed = urlparse(url)
    return bool(parsed.netloc) and (len(parsed.path.strip("/")) > 0 or bool(parsed.query))


def is_valid_finland_coords(lat: Optional[float], lon: Optional[float]) -> bool:
    if lat is None or lon is None:
        return False
    return 59.5 <= float(lat) <= 70.1 and 19.0 <= float(lon) <= 31.6


def infer_region(city_or_text: str) -> str:
    low = (city_or_text or "").lower()
    if any(k in low for k in ["espoo", "isoomena", "iso omena", "sello", "ainoa"]):
        return "Espoo"
    if any(k in low for k in ["vantaa", "jumbo", "dixi", "myyrmanni"]):
        return "Vantaa"
    return "Helsinki"


def get_next_update_iso(now_hel: datetime) -> str:
    today_06 = now_hel.replace(hour=6, minute=0, second=0, microsecond=0)
    today_19 = now_hel.replace(hour=19, minute=0, second=0, microsecond=0)
    if now_hel < today_06:
        return today_06.isoformat()
    if now_hel < today_19:
        return today_19.isoformat()
    return (today_06 + timedelta(days=1)).isoformat()


def fetch_resq_club(monitor: SourceHealthMonitor, now_hel: datetime) -> List[Dict[str, Any]]:
    t0 = time.monotonic()
    url = "https://resq-club.com"
    params = {"lat": 60.1699, "lon": 24.9384, "radius": 15000}
    items: List[Dict[str, Any]] = []

    try:
        resp = requests.get(url, params=params, headers=HEADERS, timeout=15, verify=certifi.where())
        latency = int((time.monotonic() - t0) * 1000)
        if resp.status_code != 200:
            monitor.record("resq_club", "blocked" if resp.status_code in (403, 429) else "error", 0, latency, resp.status_code, f"HTTP {resp.status_code}")
            return []

        payload = resp.json()
        offers = payload if isinstance(payload, list) else payload.get("offers", payload.get("data", []))
        providers_map = {}
        if isinstance(payload, dict) and isinstance(payload.get("providers"), list):
            for p in payload["providers"]:
                providers_map[p.get("id")] = p

        for offer in offers:
            offer_id = offer.get("id")
            if not offer_id:
                continue
            provider = offer.get("provider") or providers_map.get(offer.get("providerId")) or {}
            venue_name = provider.get("name") or offer.get("providerName") or "ResQ-kumppani"
            offer_name = offer.get("name") or offer.get("title") or "Yllätyskassi"
            combined_text = f"{venue_name} {offer_name} {offer.get('description', '')}".lower()

            if not any(kw in combined_text for kw in TREAT_KEYWORDS):
                continue

            raw_price = offer.get("price") or offer.get("discountedPrice")
            orig_price = offer.get("originalPrice")
            if isinstance(raw_price, dict):
                raw_price = raw_price.get("amount")
            if isinstance(orig_price, dict):
                orig_price = orig_price.get("amount")

            if raw_price is None:
                continue
            price_eur = float(raw_price) / 100.0 if float(raw_price) > 40 else float(raw_price)
            orig_eur = (float(orig_price) / 100.0 if float(orig_price) > 40 else float(orig_price)) if orig_price else None

            if price_eur <= 0 or price_eur > 12.0:
                continue

            coords = provider.get("location") or offer.get("location") or {}
            lat = coords.get("latitude") or coords.get("lat")
            lon = coords.get("longitude") or coords.get("lon") or coords.get("lng")
            if not is_valid_finland_coords(lat, lon):
                continue

            address = provider.get("address") or provider.get("streetAddress") or "Helsinki"
            city = provider.get("city") or address
            pickup_end = offer.get("pickupEnd") or offer.get("expiresAt")
            valid_until = now_hel.strftime("%Y-%m-%d")
            pickup_label = None
            if pickup_end:
                try:
                    dt_end = datetime.fromisoformat(pickup_end.replace("Z", "+00:00")).astimezone(TZ_HEL)
                    if dt_end < now_hel:
                        continue
                    valid_until = dt_end.strftime("%Y-%m-%d")
                    day_prefix = "Tänään" if dt_end.date() == now_hel.date() else f"{dt_end.day}.{dt_end.month}."
                    pickup_label = f"Nouto {day_prefix} klo {dt_end.strftime('%H:%M')} asti"
                except Exception:
                    pass

            price_display = f"{price_eur:.2f}".replace(".", ",") + " €"
            if orig_eur and orig_eur > price_eur:
                price_display += f" (norm. {orig_eur:.2f}".replace(".", ",") + " €)"

            deal_url = f"https://resq-club.com{offer_id}"
            items.append({
                "id": make_id("resq", offer_name, venue_name),
                "title": f"{offer_name} – {venue_name}",
                "store_name": venue_name,
                "mall_name": "Lauttis" if "lauttasaari" in address.lower() or "lauttis" in venue_name.lower() else "",
                "address": address,
                "region": infer_region(f"{city} {address} {venue_name}"),
                "category": "leipomo",
                "price_eur": round(price_eur, 2),
                "price_kg": None,
                "price_display": price_display,
                "valid_from": now_hel.strftime("%Y-%m-%d"),
                "valid_until": valid_until,
                "custom_time_label": pickup_label,
                "lat": float(lat),
                "lon": float(lon),
                "source_type": "live_verified",
                "source_name": "ResQ Club",
                "deal_url": deal_url,
                "store_offers_url": deal_url,
"maps_url": f"google.com{lat},{lon}",
"verified_at": now_hel.isoformat(),
})
monitor.record("resq_club", "ok" if items else "empty", len(items), latency, resp.status_code)
except Exception as exc:
latency = int((time.monotonic() - t0) * 1000)
monitor.record("resq_club", "error", 0, latency, None, str(exc)[:180])
return items
def fetch_myhelsinki_events(monitor: SourceHealthMonitor, now_hel: datetime) -> List[Dict[str, Any]]:
t0 = time.monotonic()
url = "hel.fi"
end_dt = now_hel + timedelta(days=14)
params = {
"start": now_hel.strftime("%Y-%m-%d"),
"end": end_dt.strftime("%Y-%m-%d"),
"include": "location",
"page_size": 100,
"sort": "start_time",
}
items: List[Dict[str, Any]] = []
try:
resp = requests.get(url, params=params, headers=HEADERS, timeout=15, verify=certifi.where())
latency = int((time.monotonic() - t0) * 1000)
if resp.status_code != 200:
monitor.record("myhelsinki_events", "error", 0, latency, resp.status_code, f"HTTP {resp.status_code}")
return []
events = resp.json().get("data", [])
for ev in events:
name_obj = ev.get("name") or {}
title = name_obj.get("fi") or name_obj.get("en") or ""
desc_obj = ev.get("short_description") or ev.get("description") or {}
desc = desc_obj.get("fi") or desc_obj.get("en") or ""
blob = f"{title} {desc}".lower()
is_cinema = any(kw in blob for kw in CINEMA_KEYWORDS)
is_treat = any(kw in blob for kw in ["kahvi", "pulla", "herkku", "suklaa", "jäätelö", "glögi", "pipari", "leivos"])
if not (is_cinema or is_treat):
continue
offers = ev.get("offers") or []
is_free = False
ticket_price: Optional[float] = None
offer_url = ""
for off in offers:
if off.get("is_free") is True:
is_free = True
ticket_price = 0.0
price_txt = (off.get("price") or {}).get("fi") or (off.get("price") or {}).get("en") or ""
parsed = parse_price_eur(price_txt)
if parsed is not None:
ticket_price = parsed
info_u = (off.get("info_url") or {}).get("fi") or (off.get("info_url") or {}).get("en") or ""
if info_u.startswith("https://"):
offer_url = info_u
if not is_free and (ticket_price is None or ticket_price > 7.0):
continue
loc = ev.get("location") or {}
if not isinstance(loc, dict):
continue
pos = (loc.get("position") or {}).get("coordinates") or []
if len(pos) < 2:
continue
lon, lat = float(pos[0]), float(pos[1])
if not is_valid_finland_coords(lat, lon):
continue
venue_name = (loc.get("name") or {}).get("fi") or (loc.get("name") or {}).get("en") or "Helsinki"
address = (loc.get("street_address") or {}).get("fi") or venue_name
ev_info_url = (ev.get("info_url") or {}).get("fi") or (ev.get("info_url") or {}).get("en") or ""
deal_url = offer_url if is_valid_deep_url(offer_url) else (
ev_info_url if is_valid_deep_url(ev_info_url) else f"hel.fi{ev.get('id')}"
)
start_str = ev.get("start_time")
if not start_str:
continue
dt_start = datetime.fromisoformat(start_str.replace("Z", "+00:00")).astimezone(TZ_HEL)
if dt_start.date() < now_hel.date():
continue
price_val = 0.0 if is_free else float(ticket_price or 0.0)
price_display = "Ilmainen (0 €)" if price_val == 0 else f"{price_val:.2f}".replace(".", ",") + " €"
items.append({
"id": make_id("hel", title, venue_name),
"title": title,
"store_name": venue_name,
"mall_name": "Oodi" if "oodi" in venue_name.lower() else "",
"address": address,
"region": infer_region(f"{venue_name} {address}"),
"category": "elokuva" if is_cinema else "leipomo",
"price_eur": price_val,
"price_kg": None,
"price_display": price_display,
"valid_from": dt_start.strftime("%Y-%m-%d"),
"valid_until": dt_start.strftime("%Y-%m-%d"),
"event_time": dt_start.strftime("%H:%M"),
"lat": lat,
"lon": lon,
"source_type": "live_verified",
"source_name": "MyHelsinki Linked Events",
"deal_url": deal_url,
"store_offers_url": deal_url,
"maps_url": f"google.com{lat},{lon}",
"verified_at": now_hel.isoformat(),
})
monitor.record("myhelsinki_events", "ok" if items else "empty", len(items), latency, resp.status_code)
except Exception as exc:
latency = int((time.monotonic() - t0) * 1000)
monitor.record("myhelsinki_events", "error", 0, latency, None, str(exc)[:180])
return items
def render_page_text(url: str) -> tuple[Optional[int], str]:
try:
from playwright.sync_api import sync_playwright  # type: ignore
with sync_playwright() as p:
browser = p.chromium.launch(headless=True)
context = browser.new_context(user_agent=HEADERS["User-Agent"], locale="fi-FI")
page = context.new_page()
resp = page.goto(url, wait_until="domcontentloaded", timeout=25000)
page.wait_for_timeout(2500)
status = resp.status if resp else 200
text = page.inner_text("body")
browser.close()
return status, text
except Exception:
resp = requests.get(url, headers=HEADERS, timeout=15, verify=certifi.where())
return resp.status_code, resp.text
def extract_supermarket_deals_from_text(
text: str,
source_key: str,
source_name: str,
store_name: str,
mall_name: str,
address: str,
lat: float,
lon: float,
campaign_url: str,
now_hel: datetime,
) -> List[Dict[str, Any]]:
deals: List[Dict[str, Any]] = []
lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
days_to_sunday = (6 - now_hel.weekday()) % 7
valid_until = (now_hel + timedelta(days=days_to_sunday)).strftime("%Y-%m-%d")
for idx, line in enumerate(lines):
low = line.lower()
if not any(kw in low for kw in ["irtokark", "suklaa", "makeis", "karkki", "jäätelö", "pulla", "croissant"]):
continue
window = " ".join(lines[max(0, idx - 1) : min(len(lines), idx + 4)])
pkg = parse_price_kg(window)
peur = parse_price_eur(window)
if pkg is None and peur is None:
continue
is_bulk = "irtokark" in low or pkg is not None
price_display = (
f"{pkg:.2f}".replace(".", ",") + " €/kg"
if pkg is not None
else f"{peur:.2f}".replace(".", ",") + " €"
)
deals.append({
"id": make_id(source_key, line[:60], store_name),
"title": line[:90],
"store_name": store_name,
"mall_name": mall_name,
"address": address,
"region": infer_region(f"{store_name} {address}"),
"category": "irtokarkit" if is_bulk else "makeiset",
"price_eur": peur,
"price_kg": pkg,
"price_display": price_display,
"valid_from": now_hel.strftime("%Y-%m-%d"),
"valid_until": valid_until,
"lat": lat,
"lon": lon,
"source_type": "live_verified",
"source_name": source_name,
"deal_url": campaign_url,
"store_offers_url": campaign_url,
"maps_url": f"google.com{lat},{lon}",
"verified_at": now_hel.isoformat(),
})
return deals
def fetch_supermarket_source(
source_key: str,
source_name: str,
url: str,
store_name: str,
mall_name: str,
address: str,
lat: float,
lon: float,
monitor: SourceHealthMonitor,
now_hel: datetime,
) -> List[Dict[str, Any]]:
t0 = time.monotonic()
try:
status, body = render_page_text(url)
latency = int((time.monotonic() - t0) * 1000)
if status and status >= 400:
monitor.record(
source_key,
"blocked" if status in (403, 429) else "error",
0,
latency,
status,
f"HTTP {status}",
)
return []
items = extract_supermarket_deals_from_text(
body, source_key, source_name, store_name, mall_name, address, lat, lon, url, now_hel
)
monitor.record(source_key, "ok" if items else "empty", len(items), latency, status)
return items
except Exception as exc:
latency = int((time.monotonic() - t0) * 1000)
monitor.record(source_key, "error", 0, latency, None, str(exc)[:180])
return []
def validate_and_dedupe(items: List[Dict[str, Any]], today_str: str) -> List[Dict[str, Any]]:
seen = set()
clean: List[Dict[str, Any]] = []
for item in items:
valid_until = item.get("valid_until", "")
if not valid_until or valid_until < today_str:
continue
if not is_valid_deep_url(item.get("deal_url", "")):
continue
if not is_valid_finland_coords(item.get("lat"), item.get("lon")):
continue
p_eur = item.get("price_eur")
p_kg = item.get("price_kg")
if (p_eur is None or p_eur < 0) and (p_kg is None or p_kg <= 0):
continue
dedupe_key = (item.get("title", "").strip().lower(), item.get("store_name", "").strip().lower())
if dedupe_key in seen:
continue
seen.add(dedupe_key)
clean.append(item)
return clean
def run_self_check() -> int:
snapshot = load_json(SNAPSHOT_PATH, {})
treats = snapshot.get("treats", [])
diag = snapshot.get("diagnostics", {})
print(f"[SELF-CHECK] Treats in snapshot: {len(treats)}")
print(f"[SELF-CHECK] Sources OK: {diag.get('ok_sources', 0)}/{diag.get('total_sources', 0)}")
failing = diag.get("needs_attention", [])
if failing:
print(f"[SELF-CHECK] Sources with >=2 consecutive failures: {', '.join(failing)}")
if diag.get("total_sources", 0) > 0 and diag.get("ok_sources", 0) == 0:
print("[SELF-CHECK] CRITICAL: 0 sources healthy.")
return 1
return 0
def main() -> None:
parser = argparse.ArgumentParser()
parser.add_argument("--self-check", action="store_true", help="Validate generated snapshot health")
args = parser.parse_args()
if args.self_check:
raise SystemExit(run_self_check())
now_hel = datetime.now(TZ_HEL)
today_str = now_hel.strftime("%Y-%m-%d")
prev_snapshot = load_json(SNAPSHOT_PATH, {"treats": []})
prev_health = load_json(HEALTH_LOG_PATH, {})
monitor = SourceHealthMonitor(prev_health)
source_results: Dict[str, List[Dict[str, Any]]] = {
"resq_club": fetch_resq_club(monitor, now_hel),
"myhelsinki_events": fetch_myhelsinki_events(monitor, now_hel),
"k_ruoka": fetch_supermarket_source(
"k_ruoka",
"K-Ruoka Tarjoukset",
"k-ruoka.fi",
"K-Supermarket Lauttasaari (Lauttis)",
"Lauttis",
"Lauttasaarentie 28, 00200 Helsinki",
60.1589,
24.8825,
monitor,
now_hel,
),
"lidl": fetch_supermarket_source(
"lidl",
"Lidl Tarjoukset",
"lidl.fi",
"Lidl Lauttasaari",
"Lauttasaari",
"Heikkiläntie 2, 00210 Helsinki",
60.1572,
24.8861,
monitor,
now_hel,
),
"s_group": fetch_supermarket_source(
"s_group",
"S-ryhmä Tarjoukset",
"s-kaupat.fi",
"S-Market Lauttasaari",
"Lauttasaari",
"Lauttasaarentie 16, 00200 Helsinki",
60.1595,
24.8850,
monitor,
now_hel,
),
}
combined: List[Dict[str, Any]] = []
prev_treats = prev_snapshot.get("treats", [])
source_name_map = {
"resq_club": "ResQ Club",
"myhelsinki_events": "MyHelsinki Linked Events",
"k_ruoka": "K-Ruoka Tarjoukset",
"lidl": "Lidl Tarjoukset",
"s_group": "S-ryhmä Tarjoukset",
}
for src_key, fresh_items in source_results.items():
src_status = monitor.sources.get(src_key, {}).get("status")
if fresh_items:
combined.extend(fresh_items)
elif src_status in ("blocked", "error"):
expected_name = source_name_map[src_key]
for old in prev_treats:
if old.get("source_name") == expected_name and old.get("valid_until", "") >= today_str:
retained = dict(old)
retained["source_type"] = "cached_valid"
combined.append(retained)
validated_treats = validate_and_dedupe(combined, today_str)
diag_summary = monitor.summary()
snapshot_out = {
"generatedAt": now_hel.isoformat(),
"nextUpdateAt": get_next_update_iso(now_hel),
"timezone": "Europe/Helsinki",
"totalCount": len(validated_treats),
"diagnostics": diag_summary,
"treats": validated_treats,
}
SNAPSHOT_PATH.parent.mkdir(parents=True, exist_ok=True)
HEALTH_LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
SNAPSHOT_PATH.write_text(json.dumps(snapshot_out, ensure_ascii=False, indent=2), encoding="utf-8")
HEALTH_LOG_PATH.write_text(json.dumps(diag_summary, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"Saved {len(validated_treats)} verified deals. Health: {diag_summary['ok_sources']}/{diag_summary['total_sources']} OK.")
if name == "main":
main()