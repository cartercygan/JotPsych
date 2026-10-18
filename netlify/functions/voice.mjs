import { fal, MODELS, VOICE, json, fail, readJson } from "../lib/shared.mjs";

// Queues the text-to-speech job and returns at once; the page polls /api/status.
export default async (req) => {
  if (req.method !== "POST") return fail("Use POST", 405);
  const { script } = await readJson(req);
  if (typeof script !== "string" || !script.trim() || script.length > 450) return fail("Invalid script.");

  try {
    const { request_id } = await fal.queue.submit(MODELS.voice, {
      input: { text: script.trim(), voice: VOICE, stability: 0.5, timestamps: true },
    });
    return json({ id: request_id });
  } catch (err) {
    console.error("voice submit error", err);
    return fail("We couldn't start the voice recording. Please try again.", 502);
  }
};

export const config = { path: "/api/voice" };
