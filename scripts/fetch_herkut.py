#!/usr/bin/env python3
import argparse, hashlib, json, re, time
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse
from zoneinfo import ZoneInfo
import certifi, requests

TZ_HEL = ZoneInfo("Europe/Helsinki")
ROOT_DIR = Path(__file__).resolve().parent.parent
SNAPSHOT_PATH = ROOT_DIR / "herkku" / "herkku_snapshot.json"
HEALTH_LOG_PATH = ROOT_DIR / "logs" / "scraper_health.json"
HEADERS = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36", "Accept-Language": "fi-FI,fi;q=0.9,en;q=0.8"}
TREAT_KEYWORDS = ["irtokark", "makeis", "suklaa", "karkki", "pulla", "leivos", "munkki", "croissant", "jäätelö", "keksi", "donitsi", "viineri", "kakku", "herkku", "paistopiste", "kahvi", "glögi", "pipari", "fazer", "arnolds", "robert's coffee", "espresso house", "gateau", "kanniston", "picnic", "bakery", "pastry", "candy"]
CINEMA_KEYWORDS = ["elokuva", "kino", "leffa", "näytös", "cinema"]

class SourceHealthMonitor:
    def __init__(self, previous_health: Dict[str, Any]):
        self.prev_sources = previous_health.get("sources", {})
        self.sources: Dict[str, Dict[str, Any]] = {}
    def record(self, source_key: str, status: str, items_found: int, latency_ms: int, http_status: Optional[int] = None, error_reason: Optional[str] = None) -> None:
        prev_streak = self.prev_sources.get(source_key, {}).get("consecutive_failures", 0)
        self.sources[source_key] = {"status": status, "items_found": items_found, "latency_ms": latency_ms, "http_status": http_status, "error_reason": error_reason, "consecutive_failures": (prev_streak + 1) if status in ("blocked", "error") else 0, "checked_at": datetime.now(TZ_HEL).isoformat()}
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

def parse_price_eur(text: str) -> Optional[float]:
    if not text: return None
    m = re.search(r"(\d+[.,]\d{1,2})\s*€", text)
    if m: return float(m.group(1).replace(",", "."))
    m2 = re.search(r"(\d+)\s*€", text)
    return float(m2.group(1)) if m2 else None

def parse_price_kg(text: str) -> Optional[float]:
    if not text: return None
    m = re.search(r"(\d+[.,]\d{1,2})\s*€\s*/\s*kg", text, re.IGNORECASE)
    return float(m.group(1).replace(",", ".")) if m else None

def is_valid_deep_url(url: str) -> bool:
    if not url or not url.startswith("https://"): return False
    p = urlparse(url)
    return bool(p.netloc) and (len(p.path.strip("/")) > 0 or bool(p.query))

def is_valid_finland_coords(lat: Optional[float], lon: Optional[float]) -> bool:
    return lat is not None and lon is not None and 59.5 <= float(lat) <= 70.1 and 19.0 <= float(lon) <= 31.6

def infer_region(text: str) -> str:
    low = (text or "").lower()
    if any(k in low for k in ["espoo", "isoomena", "iso omena", "sello", "ainoa"]): return "Espoo"
    if any(k in low for k in ["vantaa", "jumbo", "dixi", "myyrmanni"]): return "Vantaa"
    return "Helsinki"

def get_next_update_iso(now_hel: datetime) -> str:
    t06 = now_hel.replace(hour=6, minute=0, second=0, microsecond=0)
    t19 = now_hel.replace(hour=19, minute=0, second=0, microsecond=0)
    if now_hel < t06: return t06.isoformat()
    if now_hel < t19: return t19.isoformat()
    return (t06 + timedelta(days=1)).isoformat()

