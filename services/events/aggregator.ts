import { normalizeEvent, NormalizedEvent } from "./eventNormalizer";

type AggregateOptions = { maxPerSource?: number };

const mockEvents = [
  {
    id: "1",
    title: "Test Concert",
    description: "A music event",
    category: "MUSIC",
    location: "Helsinki",
    date: "2026-07-01",
    image: "",
    source: "mock",
  },
  {
    id: "2",
    title: "Food Festival",
    description: "Street food event",
    category: "FOOD",
    location: "Espoo",
    date: "2026-07-02",
    image: "",
    source: "mock",
  },
];

export async function aggregateEvents(options?: AggregateOptions): Promise<NormalizedEvent[]> {
  const maxPerSource = options?.maxPerSource ?? 50;
  // For now use mock events only
  const sliced = mockEvents.slice(0, maxPerSource);
  const normalized: NormalizedEvent[] = sliced.map((e) => normalizeEvent(e));
  return normalized;
}
