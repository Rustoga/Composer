import { Event } from "../types/event";
import { mockEvents } from "../mock/events";
import { fetchFromStadissa } from "./sources/stadissa";

export type ScraperSource = "stadissa" | "hs_menokone" | "mock";

export interface ScraperOptions {
  source?: ScraperSource; // Which source to use; defaults to 'mock'
  query?: string; // Optional query or endpoint-specific parameter
}

/**
 * High-level abstraction for fetching events.
 */
export async function fetchEvents(options?: ScraperOptions): Promise<Event[]> {
  const source = options?.source ?? "mock";

  switch (source) {
    case "stadissa":
      return fetchFromStadissa({ listingUrl: options?.query });
    case "hs_menokone":
      return fetchFromHSMenokone(options);
    case "mock":
    default:
      // Return mock data for development and testing
      return Promise.resolve(mockEvents);
  }
}

/**
 * Placeholder for HS Menokone integration.
 */
async function fetchFromHSMenokone(_options?: ScraperOptions): Promise<Event[]> {
  // TODO: implement real fetch + parse logic for HS Menokone
  return Promise.resolve(mockEvents);
}
