# Lokki Event Scraper
# This script collects free events happening in Helsinki, Espoo, and Vantaa.

import requests
from bs4 import BeautifulSoup
import json
from datetime import datetime, timedelta
import re
from urllib.parse import urljoin
import logging
from typing import List, Dict, Optional, Tuple

try:
    from dateutil import parser as dateutil_parser
    DATEUTIL_AVAILABLE = True
except ImportError:
    DATEUTIL_AVAILABLE = False
    dateutil_parser = None

logging.basicConfig(level=logging.INFO, format='%(levelname)s: %(message)s')
logger = logging.getLogger(__name__)

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
}

PLAYWRIGHT_AVAILABLE = False
try:
    from playwright.sync_api import sync_playwright
    PLAYWRIGHT_AVAILABLE = True
except ImportError:
    logger.warning("Playwright not installed. Install with: pip install playwright")

def verify_url(url: str) -> bool:
    """Verify URL is accessible via HEAD or GET request"""
    if not url or not isinstance(url, str):
        return False
    
    try:
        # Try HEAD first (faster)
        response = requests.head(url, headers=HEADERS, timeout=5, allow_redirects=True)
        if response.status_code == 200:
            return True
        if response.status_code == 405:  # Method not allowed, try GET
            response = requests.get(url, headers=HEADERS, timeout=5, allow_redirects=True)
            return response.status_code == 200
        return response.status_code == 200
    except Exception as e:
        logger.debug(f"URL verification failed for {url}: {e}")
        return False

def normalize_to_iso8601(date_str: str) -> Optional[str]:
    """Normalize datetime string to ISO 8601 format, skip if unable to parse"""
    if not date_str:
        return None
    
    date_str = date_str.strip()
    
    # Finnish common patterns
    finnish_patterns = [
        (r'(\d{1,2})\.(\d{1,2})\.(\d{4})\s+(\d{1,2}):(\d{2})', '%d.%m.%Y %H:%M'),
        (r'(\d{1,2})\.(\d{1,2})\.(\d{4})', '%d.%m.%Y'),
        (r'(\d{1,2})\s+(tammikuu|helmikuu|maaliskuu|huhtikuu|toukokuu|kesäkuu|heinäkuu|elokuuta|syyskuu|lokakuu|marraskuu|joulukuu|1|2|3|4|5|6|7|8|9|10|11|12)\s+(\d{4})', None),
    ]
    
    for pattern, fmt in finnish_patterns:
        if fmt and re.search(pattern, date_str):
            try:
                dt = datetime.strptime(date_str, fmt)
                return dt.isoformat()
            except ValueError:
                continue
    
    # Try dateutil if available
    if DATEUTIL_AVAILABLE:
        try:
            dt = dateutil_parser.parse(date_str, dayfirst=True)
            return dt.isoformat()
        except (ValueError, TypeError):
            pass
    
    # Generic ISO/standard formats
    try:
        if 'T' in date_str:
            dt = datetime.fromisoformat(date_str)
            return dt.isoformat()
    except ValueError:
        pass
    
    logger.debug(f"Could not parse datetime: {date_str}")
    return None

def is_future_event(iso_datetime: str) -> bool:
    """Check if event is in the future"""
    if not iso_datetime:
        return False
    
    try:
        event_dt = datetime.fromisoformat(iso_datetime)
        return event_dt >= datetime.now()
    except (ValueError, TypeError):
        return False

def create_dedup_key(event: Dict) -> Tuple[str, str, str]:
    """Create deduplication key from event"""
    title = event.get('title', '').lower().strip()
    url = event.get('url', '')
    date = event.get('date', '')
    return (title, url, date)

