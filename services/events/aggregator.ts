import { normalizeEvent, NormalizedEvent } from "./eventNormalizer";
import fs from "fs";
import path from "path";

type AggregateOptions = { maxPerSource?: number };

function safeDateValue(date: string | undefined): number {
  if (!date) return Number.MAX_SAFE_INTEGER;
  const d = new Date(date);
  const t = d.getTime();
  return isNaN(t) ? Number.MAX_SAFE_INTEGER : t;
}

export async function aggregateEvents(
  options?: AggregateOptions
): Promise<NormalizedEvent[]> {
  const maxPerSource = options?.maxPerSource ?? 200;

  try {
    const filePath = path.join(process.cwd(), "lokki", "events.json");
    const raw = fs.readFileSync(filePath, "utf-8");
    const events = JSON.parse(raw);

    if (!Array.isArray(events)) {
      console.warn("events.json is not an array");
      return [];
    }

    // 1. Normalize
    let normalized: NormalizedEvent[] = events.map((e) =>
      normalizeEvent(e)
    );

    // 2. Remove invalid entries
    normalized = normalized.filter(
      (e) => e.title && e.date && e.location
    );

    // 3. Deduplicate (strong key)
    const seen = new Set<string>();
    normalized = normalized.filter((e) => {
      const key = `${e.title.toLowerCase()}|${e.date}|${e.location}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // 4. Sort by date (soonest first)
    normalized.sort((a, b) => {
      return safeDateValue(a.date) - safeDateValue(b.date);
    });

    // 5. Limit output
    return normalized.slice(0, maxPerSource);

  } catch (err) {
    console.error("aggregateEvents error:", err);
    return [];
  }
}