def fetch_resq_club(monitor: SourceHealthMonitor, now_hel: datetime) -> List[Dict[str, Any]]:
    t0 = time.monotonic()
    url = "https://resq-club.com" + "/v2/offers"
    items: List[Dict[str, Any]] = []
    try:
        resp = requests.get(url, params={"neLat": 60.35, "neLng": 25.25, "swLat": 60.10, "swLng": 24.60}, headers=HEADERS, timeout=15, verify=certifi.where())
        latency = int((time.monotonic() - t0) * 1000)
        if resp.status_code != 200:
            monitor.record("resq_club", "blocked" if resp.status_code in (403, 429) else "error", 0, latency, resp.status_code, f"HTTP {resp.status_code}")
            return []
        payload = resp.json()
        offers = payload if isinstance(payload, list) else payload.get("offers", payload.get("data", []))
        providers_map = {p.get("id"): p for p in payload.get("providers", [])} if isinstance(payload, dict) else {}
        for offer in offers:
            oid = offer.get("id")
            if not oid: continue
            prov = offer.get("provider") or providers_map.get(offer.get("providerId")) or {}
            vname = prov.get("name") or offer.get("providerName") or "ResQ-kumppani"
            oname = offer.get("name") or offer.get("title") or "Yllätyskassi"
            if not any(kw in f"{vname} {oname} {offer.get('description', '')}".lower() for kw in TREAT_KEYWORDS): continue
            raw_p = offer.get("price") or offer.get("discountedPrice")
            orig_p = offer.get("originalPrice")
            if isinstance(raw_p, dict): raw_p = raw_p.get("amount")
            if isinstance(orig_p, dict): orig_p = orig_p.get("amount")
            if raw_p is None: continue
            p_eur = float(raw_p) / 100.0 if float(raw_p) > 40 else float(raw_p)
            o_eur = (float(orig_p) / 100.0 if float(orig_p) > 40 else float(orig_p)) if orig_p else None
            if p_eur <= 0 or p_eur > 12.0: continue
            coords = prov.get("location") or offer.get("location") or {}
            lat, lon = coords.get("latitude") or coords.get("lat"), coords.get("longitude") or coords.get("lon") or coords.get("lng")
            if not is_valid_finland_coords(lat, lon): continue
            addr = prov.get("address") or prov.get("streetAddress") or "Helsinki"
            city = prov.get("city") or addr
            pend = offer.get("pickupEnd") or offer.get("expiresAt")
            v_until, plabel = now_hel.strftime("%Y-%m-%d"), None
            if pend:
                try:
                    dt_end = datetime.fromisoformat(pend.replace("Z", "+00:00")).astimezone(TZ_HEL)
                    if dt_end < now_hel: continue
                    v_until = dt_end.strftime("%Y-%m-%d")
                    dp = "Tänään" if dt_end.date() == now_hel.date() else f"{dt_end.day}.{dt_end.month}."
                    plabel = f"Nouto {dp} klo {dt_end.strftime('%H:%M')} asti"
                except Exception: pass
            pdisp = f"{p_eur:.2f}".replace(".", ",") + " €" + (f" (norm. {o_eur:.2f}".replace(".", ",") + " €)" if o_eur and o_eur > p_eur else "")
            durl = f"https://resq-club.com{oid}"
            items.append({"id": make_id("resq", oname, vname), "title": f"{oname} – {vname}", "store_name": vname, "mall_name": "Lauttis" if "lauttasaari" in addr.lower() or "lauttis" in vname.lower() else "", "address": addr, "region": infer_region(f"{city} {addr} {vname}"), "category": "leipomo", "price_eur": round(p_eur, 2), "price_kg": None, "price_display": pdisp, "valid_from": now_hel.strftime("%Y-%m-%d"), "valid_until": v_until, "custom_time_label": plabel, "lat": float(lat), "lon": float(lon), "source_type": "live_verified", "source_name": "ResQ Club", "deal_url": durl, "store_offers_url": durl, "maps_url": f"https://google.com{lat},{lon}", "verified_at": now_hel.isoformat()})
        monitor.record("resq_club", "ok" if items else "empty", len(items), latency, resp.status_code)
    except Exception as exc:
        monitor.record("resq_club", "error", 0, int((time.monotonic() - t0) * 1000), None, str(exc)[:180])
    return items

