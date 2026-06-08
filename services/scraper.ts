import { Event } from "../types/event";
import { mockEvents } from "../mock/events";

export type ScraperSource = "stadissa" | "hs_menokone" | "mock";

export interface ScraperOptions {
  source?: ScraperSource; // Which source to use; defaults to 'mock'
  query?: string; // Optional query or endpoint-specific parameter
}

/**
 * High-level abstraction for fetching events.
 *
 * Currently returns mock data. The implementation is structured so
 * it can be extended to perform real scraping or API calls for
 * supported sources: Stadissa.fi and HS Menokone.
 */
export async function fetchEvents(options?: ScraperOptions): Promise<Event[]> {
  const source = options?.source ?? "mock";

  switch (source) {
    case "stadissa":
      return fetchFromStadissa(options);
    case "hs_menokone":
      return fetchFromHSMenokone(options);
    case "mock":
    default:
      // Return mock data for development and testing
      return Promise.resolve(mockEvents);
  }
}

/**
 * Placeholder for Stadissa.fi integration.
 *
 * Future: perform HTTP requests to Stadissa, parse HTML/JSON, map to Event[]
 */
async function fetchFromStadissa(_options?: ScraperOptions): Promise<Event[]> {
  // TODO: implement real fetch + parse logic
  // Example steps to implement later:
  // 1. Request Stadissa endpoint or page
  // 2. Parse HTML or JSON response
  // 3. Map fields to Event interface
  // 4. Normalize dates to YYYY-MM-DD

  // For now, return mock data to keep the interface stable.
  return Promise.resolve(mockEvents);
}

/**
 * Placeholder for HS Menokone integration.
 *
 * Future: perform HTTP requests to HS Menokone, parse the response, and map to Event[]
 */
async function fetchFromHSMenokone(_options?: ScraperOptions): Promise<Event[]> {
  // TODO: implement real fetch + parse logic
  // Steps will be similar to Stadissa integration.

  // For now, return mock data to keep the interface stable.
  return Promise.resolve(mockEvents);
}