def parse_myhelsinki_requests(url: str = "https://www.myhelsinki.fi/en/search?what=events") -> List[Dict]:
    """Parse events from MyHelsinki using requests"""
    events = []
    
    try:
        logger.info(f"Fetching MyHelsinki (requests) from: {url}")
        response = requests.get(url, headers=HEADERS, timeout=10)
        response.raise_for_status()
        
        soup = BeautifulSoup(response.content, 'html.parser')
        
        event_items = soup.find_all('div', class_=re.compile(r'search-result|event|card|item', re.I))
        if not event_items:
            event_items = soup.find_all('article')
        if not event_items:
            event_items = soup.find_all('a', href=re.compile(r'event|activity', re.I))
        
        logger.info(f"Found {len(event_items)} potential event items")
        
        for item in event_items[:100]:
            try:
                title_elem = item.find('h2') or item.find('h3') or item.find('h4') or item.find('a')
                title = title_elem.get_text(strip=True) if title_elem else None
                
                if not title or len(title) < 3:
                    continue
                
                link_elem = item.find('a', href=True)
                event_url = urljoin(url, link_elem['href']) if link_elem else None
                
                if not event_url or not verify_url(event_url):
                    continue
                
                date_elem = item.find('span', class_=re.compile(r'date|time', re.I))
                if not date_elem:
                    date_elem = item.find('p', class_=re.compile(r'date|time', re.I))
                event_date_raw = date_elem.get_text(strip=True) if date_elem else None
                event_date = normalize_to_iso8601(event_date_raw)
                
                if not event_date or not is_future_event(event_date):
                    continue
                
                events.append({
                    "source": "MyHelsinki",
                    "title": title,
                    "url": event_url,
                    "date": event_date,
                    "city": "Helsinki",
                    "scraped_at": datetime.now().isoformat()
                })
                logger.debug(f"  ✓ {title[:40]}... ({event_date})")
                
            except Exception as e:
                logger.debug(f"  Error parsing item: {e}")
                continue
        
        logger.info(f"Parsed {len(events)} valid events from MyHelsinki (requests)")
        
    except requests.exceptions.RequestException as e:
        logger.error(f"Error fetching MyHelsinki (requests): {e}")
    except Exception as e:
        logger.error(f"Error parsing MyHelsinki (requests): {e}")
    
    return events

def parse_myhelsinki_playwright() -> List[Dict]:
    """Parse events from MyHelsinki using Playwright (JavaScript rendering)"""
    events = []
    
    if not PLAYWRIGHT_AVAILABLE:
        logger.warning("Playwright not available, skipping dynamic rendering")
        return events
    
    try:
        url = "https://www.myhelsinki.fi/en/search?what=events"
        logger.info(f"Fetching MyHelsinki (Playwright) from: {url}")
        
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            page = browser.new_page()
            page.goto(url, wait_until='networkidle', timeout=30000)
            page.wait_for_timeout(3000)
            
            content = page.content()
            soup = BeautifulSoup(content, 'html.parser')
            
            event_items = soup.find_all('div', class_=re.compile(r'event|card|result|search', re.I))
            logger.info(f"Found {len(event_items)} event items via Playwright")
            
            for item in event_items[:100]:
                try:
                    title_elem = item.find('h2') or item.find('h3') or item.find('a')
                    title = title_elem.get_text(strip=True) if title_elem else None
                    
                    if not title or len(title) < 3:
                        continue
                    
                    link_elem = item.find('a', href=True)
                    event_url = urljoin(url, link_elem['href']) if link_elem else None
                    
                    if not event_url or not verify_url(event_url):
                        continue
                    
                    date_elem = item.find('span', class_=re.compile(r'date|time', re.I))
                    if not date_elem:
                        date_elem = item.find('p', class_=re.compile(r'date|time', re.I))
                    event_date_raw = date_elem.get_text(strip=True) if date_elem else None
                    event_date = normalize_to_iso8601(event_date_raw)
                    
                    if not event_date or not is_future_event(event_date):
                        continue
                    
                    events.append({
                        "source": "MyHelsinki",
                        "title": title,
                        "url": event_url,
                        "date": event_date,
                        "city": "Helsinki",
                        "scraped_at": datetime.now().isoformat()
                    })
                    logger.debug(f"  ✓ {title[:40]}... ({event_date})")
                    
                except Exception as e:
                    logger.debug(f"  Error parsing item: {e}")
                    continue
            
            browser.close()
            logger.info(f"Parsed {len(events)} valid events from MyHelsinki (Playwright)")
            
    except Exception as e:
        logger.error(f"Error with Playwright: {e}")
    
    return events

def parse_myhelsinki() -> List[Dict]:
    """Parse MyHelsinki - upgrade to Playwright if requests returns < 3 events"""
    logger.info(">>> PARSING: MyHelsinki")
    
    events = parse_myhelsinki_requests()
    
    if len(events) < 3 and PLAYWRIGHT_AVAILABLE:
        logger.info(f"Only {len(events)} events from requests, upgrading to Playwright...")
        events = parse_myhelsinki_playwright()
    
    return events