def fetch_myhelsinki_events(monitor: SourceHealthMonitor, now_hel: datetime) -> List[Dict[str, Any]]:
    t0 = time.monotonic()
    url = "https://hel.fi/linkedevents/v1/event/"
    items: List[Dict[str, Any]] = []
    try:
        resp = requests.get(url, params={"start": now_hel.strftime("%Y-%m-%d"), "end": (now_hel + timedelta(days=14)).strftime("%Y-%m-%d"), "include": "location", "page_size": 100, "sort": "start_time"}, headers=HEADERS, timeout=15, verify=certifi.where())
        latency = int((time.monotonic() - t0) * 1000)
        if resp.status_code != 200:
            monitor.record("myhelsinki_events", "error", 0, latency, resp.status_code, f"HTTP {resp.status_code}")
            return []
        for ev in resp.json().get("data", []):
            title = (ev.get("name") or {}).get("fi") or (ev.get("name") or {}).get("en") or ""
            desc = (ev.get("short_description") or {}).get("fi") or ""
            blob = f"{title} {desc}".lower()
            is_cin = any(kw in blob for kw in CINEMA_KEYWORDS)
            is_trt = any(kw in blob for kw in ["kahvi", "pulla", "herkku", "suklaa", "jäätelö", "glögi", "pipari", "leivos"])
            if not (is_cin or is_trt): continue
            is_free, t_price, off_url = False, None, ""
            for off in ev.get("offers") or []:
                if off.get("is_free") is True: is_free, t_price = True, 0.0
                parsed = parse_price_eur((off.get("price") or {}).get("fi") or "")
                if parsed is not None: t_price = parsed
                iu = (off.get("info_url") or {}).get("fi") or ""
                if iu.startswith("https://"): off_url = iu
            if not is_free and (t_price is None or t_price > 7.0): continue
            loc = ev.get("location") or {}
            pos = (loc.get("position") or {}).get("coordinates") or []
            if len(pos) < 2: continue
            lon, lat = float(pos), float(pos)
            if not is_valid_finland_coords(lat, lon): continue
            vname = (loc.get("name") or {}).get("fi") or "Helsinki"
            addr = (loc.get("street_address") or {}).get("fi") or vname
            ev_url = (ev.get("info_url") or {}).get("fi") or ""
            durl = off_url if is_valid_deep_url(off_url) else (ev_url if is_valid_deep_url(ev_url) else f"https://hel.fi{ev.get('id')}")
            s_str = ev.get("start_time")
            if not s_str: continue
            dt_s = datetime.fromisoformat(s_str.replace("Z", "+00:00")).astimezone(TZ_HEL)
            if dt_s.date() < now_hel.date(): continue
            pval = 0.0 if is_free else float(t_price or 0.0)
            items.append({"id": make_id("hel", title, vname), "title": title, "store_name": vname, "mall_name": "Oodi" if "oodi" in vname.lower() else "", "address": addr, "region": infer_region(f"{vname} {addr}"), "category": "elokuva" if is_cin else "leipomo", "price_eur": pval, "price_kg": None, "price_display": "Ilmainen (0 €)" if pval == 0 else f"{pval:.2f}".replace(".", ",") + " €", "valid_from": dt_s.strftime("%Y-%m-%d"), "valid_until": dt_s.strftime("%Y-%m-%d"), "event_time": dt_s.strftime("%H:%M"), "lat": lat, "lon": lon, "source_type": "live_verified", "source_name": "MyHelsinki Linked Events", "deal_url": durl, "store_offers_url": durl, "maps_url": f"https://google.com{lat},{lon}", "verified_at": now_hel.isoformat()})
        monitor.record("myhelsinki_events", "ok" if items else "empty", len(items), latency, resp.status_code)
    except Exception as exc:
        monitor.record("myhelsinki_events", "error", 0, int((time.monotonic() - t0) * 1000), None, str(exc)[:180])
    return items

def render_page_text(url: str) -> tuple[Optional[int], str]:
    try:
        from playwright.sync_api import sync_playwright
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

def fetch_supermarket_source(source_key: str, source_name: str, url: str, store_name: str, mall_name: str, address: str, lat: float, lon: float, monitor: SourceHealthMonitor, now_hel: datetime) -> List[Dict[str, Any]]:
    t0 = time.monotonic()
    try:
        status, body = render_page_text(url)
        latency = int((time.monotonic() - t0) * 1000)
        if status and status >= 400:
            monitor.record(source_key, "blocked" if status in (403, 429) else "error", 0, latency, status, f"HTTP {status}")
            return []
        deals: List[Dict[str, Any]] = []
        lines = [ln.strip() for ln in body.splitlines() if ln.strip()]
        valid_until = (now_hel + timedelta(days=(6 - now_hel.weekday()) % 7)).strftime("%Y-%m-%d")
        for idx, line in enumerate(lines):
            low = line.lower()
            if not any(kw in low for kw in ["irtokark", "suklaa", "makeis", "karkki", "jäätelö", "pulla", "croissant"]): continue
            win = " ".join(lines[max(0, idx - 1):min(len(lines), idx + 4)])
            pkg, peur = parse_price_kg(win), parse_price_eur(win)
            if pkg is None and peur is None: continue
            is_bulk = "irtokark" in low or pkg is not None
            deals.append({"id": make_id(source_key, line[:60], store_name), "title": line[:90], "store_name": store_name, "mall_name": mall_name, "address": address, "region": infer_region(f"{store_name} {address}"), "category": "irtokarkit" if is_bulk else "makeiset", "price_eur": peur, "price_kg": pkg, "price_display": f"{pkg:.2f}".replace(".", ",") + " €/kg" if pkg is not None else f"{peur:.2f}".replace(".", ",") + " €", "valid_from": now_hel.strftime("%Y-%m-%d"), "valid_until": valid_until, "lat": lat, "lon": lon, "source_type": "live_verified", "source_name": source_name, "deal_url": url, "store_offers_url": url, "maps_url": f"https://google.com{lat},{lon}", "verified_at": now_hel.isoformat()})
        monitor.record(source_key, "ok" if deals else "empty", len(deals), latency, status)
        return deals
    except Exception as exc:
        monitor.record(source_key, "error", 0, int((time.monotonic() - t0) * 1000), None, str(exc)[:180])
        return []

