import type { NextApiRequest, NextApiResponse } from 'next';
import { aggregateEvents } from '../../../services/events/aggregator';
import { getCache, setCache } from '../../../services/cache';
import type { NormalizedEvent } from '../../../services/events/eventNormalizer';

type EventsResponse =
  | { events: NormalizedEvent[] }
  | { error: string };

const CACHE_KEY = 'api:v2:events';
const CACHE_TTL_SECONDS = 60 * 5;

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<EventsResponse>
) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    // 1. Try cache first
    const cached = await getCache<NormalizedEvent[]>(CACHE_KEY);
    if (cached && Array.isArray(cached)) {
      return res.status(200).json({ events: cached });
    }

    // 2. Aggregate fresh events
    const events = await aggregateEvents({ maxPerSource: 100 });

    // 3. Basic safety filter (defensive layer)
    const safeEvents = Array.isArray(events) ? events : [];

    // 4. Cache result
    await setCache(CACHE_KEY, safeEvents, CACHE_TTL_SECONDS);

    return res.status(200).json({ events: safeEvents });
  } catch (err: any) {
    console.error('api/v2/events error:', err?.message || err);
    return res.status(500).json({
      error: 'Failed to aggregate events',
    });
  }
}
