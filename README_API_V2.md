# API v2

This project exposes a versioned API under /api/v2 for events, search, and recommendations (Phase 2).

Endpoints

1. GET /api/v2/events
   - Returns aggregated, normalized events from all sources.
   - Query params: none
   - Response: { events: NormalizedEvent[] }

2. GET /api/v2/events/[id]
   - Returns a single event by stable id
   - Response: { event: NormalizedEvent }

3. GET /api/v2/search
   - Search events
   - Query params:
     - q: search query
     - category: one of enum EventCategory values or ALL
     - dateFrom: YYYY-MM-DD
     - dateTo: YYYY-MM-DD
     - city: city name
     - limit: number (max 200)
   - Response: { results: NormalizedEvent[] }

Usage examples

- Fetch aggregated events:
  GET https://rudolfwesterholm.com/api/v2/events

- Fetch a single event:
  GET https://rudolfwesterholm.com/api/v2/events/abcdef123456...

- Search for food events in Helsinki:
  GET /api/v2/search?q=food&category=FOOD&city=Helsinki&limit=20

Notes

- API v2 uses the internal aggregator and search services (in-memory aggregation and search for Phase 2).
- Responses are typed and validated; invalid parameters return 400 errors.
- Aggregation results are cached for 5 minutes to reduce scraping load.