def parse_helsinki_events() -> List[Dict]:
    """Parse events from tapahtumat.hel.fi"""
    events = []
    url = "https://tapahtumat.hel.fi/"
    
    try:
        logger.info(f">>> PARSING: Helsinki Events")
        
        if not verify_url(url):
            logger.warning(f"URL not accessible: {url}")
            return events
        
        response = requests.get(url, headers=HEADERS, timeout=10)
        response.raise_for_status()
        
        soup = BeautifulSoup(response.content, 'html.parser')
        
        event_items = soup.find_all('div', class_=re.compile(r'event|card|item|article', re.I))
        if not event_items:
            event_items = soup.find_all('article')
        
        logger.info(f"Found {len(event_items)} potential event items")
        
        for item in event_items[:100]:
            try:
                title_elem = item.find('h2') or item.find('h3') or item.find('a')
                title = title_elem.get_text(strip=True) if title_elem else None
                
                if not title or len(title) < 3:
                    continue
                
                link_elem = item.find('a', href=True)
                event_url = urljoin(url, link_elem['href']) if link_elem else None
                
                if not event_url or not verify_url(event_url):
                    continue
                
                date_text_raw = None
                for tag in item.find_all(['span', 'p', 'div']):
                    text = tag.get_text(strip=True)
                    if re.search(r'\d+\.\d+', text) or 'klo' in text.lower():
                        date_text_raw = text
                        break
                
                event_date = normalize_to_iso8601(date_text_raw)
                
                if not event_date or not is_future_event(event_date):
                    continue
                
                events.append({
                    "source": "Helsinki Events",
                    "title": title,
                    "url": event_url,
                    "date": event_date,
                    "city": "Helsinki",
                    "scraped_at": datetime.now().isoformat()
                })
                logger.debug(f"  ✓ {title[:40]}... ({event_date})")
                
            except Exception as e:
                logger.debug(f"  Error parsing item: {e}")
                continue
        
        logger.info(f"Parsed {len(events)} valid events from Helsinki Events")
        
    except requests.exceptions.RequestException as e:
        logger.error(f"Error fetching Helsinki Events: {e}")
    except Exception as e:
        logger.error(f"Error parsing Helsinki Events: {e}")
    
    return events

def parse_espoo_events() -> List[Dict]:
    """Parse events from Espoo official site"""
    events = []
    url = "https://www.espoo.fi/en/events"
    
    try:
        logger.info(f">>> PARSING: Espoo Events")
        
        if not verify_url(url):
            logger.warning(f"URL not accessible: {url}")
            return events
        
        response = requests.get(url, headers=HEADERS, timeout=10)
        response.raise_for_status()
        
        soup = BeautifulSoup(response.content, 'html.parser')
        
        event_items = soup.find_all('div', class_=re.compile(r'event|article|card|item', re.I))
        logger.info(f"Found {len(event_items)} potential event items")
        
        for item in event_items[:100]:
            try:
                title_elem = item.find('h2') or item.find('h3') or item.find('a')
                title = title_elem.get_text(strip=True) if title_elem else None
                
                if not title or len(title) < 3:
                    continue
                
                link_elem = item.find('a', href=True)
                event_url = urljoin(url, link_elem['href']) if link_elem else None
                
                if not event_url or not verify_url(event_url):
                    continue
                
                date_text_raw = None
                for tag in item.find_all(['span', 'p']):
                    text = tag.get_text(strip=True)
                    if re.search(r'\d+\.\d+|\d{4}', text):
                        date_text_raw = text
                        break
                
                event_date = normalize_to_iso8601(date_text_raw)
                
                if not event_date or not is_future_event(event_date):
                    continue
                
                events.append({
                    "source": "Espoo Events",
                    "title": title,
                    "url": event_url,
                    "date": event_date,
                    "city": "Espoo",
                    "scraped_at": datetime.now().isoformat()
                })
                logger.debug(f"  ✓ {title[:40]}... ({event_date})")
                
            except Exception as e:
                logger.debug(f"  Error parsing item: {e}")
                continue
        
        logger.info(f"Parsed {len(events)} valid events from Espoo Events")
        
    except requests.exceptions.RequestException as e:
        logger.error(f"Error fetching Espoo Events: {e}")
    except Exception as e:
        logger.error(f"Error parsing Espoo Events: {e}")
    
    return events

