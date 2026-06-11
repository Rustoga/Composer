import { normalizeEvent, NormalizedEvent } from "./eventNormalizer";
import fs from "fs";
import path from "path";

type AggregateOptions = { maxPerSource?: number };

function scoreEvent(e: NormalizedEvent): number {
  let score = 0;

  // 1. future events already guaranteed, but prioritize closer dates
  const now = Date.now();
  const eventTime = new Date(e.date).getTime();
  const diffHours = (eventTime - now) / (1000 * 60 * 60);

  // closer events = higher score (up to 7 days window)
  if (diffHours >= 0 && diffHours <= 24) score += 50;
  else if (diffHours <= 72) score += 30;
  else if (diffHours <= 168) score += 10;

  // 2. category boosts
  if (e.category === "MUSIC") score += 10;
  if (e.category === "FOOD") score += 8;
  if (e.category === "ART") score += 6;

  // 3. source reliability boost
  if (e.source.toLowerCase().includes("helsinki")) score += 5;

  // 4. title quality heuristic (longer = more likely real event)
  if (e.title.length > 20) score += 5;

  // 5. penalty for missing data
  if (!e.image) score -= 2;
  if (!e.description) score -= 3;

  return score;
}

export async function aggregateEvents(
  options?: AggregateOptions
): Promise<NormalizedEvent[]> {
  const maxPerSource = options?.maxPerSource ?? 100;

  try {
    const filePath = path.join(process.cwd(), "lokki", "events.json");
    const raw = fs.readFileSync(filePath, "utf-8");
    const events = JSON.parse(raw);

    if (!Array.isArray(events)) {
      return [];
    }

    const normalized: NormalizedEvent[] = events
      .slice(0, maxPerSource)
      .map((e) => normalizeEvent(e));

    // SORT BY SCORE (THIS IS THE BIG CHANGE)
    const ranked = normalized
      .map((e) => ({
        event: e,
        score: scoreEvent(e),
      }))
      .sort((a, b) => b.score - a.score)
      .map((x) => x.event);

    return ranked;
  } catch (err) {
    console.error("aggregateEvents error:", err);
    return [];
  }
}
