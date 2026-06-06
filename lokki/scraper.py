# Lokki Event Scraper
# This script collects free events happening in Helsinki, Espoo, and Vantaa.

import requests
from bs4 import BeautifulSoup
from datetime import datetime

# URLs for scraping events
URLs = [
    "https://www.myhelsinki.fi/en",
    "https://tapahtumat.hel.fi/",
    "https://www.espoo.fi/en/events",
    "https://www.vantaa.fi/en/culture-and-leisure/events"
]

def fetch_events(url):
    try:
        response = requests.get(url)
        if response.status_code == 200:
            soup = BeautifulSoup(response.content, 'html.parser')
            # Placeholder: Add actual parsing logic based on site structure
            print(f"Scraping events from {url} ...")
        else:
            print(f"Failed to retrieve {url}, Status Code: {response.status_code}")
    except Exception as e:
        print(f"Error fetching from {url}: {e}")

if __name__ == "__main__":
    print(f"Lokki Event Scraper starting at {datetime.now()}...")
    for url in URLs:
        fetch_events(url)
    print("Scraping completed!")