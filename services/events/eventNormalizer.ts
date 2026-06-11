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
  url?: string;
}

function stableHash(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

export function normalizeEvent(event: any): NormalizedEvent {
  const title = event?.title ? String(event.title).trim() : "";
  const description = event?.description ? String(event.description).trim() : "";

  const location =
    event?.location
      ? String(event.location).trim()
      : event?.city
      ? String(event.city).trim()
      : "Unknown";

  const date = event?.date ? String(event.date).trim() : "";
  const image = event?.image ? String(event.image).trim() : "";
  const source = event?.source ? String(event.source).trim() : "";
  const url = event?.url ? String(event.url).trim() : "";

  let category: EventCategory = EventCategory.OTHER;
  let categoryConfidence = 0;

  if (event?.category) {
    const cat = String(event.category).toUpperCase().trim();
    if (Object.values(EventCategory).includes(cat as EventCategory)) {
      category = cat as EventCategory;
      categoryConfidence = 0.8;
    }
  }

  // STRONG STABLE ID (prevents duplicates across sources)
  const base = `${title}|${date}|${location}|${source}`;
  const id =
    event?.id && typeof event.id === "string"
      ? event.id
      : stableHash(base);

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
    url,
  };
}
