# Lokki — Free Events

Lokki lists **free events** (ilmainen / vapaa pääsy) in **Helsinki, Espoo and Vantaa**.

## How it works
- `scripts/fetch-lokki-events.mjs` scrapes the [Linked Events open API](https://api.hel.fi/linkedevents/v1/event/)
  (MyHelsinki avoin data). It keeps only events where `is_free` is true (or the price
  text says *ilmainen / vapaa pääsy / free*), tags the city (Helsinki / Espoo / Vantaa)
  from the event id and address, detects free **sauna** access, and builds
  Google Maps + HSL Reittiopas links from the venue coordinates/address.
- It writes the result to `lokki/events.json`.
- `lokki/index.html` renders that JSON (event link, Google Maps, Reittiopas, date/time,
  category, and a ♨ Sauna badge).
- A GitHub Actions workflow (`.github/workflows/lokki-events.yml`) runs the scraper
  **twice a day at 06:00 and 19:00 Finnish time** and commits the updated `events.json`,
  so the static GitHub Pages site stays current. Trigger it manually from Actions →
  "Update Lokki events" → Run workflow.

## Notes
- Some events lack precise coordinates in the source data; in that case the map /
  Reittiopas links fall back to a text address search.
- The old HTML scraping of HS Menokone / Stadissa and the TypeScript `services/`
  prototype were removed because they were non-functional (they returned no events).
