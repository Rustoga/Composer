/**
 * Fetches Instagram posts using Instagram Graph API and writes a lightweight JSON cache
 * that can be served by GitHub Pages (static).
 *
 * Required env:
 * - IG_USER_ID: numeric Instagram user id
 * - IG_ACCESS_TOKEN: Instagram Graph API access token (long-lived recommended)
 *
 * Output:
 * - visuals/instagram-feed.json
 */

import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const USER_ID = process.env.IG_USER_ID;
const ACCESS_TOKEN = process.env.IG_ACCESS_TOKEN;

if (!USER_ID || !ACCESS_TOKEN) {
  console.error("Missing IG_USER_ID or IG_ACCESS_TOKEN env var.");
  process.exit(2);
}

const API_VERSION = process.env.IG_GRAPH_API_VERSION || "v19.0";

const FIELDS = [
  "id",
  "caption",
  "media_type",
  "media_url",
  "thumbnail_url",
  "permalink",
  "timestamp",
].join(",");

const url = new URL(`https://graph.facebook.com/${API_VERSION}/${USER_ID}/media`);
url.searchParams.set("fields", FIELDS);
url.searchParams.set("access_token", ACCESS_TOKEN);
url.searchParams.set("limit", "50");

const resp = await fetch(url);
if (!resp.ok) {
  const text = await resp.text().catch(() => "");
  console.error(`Instagram API error: ${resp.status} ${resp.statusText}\n${text}`);
  process.exit(1);
}

const json = await resp.json();
const items = Array.isArray(json?.data) ? json.data : [];

const out = {
  source: "Instagram Graph API",
  username: "rudolf_visual",
  fetched_at: new Date().toISOString(),
  items: items.map((it) => ({
    id: it.id,
    caption: it.caption ?? "",
    media_type: it.media_type,
    media_url: it.media_url,
    thumbnail_url: it.thumbnail_url,
    permalink: it.permalink,
    timestamp: it.timestamp,
  })),
};

const outPath = resolve(process.cwd(), "visuals", "instagram-feed.json");
await writeFile(outPath, JSON.stringify(out, null, 2) + "\n", "utf8");

console.log(`Wrote ${out.items.length} items to ${outPath}`);

