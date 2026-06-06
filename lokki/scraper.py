# Lokki Event Scraper
# This script collects free events happening in Helsinki, Espoo, and Vantaa.

import requests
from bs4 import BeautifulSoup
import json
from datetime import datetime

# URLs for scraping events
URLs = [
    {"source": "MyHelsinki", "url": "https://www.myhelsinki.fi/en"},
    {"source": "Helsinki Events", "url": "https://tapahtumat.hel.fi/"},
    {"source": "Espoo Events", "url": "https://www.espoo.fi/en/events"},
    {"source": "Vantaa Events", "url": "https://www.vantaa.fi/en/culture-and-leisure/events"}
]

def fetch_events():
    events = []
    for entry in URLs:
        try:
            response = requests.get(entry['url'])
            if response.status_code == 200:
                soup = BeautifulSoup(response.content, 'html.parser')

                # Placeholder: retrieve event details depending on site structure
                events.append({
                    "source": entry["source"],
                    "event_name": "Sample Event from " + entry['source'],  # Replace with parsed name
                    "url": entry['url'],
                    "datetime": str(datetime.now())  # Replace with real event date
                })

            else:
                print(f"Failed to retrieve {entry['url']}, Status Code: {response.status_code}")
        except Exception as e:
            print(f"Error fetching from {entry['url']}: {e}")

    # Write to JSON for frontend use
    with open("lokki/events.json", "w") as outfile:
        json.dump(events, outfile, indent=4)

if __name__ == "__main__":
    print(f"Lokki Event Scraper starting at {datetime.now()}...")
    fetch_events()
    print("Scraping completed! Events saved to lokki/events.json.")