def validate_and_dedupe(items: List[Dict[str, Any]], today_str: str) -> List[Dict[str, Any]]:
    seen, clean = set(), []
    for item in items:
        if item.get("valid_until", "") < today_str: continue
        if not is_valid_deep_url(item.get("deal_url", "")): continue
        if not is_valid_finland_coords(item.get("lat"), item.get("lon")): continue
        p_eur, p_kg = item.get("price_eur"), item.get("price_kg")
        if (p_eur is None or p_eur < 0) and (p_kg is None or p_kg <= 0): continue
        key = (item.get("title", "").strip().lower(), item.get("store_name", "").strip().lower())
        if key not in seen:
            seen.add(key)
            clean.append(item)
    return clean

def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--self-check", action="store_true")
    args = parser.parse_args()
    if args.self_check:
        snap = load_json(SNAPSHOT_PATH, {})
        diag = snap.get("diagnostics", {})
        print(f"[SELF-CHECK] Treats: {len(snap.get('treats', []))}, OK: {diag.get('ok_sources', 0)}/{diag.get('total_sources', 0)}")
        raise SystemExit(1 if diag.get("total_sources", 0) > 0 and diag.get("ok_sources", 0) == 0 else 0)
    now_hel = datetime.now(TZ_HEL)
    today_str = now_hel.strftime("%Y-%m-%d")
    prev_snap = load_json(SNAPSHOT_PATH, {"treats": []})
    monitor = SourceHealthMonitor(load_json(HEALTH_LOG_PATH, {}))
    results = {
        "resq_club": fetch_resq_club(monitor, now_hel),
        "myhelsinki_events": fetch_myhelsinki_events(monitor, now_hel),
        "k_ruoka": fetch_supermarket_source("k_ruoka", "K-Ruoka Tarjoukset", "https://www.k-ruoka.fi" + "/artikkelit/k-supermarket/k-supermarket-tarjoukset", "K-Supermarket Lauttasaari (Lauttis)", "Lauttis", "Lauttasaarentie 28, 00200 Helsinki", 60.1589, 24.8825, monitor, now_hel),
        "lidl": fetch_supermarket_source("lidl", "Lidl Tarjoukset", "https://www.lidl.fi" + "/h/ruoka-ja-juoma/h10068374", "Lidl Lauttasaari", "Lauttasaari", "Heikkiläntie 2, 00210 Helsinki", 60.1572, 24.8861, monitor, now_hel),
        "s_group": fetch_supermarket_source("s_group", "S-ryhmä Tarjoukset", "https://www.s-kaupat.fi" + "/tarjoukset", "S-Market Lauttasaari", "Lauttasaari", "Lauttasaarentie 16, 00200 Helsinki", 60.1595, 24.8850, monitor, now_hel),
    }
    combined: List[Dict[str, Any]] = []
    name_map = {"resq_club": "ResQ Club", "myhelsinki_events": "MyHelsinki Linked Events", "k_ruoka": "K-Ruoka Tarjoukset", "lidl": "Lidl Tarjoukset", "s_group": "S-ryhmä Tarjoukset"}
    for k, fresh in results.items():
        if fresh: combined.extend(fresh)
        elif monitor.sources.get(k, {}).get("status") in ("blocked", "error"):
            for old in prev_snap.get("treats", []):
                if old.get("source_name") == name_map[k] and old.get("valid_until", "") >= today_str:
                    old_copy = dict(old)
                    old_copy["source_type"] = "cached_valid"
                    combined.append(old_copy)
    validated = validate_and_dedupe(combined, today_str)
    diag = monitor.summary()
    out = {"generatedAt": now_hel.isoformat(), "nextUpdateAt": get_next_update_iso(now_hel), "timezone": "Europe/Helsinki", "totalCount": len(validated), "diagnostics": diag, "treats": validated}
    SNAPSHOT_PATH.parent.mkdir(parents=True, exist_ok=True)
    HEALTH_LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    SNAPSHOT_PATH.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    HEALTH_LOG_PATH.write_text(json.dumps(diag, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Saved {len(validated)} verified deals. Health: {diag['ok_sources']}/{diag['total_sources']} OK.")

if __name__ == "__main__":
    main()
