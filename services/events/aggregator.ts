import fs from 'fs';
import path from 'path';
import { normalizeEvent, NormalizedEvent } from './eventNormalizer';

type AggregateOptions = { maxPerSource?: number };

const mockEvents = [
  {
    id: '1',
    title: 'Test Concert',
    description: 'A music event',
    category: 'MUSIC',
    location: 'Helsinki',
    date: '2026-07-01T18:00:00',
    image: '',
    source: 'mock',
  },
  {
    id: '2',
    title: 'Food Festival',
    description: 'Street food event',
    category: 'FOOD',
    location: 'Espoo',
    date: '2026-07-02T12:00:00',
    image: '',
    source: 'mock',
  },
];

function readLokkiEvents(): any[] {
  try {
    const filePath = path.join(process.cwd(), 'lokki', 'events.json');
    if (!fs.existsSync(filePath)) return [];

    const raw = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(raw);

    return Array.isArray(data) ? data : [];
  } catch (err) {
    console.error('Failed to read lokki/events.json:', err);
    return [];
  }
}

export async function aggregateEvents(
  options?: AggregateOptions
): Promise<NormalizedEvent[]> {
  const maxPerSource = options?.maxPerSource ?? 50;

  // 1. Try real scraper output first
  const lokkiEvents = readLokkiEvents().slice(0, maxPerSource);

  let sourceEvents: any[] = [];

  if (lokkiEvents.length > 0) {
    sourceEvents = lokkiEvents;
  } else {
    // 2. Fallback to mock data (dev safety)
    sourceEvents = mockEvents.slice(0, maxPerSource);
  }

  // 3. Normalize everything
  const normalized: NormalizedEvent[] = sourceEvents.map((e) =>
    normalizeEvent(e)
  );

  // 4. Deduplicate (lightweight safety net)
  const seen = new Set<string>();
  const deduped: NormalizedEvent[] = [];

  for (const event of normalized) {
    const key = `${event.title}|${event.date}|${event.location}`.toLowerCase();

    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(event);
  }

  // 5. Sort by date (future-first)
  deduped.sort((a, b) => (a.date || '').localeCompare(b.date || ''));

  return deduped;
}