def parse_vantaa_events() -> List[Dict]:
    """Parse events from Vantaa official site"""
    events = []
    url = "https://www.vantaa.fi/en/culture-and-leisure/events"
    
    try:
        logger.info(f">>> PARSING: Vantaa Events")
        
        if not verify_url(url):
            logger.warning(f"URL not accessible: {url}")
            return events
        
        response = requests.get(url, headers=HEADERS, timeout=10)
        response.raise_for_status()
        
        soup = BeautifulSoup(response.content, 'html.parser')
        
        event_items = soup.find_all('div', class_=re.compile(r'event|article|card|item', re.I))
        logger.info(f"Found {len(event_items)} potential event items")
        
        for item in event_items[:100]:
            try:
                title_elem = item.find('h2') or item.find('h3') or item.find('a')
                title = title_elem.get_text(strip=True) if title_elem else None
                
                if not title or len(title) < 3:
                    continue
                
                link_elem = item.find('a', href=True)
                event_url = urljoin(url, link_elem['href']) if link_elem else None
                
                if not event_url or not verify_url(event_url):
                    continue
                
                date_text_raw = None
                for tag in item.find_all(['span', 'p']):
                    text = tag.get_text(strip=True)
                    if re.search(r'\d+\.\d+|\d{4}', text):
                        date_text_raw = text
                        break
                
                event_date = normalize_to_iso8601(date_text_raw)
                
                if not event_date or not is_future_event(event_date):
                    continue
                
                events.append({
                    "source": "Vantaa Events",
                    "title": title,
                    "url": event_url,
                    "date": event_date,
                    "city": "Vantaa",
                    "scraped_at": datetime.now().isoformat()
                })
                logger.debug(f"  ✓ {title[:40]}... ({event_date})")
                
            except Exception as e:
                logger.debug(f"  Error parsing item: {e}")
                continue
        
        logger.info(f"Parsed {len(events)} valid events from Vantaa Events")
        
    except requests.exceptions.RequestException as e:
        logger.error(f"Error fetching Vantaa Events: {e}")
    except Exception as e:
        logger.error(f"Error parsing Vantaa Events: {e}")
    
    return events

def deduplicate_events(events: List[Dict]) -> List[Dict]:
    """Remove duplicates using (title.lower().strip(), url, datetime) as key"""
    seen = set()
    unique_events = []
    
    for event in events:
        key = create_dedup_key(event)
        if key not in seen:
            seen.add(key)
            unique_events.append(event)
        else:
            logger.debug(f"Skipped duplicate: {event['title']} ({event.get('date')})")
    
    logger.info(f"Deduplication: {len(events)} → {len(unique_events)} events")
    return unique_events

def fetch_events() -> List[Dict]:
    """Main function to fetch and aggregate events from all sources"""
    all_events = []
    
    print("\n" + "="*70)
    print("LOKKI EVENT SCRAPER - HELSINKI/ESPOO/VANTAA")
    print("="*70 + "\n")
    
    all_events.extend(parse_myhelsinki())
    all_events.extend(parse_helsinki_events())
    all_events.extend(parse_espoo_events())
    all_events.extend(parse_vantaa_events())
    
    logger.info(f"\nTotal events before deduplication: {len(all_events)}")
    
    # Deduplicate
    all_events = deduplicate_events(all_events)
    
    # Final filter: future events only (should already be filtered, but ensure)
    all_events = [e for e in all_events if is_future_event(e.get('date'))]
    logger.info(f"Events after final future filter: {len(all_events)}")
    
    # Sort by date ascending (earliest first)
    all_events.sort(key=lambda e: e.get('date', ''))
    
    # Write to JSON
    output_file = "lokki/events.json"
    try:
        with open(output_file, "w", encoding='utf-8') as outfile:
            json.dump(all_events, outfile, indent=2, ensure_ascii=False)
        logger.info(f"\n✅ SUCCESS: {len(all_events)} total verified events saved to {output_file}")
        logger.info(f"All events are: verified URLs, ISO 8601 dates, deduplicated, future-only")
    except Exception as e:
        logger.error(f"\n❌ Error writing to file: {e}")
    
    return all_events

if __name__ == "__main__":
    logger.info(f"Lokki Event Scraper starting at {datetime.now().isoformat()}")
    fetch_events()
    logger.info("Scraping completed!")
