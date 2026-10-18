import { fal, MODELS, MAX_SECONDS, json, fail, wordsFromTimestamps } from "../lib/shared.mjs";

// Checks a queued fal job. When it's done, returns what the page needs for the next step.
export default async (req) => {
  const params = new URL(req.url).searchParams;
  const stage = params.get("stage");
  const id = params.get("id");
  const model = MODELS[stage];
  if (!model || !id || !/^[\w-]{8,80}$/.test(id)) return fail("Invalid job.");

  try {
    const status = await fal.queue.status(model, { requestId: id });
    if (status.status !== "COMPLETED") return json({ done: false, status: status.status });

    const { data } = await fal.queue.result(model, { requestId: id });

    if (stage === "voice") {
      const words = wordsFromTimestamps(data.timestamps);
      const duration = words.length ? words[words.length - 1].end : 0;
      return json({ done: true, audioUrl: data.audio.url, words, duration, tooLong: duration > MAX_SECONDS });
    }
    return json({ done: true, videoUrl: data.video.url });
  } catch (err) {
    console.error(`${stage} status error`, err);
    // fal reports failed jobs as errors on status/result.
    return fail(stage === "voice" ? "The voice recording failed. Please try again." : "The animation failed. Please try again.", 502);
  }
};

export const config = { path: "/api/status" };
