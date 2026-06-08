import type { NextApiRequest, NextApiResponse } from 'next';
import { aggregateEvents } from '../../../services/events/aggregator';
import { searchEvents } from '../../../services/search/searchEvents';
import { EventCategory } from '../../../types/eventCategory';
import type { NormalizedEvent } from '../../../services/events/eventNormalizer';

type SearchResponse = { results: (NormalizedEvent & { _searchScore?: number })[] } | { error: string };

function parseQueryParam(q: any) {
  if (!q) return undefined;
  if (Array.isArray(q)) return q[0];
  return q;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<SearchResponse>) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const query = parseQueryParam(req.query.q) || '';
    const categoryParam = parseQueryParam(req.query.category) || 'ALL';
    const dateFrom = parseQueryParam(req.query.dateFrom);
    const dateTo = parseQueryParam(req.query.dateTo);
    const city = parseQueryParam(req.query.city);
    const limit = Math.min(parseInt(parseQueryParam(req.query.limit) || '50', 10) || 50, 200);

    let category: EventCategory | 'ALL' = 'ALL';
    if (categoryParam && categoryParam !== 'ALL') {
      if ((Object.values(EventCategory) as string[]).includes(String(categoryParam))) {
        category = categoryParam as EventCategory;
      } else {
        return res.status(400).json({ error: 'Invalid category' });
      }
    }

    // Aggregate then search in-memory (for Phase 2). If scale becomes a problem, add index.
    const events = await aggregateEvents({ maxPerSource: 200 });
    const results = await searchEvents(events as NormalizedEvent[], {
      query,
      category,
      dateFrom,
      dateTo,
      city,
      limit,
    });

    return res.status(200).json({ results });
  } catch (err: any) {
    console.error('api/v2/search error', err?.message || err);
    return res.status(500).json({ error: 'Search failed' });
  }
}
