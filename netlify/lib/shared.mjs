import { fal } from "@fal-ai/client";

fal.config({ credentials: process.env.FAL_KEY });
export { fal };

// The fal models behind each stage of the pipeline.
export const MODELS = {
  voice: "fal-ai/elevenlabs/tts/eleven-v3",
  video: "veed/fabric-1.0",
};

export const VOICE = "Matilda";
export const MAX_SECONDS = 20;

export const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

export const fail = (message, status = 400) => json({ error: message }, status);

export async function readJson(req) {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

// Only accept media that fal itself produced, so the API can't be pointed at arbitrary URLs.
export function isFalMedia(url) {
  try {
    const { protocol, hostname } = new URL(url);
    return protocol === "https:" && (hostname === "fal.media" || hostname.endsWith(".fal.media"));
  } catch {
    return false;
  }
}

// ElevenLabs returns timing per character, in chunks. Flatten that into spoken words.
export function wordsFromTimestamps(chunks = []) {
  const words = [];
  let current = null;
  for (const chunk of chunks) {
    const chars = chunk.characters || [];
    chars.forEach((ch, i) => {
      const start = chunk.character_start_times_seconds[i];
      const end = chunk.character_end_times_seconds[i];
      if (/\s/.test(ch)) {
        if (current) words.push(current);
        current = null;
      } else if (current) {
        current.text += ch;
        current.end = end;
      } else {
        current = { text: ch, start, end };
      }
    });
  }
  if (current) words.push(current);
  return words.map((w) => ({ text: w.text, start: round(w.start), end: round(w.end) }));
}

const round = (n) => Math.round(n * 1000) / 1000;
