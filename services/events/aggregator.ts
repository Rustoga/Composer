import { normalizeEvent, NormalizedEvent } from "./eventNormalizer";
import fs from "fs";
import path from "path";

type AggregateOptions = { maxPerSource?: number };

export async function aggregateEvents(
  options?: AggregateOptions
): Promise<NormalizedEvent[]> {
  const maxPerSource = options?.maxPerSource ?? 100;

  try {
    // Read scraped events JSON produced by Python scraper
    const filePath = path.join(process.cwd(), "lokki", "events.json");
    const raw = fs.readFileSync(filePath, "utf-8");
    const events = JSON.parse(raw);

    if (!Array.isArray(events)) {
      console.warn("events.json is not an array");
      return [];
    }

    const sliced = events.slice(0, maxPerSource);

    const normalized: NormalizedEvent[] = sliced.map((e) =>
      normalizeEvent(e)
    );

    return normalized;
  } catch (err) {
    console.error("aggregateEvents error:", err);

    // fallback empty instead of crashing API
    return [];
  }
}
