export enum EventCategory {
  MUSIC = "MUSIC",
  FOOD = "FOOD",
  ART = "ART",
  SPORTS = "SPORTS",
  NIGHTLIFE = "NIGHTLIFE",
  FAMILY = "FAMILY",
  THEATRE = "THEATRE",
  MARKET = "MARKET",
  OUTDOORS = "OUTDOORS",
  OTHER = "OTHER",
}

export interface NormalizedEvent {
  id: string;
  title: string;
  description: string;
  category: EventCategory;
  categoryConfidence: number;
  location: string;
  date: string;
  image: string;
  source: string;

  lat?: number;
  lng?: number;
}

function cityCoordinates(location: string) {
  const city = location?.toLowerCase() || "";

  if (city.includes("helsinki")) {
    return { lat: 60.1699, lng: 24.9384 };
  }

  if (city.includes("espoo")) {
    return { lat: 60.2055, lng: 24.6559 };
  }

  if (city.includes("vantaa")) {
    return { lat: 60.2934, lng: 25.0378 };
  }

  return undefined;
}

export function normalizeEvent(event: any): NormalizedEvent {
  const title = event?.title ? String(event.title).trim() : "";
  const description = event?.description ? String(event.description).trim() : "";

  const location = event?.location
    ? String(event.location).trim()
    : event?.city
    ? String(event.city).trim()
    : "Unknown";

  const date = event?.date ? String(event.date).trim() : "";
  const image = event?.image ? String(event.image).trim() : "";
  const source = event?.source ? String(event.source).trim() : "";

  let category: EventCategory = EventCategory.OTHER;
  let categoryConfidence = 0;

  if (event?.category) {
    const cat = String(event.category).toUpperCase().trim();

    if (Object.values(EventCategory).includes(cat as EventCategory)) {
      category = cat as EventCategory;
      categoryConfidence = 0.8;
    }
  }

  const id =
    event?.id ||
    `${source}:${title}:${date}:${location}`;

  const coords = cityCoordinates(location);

  return {
    id,
    title,
    description,
    category,
    categoryConfidence,
    location,
    date,
    image,
    source,
    lat: coords?.lat,
    lng: coords?.lng,
  };
}
