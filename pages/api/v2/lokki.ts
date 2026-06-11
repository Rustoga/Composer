import type { NextApiRequest, NextApiResponse } from "next";
import { normalizeEvent } from "../../../services/normalizeEvent";
import fs from "fs";
import path from "path";

type Event = {
  title: string;
  url: string;
  date: string;
  city: string;
  source: string;
  scraped_at: string;
};

export default function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  try {
    const filePath = path.join(process.cwd(), "lokki", "events.json");

    const raw = fs.readFileSync(filePath, "utf-8");
    const events: Event[] = JSON.parse(raw);

    const normalized = events
      .map(normalizeEvent)
      .filter(Boolean);

    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");

    return res.status(200).json({
      count: normalized.length,
      events: normalized,
      updatedAt: new Date().toISOString(),
    });
  } catch (err: any) {
    return res.status(500).json({
      error: "Failed to load Lokki events",
      message: err.message,
    });
  }
}
