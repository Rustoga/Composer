import type { NextApiRequest, NextApiResponse } from 'next';
import { aggregateEvents } from '../../../../services/events/aggregator';
import type { NormalizedEvent } from '../../../../services/events/eventNormalizer';

type EventResponse = { event: NormalizedEvent } | { error: string };

export default async function handler(req: NextApiRequest, res: NextApiResponse<EventResponse>) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { id } = req.query;
  if (!id || Array.isArray(id)) return res.status(400).json({ error: 'Invalid id' });

  try {
    const events = await aggregateEvents({ maxPerSource: 200 });
    const found = events.find((e) => e.id === id);
    if (!found) return res.status(404).json({ error: 'Event not found' });
    return res.status(200).json({ event: found });
  } catch (err: any) {
    console.error('api/v2/events/[id] error', err?.message || err);
    return res.status(500).json({ error: 'Failed to fetch event' });
  }
}
