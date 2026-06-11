# Lokki Event Scraper
# Collects free events from Helsinki, Espoo, Vantaa

import requests
from bs4 import BeautifulSoup
import json
from datetime import datetime
import re
from urllib.parse import urljoin
import logging
from typing import List, Dict, Tuple, Optional

from services.events.eventNormalizer import normalizeEvent

try:
    from dateutil import parser as dateutil_parser
    DATEUTIL_AVAILABLE = True
except ImportError:
    DATEUTIL_AVAILABLE = False
    dateutil_parser = None

logging.basicConfig(level=logging.INFO, format='%(levelname)s: %(message)s')
logger = logging.getLogger(__name__)

HEADERS = {
    "User-Agent": "Mozilla/5.0"
}

# ---------------------------
# URL VALIDATION
# ---------------------------

def verify_url(url: str) -> bool:
    if not url:
        return False
    try:
        r = requests.head(url, headers=HEADERS, timeout=5, allow_redirects=True)
        if r.status_code == 200:
            return True
        if r.status_code == 405:
            r = requests.get(url, headers=HEADERS, timeout=5)
            return r.status_code == 200
        return r.status_code == 200
    except Exception:
        return False


# ---------------------------
# DATE NORMALIZATION
# ---------------------------

def normalize_to_iso8601(date_str: str) -> Optional[str]:
    if not date_str:
        return None

    date_str = date_str.strip()

    try:
        if DATEUTIL_AVAILABLE:
            return dateutil_parser.parse(date_str, dayfirst=True).isoformat()
    except Exception:
        pass

    try:
        if "T" in date_str:
            return datetime.fromisoformat(date_str).isoformat()
    except Exception:
        pass

    return None


def is_future_event(iso_date: str) -> bool:
    if not iso_date:
        return False
    try:
        return datetime.fromisoformat(iso_date) >= datetime.now()
    except Exception:
        return False


# ---------------------------
# HELPERS
# ---------------------------

def create_dedup_key(event: Dict) -> Tuple[str, str, str]:
    return (
        event.get("title", "").lower().strip(),
        event.get("source", ""),
        event.get("date", "")
    )


def build_event(title, description, location, date, source, url, image=""):
    raw = {
        "title": title,
        "description": description,
        "location": location,
        "date": date,
        "source": source,
        "image": image,
    }

    return normalizeEvent(raw)


# ---------------------------
# MYHELSINKI
# ---------------------------

def parse_myhelsinki() -> List[Dict]:
    url = "https://www.myhelsinki.fi/en/search?what=events"
    events = []

    try:
        r = requests.get(url, headers=HEADERS, timeout=10)
        soup = BeautifulSoup(r.content, "html.parser")

        items = soup.find_all("article") or soup.find_all("div")

        for item in items[:100]:
            title = item.get_text(strip=True)[:120]

            link = item.find("a", href=True)
            event_url = urljoin(url, link["href"]) if link else None
            if not verify_url(event_url):
                continue

            date_raw = item.get_text()
            date = normalize_to_iso8601(date_raw)
            if not is_future_event(date):
                continue

            events.append(build_event(
                title=title,
                description="",
                location="Helsinki",
                date=date,
                source="MyHelsinki",
                url=event_url
            ))

    except Exception as e:
        logger.error(f"MyHelsinki error: {e}")

    return events


# ---------------------------
# HELSINKI
# ---------------------------

def parse_helsinki_events() -> List[Dict]:
    url = "https://tapahtumat.hel.fi/"
    events = []

    try:
        r = requests.get(url, headers=HEADERS, timeout=10)
        soup = BeautifulSoup(r.content, "html.parser")

        items = soup.find_all("article") or soup.find_all("div")

        for item in items[:100]:
            title = item.get_text(strip=True)[:120]

            link = item.find("a", href=True)
            event_url = urljoin(url, link["href"]) if link else None
            if not verify_url(event_url):
                continue

            date_raw = item.get_text()
            date = normalize_to_iso8601(date_raw)
            if not is_future_event(date):
                continue

            events.append(build_event(
                title, "", "Helsinki", date, "Helsinki Events", event_url
            ))

    except Exception as e:
        logger.error(f"Helsinki error: {e}")

    return events


# ---------------------------
# ESPOO
# ---------------------------

def parse_espoo_events() -> List[Dict]:
    url = "https://www.espoo.fi/en/events"
    events = []

    try:
        r = requests.get(url, headers=HEADERS, timeout=10)
        soup = BeautifulSoup(r.content, "html.parser")

        items = soup.find_all("div") or []

        for item in items[:100]:
            title = item.get_text(strip=True)[:120]

            link = item.find("a", href=True)
            event_url = urljoin(url, link["href"]) if link else None
            if not verify_url(event_url):
                continue

            date = normalize_to_iso8601(item.get_text())
            if not is_future_event(date):
                continue

            events.append(build_event(
                title, "", "Espoo", date, "Espoo Events", event_url
            ))

    except Exception as e:
        logger.error(f"Espoo error: {e}")

    return events


# ---------------------------
# VANTAA
# ---------------------------

def parse_vantaa_events() -> List[Dict]:
    url = "https://www.vantaa.fi/en/culture-and-leisure/events"
    events = []

    try:
        r = requests.get(url, headers=HEADERS, timeout=10)
        soup = BeautifulSoup(r.content, "html.parser")

        items = soup.find_all("div") or []

        for item in items[:100]:
            title = item.get_text(strip=True)[:120]

            link = item.find("a", href=True)
            event_url = urljoin(url, link["href"]) if link else None
            if not verify_url(event_url):
                continue

            date = normalize_to_iso8601(item.get_text())
            if not is_future_event(date):
                continue

            events.append(build_event(
                title, "", "Vantaa", date, "Vantaa Events", event_url
            ))

    except Exception as e:
        logger.error(f"Vantaa error: {e}")

    return events


# ---------------------------
# DEDUP + PIPELINE
# ---------------------------

def deduplicate(events: List[Dict]) -> List[Dict]:
    seen = set()
    out = []

    for e in events:
        k = create_dedup_key(e)
        if k not in seen:
            seen.add(k)
            out.append(e)

    return out


# ---------------------------
# MAIN
# ---------------------------

def fetch_events() -> List[Dict]:
    all_events = []

    logger.info("LOKKI SCRAPER START")

    all_events += parse_myhelsinki()
    all_events += parse_helsinki_events()
    all_events += parse_espoo_events()
    all_events += parse_vantaa_events()

    logger.info(f"Before dedup: {len(all_events)}")

    all_events = deduplicate(all_events)
    all_events = [e for e in all_events if is_future_event(e.get("date"))]

    all_events.sort(key=lambda x: x.get("date", ""))

    with open("lokki/events.json", "w", encoding="utf-8") as f:
        json.dump(all_events, f, ensure_ascii=False, indent=2)

    logger.info(f"Saved {len(all_events)} events")

    return all_events


if __name__ == "__main__":
    fetch_events()
