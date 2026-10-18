import { createHash } from "node:crypto";
import { getStore } from "@netlify/blobs";

// Each visitor (by IP address) can make this many videos per day (UTC), to protect the API budget.
export const DAILY_LIMIT = Number(process.env.DAILY_VIDEO_LIMIT ?? 10);
export const LIMIT_MESSAGE =
  "You've made 10 videos today, which is the daily limit. Tomo is resting by the fire now. Come back tomorrow for more!";

function key(req, context) {
  const ip = context?.ip || req.headers.get("x-nf-client-connection-ip") || "unknown";
  const day = new Date().toISOString().slice(0, 10);
  // Store a hash, not the raw IP address.
  return `${day}/${createHash("sha256").update(ip).digest("hex").slice(0, 32)}`;
}

const store = () => getStore("video-limits");

export async function remaining(req, context) {
  try {
    const count = Number(await store().get(key(req, context))) || 0;
    return DAILY_LIMIT - count;
  } catch (err) {
    // If the counter store is unavailable, let the video through rather than break the site.
    console.error("limit read error", err);
    return DAILY_LIMIT > 0 ? 1 : 0;
  }
}

// Counted when the animation (the expensive step) is queued.
export async function countVideo(req, context) {
  const k = key(req, context);
  const count = Number(await store().get(k)) || 0;
  await store().set(k, String(count + 1));
}
