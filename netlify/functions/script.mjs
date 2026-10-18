import Anthropic from "@anthropic-ai/sdk";
import { json, fail, readJson } from "../lib/shared.mjs";

const anthropic = new Anthropic({ timeout: 8000, maxRetries: 1 });

// Spoken whenever the input isn't about a JotPsych feature. ~17s in the Matilda voice.
export const FALLBACK_SCRIPT =
  "Let’s get back to what matters. JotPsych is an AI scribe built for behavioral health. It listens to your sessions and turns them into clear, complete notes, so you can spend less time on documentation and more time with your patients. JotPsych. Less charting, more caring.";

const SYSTEM = `You write the lines for JotPsych's mascot: a cuddly plush bear in a midnight-blue sweater, standing in a cozy therapy office by the fireplace. JotPsych is an AI scribe built for behavioral health clinicians.

You receive a description of a JotPsych feature. Write what the bear says, out loud, in a short vertical video about that feature.

Voice and tone:
- Warm, welcoming, soothing, and gently playful. Think a kind friend, not a comedian. No jokes, puns, or sarcasm.
- Speak directly to clinicians as "you".
- Explain what the feature does and why it helps, using only what the description says. Do not invent numbers, claims, certifications, or features.

Format:
- {WORDS} words in total, never more. It is read aloud in about 20 seconds.
- Plain spoken sentences only: no emojis, hashtags, stage directions, brackets, or markdown.
- End with exactly: "JotPsych. Less charting, more caring."

If the input is not a description of a JotPsych or clinical-software feature (it is empty, random, rude, or about something else), set on_topic to false and leave script empty.

Reply with only JSON: {"on_topic": true, "script": "..."}`;

export default async (req) => {
  if (req.method !== "POST") return fail("Use POST", 405);
  const { feature, shorter } = await readJson(req);
  const text = typeof feature === "string" ? feature.trim() : "";
  if (!text) return fail("Describe a JotPsych feature first.");
  if (text.length > 600) return fail("Please keep the description under 600 characters.");

  let result;
  try {
    const msg = await anthropic.messages.create({
      model: "claude-sonnet-5-5",
      max_tokens: 600,
      thinking: { type: "between_tools" }, // no extended thinking: keeps the call within a few seconds
      system: SYSTEM.replace("{WORDS}", shorter ? "30 to 36" : "38 to 45"),
      messages: [{ role: "user", content: `<feature>${text}</feature>` }],
    });
    const body = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    result = JSON.parse(body.slice(body.indexOf("{"), body.lastIndexOf("}") + 1));
  } catch (err) {
    console.error("script error", err);
    return fail("We couldn't write the script just now. Please try again.", 502);
  }

  const script = typeof result.script === "string" ? clean(result.script) : "";
  if (!result.on_topic || !script) return json({ script: FALLBACK_SCRIPT, onTopic: false });
  return json({ script, onTopic: true });
};

const clean = (s) => s.replace(/[*_#\[\]]/g, "").replace(/\s+/g, " ").trim();

export const config = { path: "/api/script" };
