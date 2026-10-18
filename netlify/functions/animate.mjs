import { fal, MODELS, json, fail, readJson, isFalMedia } from "../lib/shared.mjs";
import { remaining, countVideo, LIMIT_MESSAGE } from "../lib/limit.mjs";

// Queues the talking-bear animation (fixed mascot image + the voice track) and returns at once.
export default async (req, context) => {
  if (req.method !== "POST") return fail("Use POST", 405);
  const { audioUrl } = await readJson(req);
  if (!isFalMedia(audioUrl)) return fail("Invalid audio.");
  if ((await remaining(req, context)) <= 0) return json({ error: LIMIT_MESSAGE, limited: true }, 429);

  try {
    const { request_id } = await fal.queue.submit(MODELS.video, {
      input: { image_url: mascotUrl(req, context), audio_url: audioUrl, resolution: "480p" },
    });
    await countVideo(req, context).catch((err) => console.error("limit count error", err));
    return json({ id: request_id });
  } catch (err) {
    console.error("animate submit error", err);
    return fail("We couldn't start the animation. Please try again.", 502);
  }
};

// fal has to download the mascot, so it needs a public URL. Locally, MASCOT_URL points at a hosted copy.
function mascotUrl(req, context) {
  if (process.env.MASCOT_URL) return process.env.MASCOT_URL;
  const origin = context?.site?.url || new URL(req.url).origin;
  return `${origin}/mascot.png`;
}

export const config = { path: "/api/animate" };
