import type { NextApiRequest, NextApiResponse } from 'next';
import { aggregateEvents } from '../../../services/events/aggregator';
import { getCache, setCache } from '../../../services/cache';
import type { NormalizedEvent } from '../../../services/events/eventNormalizer';

type EventsResponse = { events: NormalizedEvent[] } | { error: string };

export default async function handler(req: NextApiRequest, res: NextApiResponse<EventsResponse>) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const cacheKey = 'api:v2:events';
    const cached = await getCache<NormalizedEvent[]>(cacheKey);
    if (cached) return res.status(200).json({ events: cached });

    const events = await aggregateEvents({ maxPerSource: 100 });
    await setCache(cacheKey, events, 60 * 5); // cache 5 minutes

    return res.status(200).json({ events });
  } catch (err: any) {
    console.error('api/v2/events error', err?.message || err);
    return res.status(500).json({ error: 'Failed to aggregate events' });
  }
}
