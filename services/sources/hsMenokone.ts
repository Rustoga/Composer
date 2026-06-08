import cheerio from "cheerio";
import { httpGet, absoluteUrl, sanitizeText, normalizeDate } from "../scraper-helpers";
import { setCache, getCache } from "../cache";
import { Event } from "../../types/event";

const BASE = "https://menot.hs.fi"; // HS Menokone listing domain

function sleep(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}

function slugFromUrl(u: string) {
  try {
    const p = new URL(u).pathname;
    return p.replace(/\/+$/g, "").split("/").filter(Boolean).join("/");
  } catch (err) {
    return u;
  }
}

export async function fetchFromHSMenokone(options?: { maxEvents?: number; listingUrl?: string }): Promise<Event[]> {
  const maxEvents = options?.maxEvents ?? 30;
  const listingUrl = options?.listingUrl ?? `${BASE}/`;

  const cacheKey = `hs:listing:${listingUrl}`;
  const cached = getCache<Event[]>(cacheKey);
  if (cached) return cached;

  const html = await httpGet(listingUrl, { ttlSeconds: 60 });
  const $ = cheerio.load(html);

  // Gather candidate links. HS often uses /artikkeli/ or /menot/ paths.
  const links = new Set<string>();
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") || "";
    // heuristics: menot or tapahtuma or tapahtumat
    if (/menot|tapahtuma|events|tapahtumat|event/i.test(href)) {
      const abs = absoluteUrl(BASE, href);
      if (abs.startsWith(BASE)) links.add(abs);
    }
  });

  const events: Event[] = [];
  for (const url of Array.from(links).slice(0, maxEvents)) {
    try {
      await sleep(700);

      const detailCache = getCache<Event>(`hs:detail:${url}`);
      if (detailCache) {
        events.push(detailCache);
        continue;
      }

      const detailHtml = await httpGet(url, { ttlSeconds: 120 });
      const $$ = cheerio.load(detailHtml);

      // Prefer JSON-LD if present
      let jsonld: any = null;
      $$('script[type="application/ld+json"]').each((i, el) => {
        try {
          const txt = $$(el).contents().text();
          const parsed = JSON.parse(txt);
          if (Array.isArray(parsed)) {
            parsed.forEach((p) => { if (p && p['@type'] === 'Event') jsonld = p; });
          } else if (parsed && parsed['@type'] === 'Event') jsonld = parsed;
        } catch (e) {
          // ignore parse errors
        }
      });

      const title = (jsonld?.name) || ($$('meta[property="og:title"]').attr('content')) || $$('h1').first().text().trim();
      const rawDate = jsonld?.startDate || $$('time').first().attr('datetime') || $$('.date, .event-date, .time').first().text().trim();
      const date = normalizeDate(rawDate);
      const description = (jsonld?.description) || sanitizeText($$('.article-body, .content, .description').first().html() || '') || sanitizeText($$('meta[property="og:description"]').attr('content') || '');
      const image = (jsonld?.image) || $$('meta[property="og:image"]').attr('content') || $$('img').first().attr('src') || '';
      const location = (jsonld?.location?.name) || $$('.venue, .location, .event-venue, .place').first().text().trim() || '';

      const ev: Event = {
        id: slugFromUrl(url),
        title: title || 'Untitled',
        description: description || '',
        category: jsonld?.eventType || $$('.category, .event-category').first().text().trim() || '',
        date: date || '',
        image: image ? absoluteUrl(BASE, image) : '',
        location: location || '',
        source: url,
      };

      setCache(`hs:detail:${url}`, ev, 60 * 30);
      events.push(ev);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('hs: failed parsing', url, err?.message || err);
    }
  }

  setCache(cacheKey, events, 60 * 5);
  return events;
}
