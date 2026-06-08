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
}

export function normalizeEvent(event: any): NormalizedEvent {
  const title = event && event.title ? String(event.title).trim() : "";
  const description = event && event.description ? String(event.description).trim() : "";
  const location = event && event.location ? String(event.location).trim() : "";
  const date = event && event.date ? String(event.date).trim() : "";
  const image = event && event.image ? String(event.image).trim() : "";
  const source = event && event.source ? String(event.source).trim() : "";

  // Safely map category to enum when possible
  let category: EventCategory = EventCategory.OTHER;
  let categoryConfidence = 0;
  if (event && event.category) {
    const cat = String(event.category).toUpperCase().trim();
    if (Object.values(EventCategory).includes(cat as EventCategory)) {
      category = cat as EventCategory;
      categoryConfidence = 0.8;
    }
  }

  // Create a stable id if provided or fallback to hashed-ish placeholder
  const id = event && event.id ? String(event.id) : `${category}:${title}:${date}:${location}`;

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
  };
}
