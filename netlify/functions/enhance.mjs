import Anthropic from "@anthropic-ai/sdk";
import { json, fail, readJson, sign, countWords } from "../lib/shared.mjs";
import { JOTPSYCH_FACTS } from "../lib/facts.mjs";

const anthropic = new Anthropic({ timeout: 9000, maxRetries: 0 });

// Spoken whenever the input isn't about a JotPsych feature. ~17s in the Matilda voice.
const FALLBACK_SCRIPT =
  "Let’s get back to what matters. JotPsych is an AI scribe built for behavioral health. It listens to your sessions and turns them into clear, complete notes, so you can spend less time on documentation and more time with your patients. JotPsych. Less charting, more caring.";

// The longest original text we'll let someone keep verbatim: ~50 words is about 20 seconds of speech.
const MAX_REVERT_WORDS = 50;

const SYSTEM = `You write the lines for JotPsych's mascot: a cuddly plush bear in a midnight-blue sweater, standing in a cozy therapy office by the fireplace. JotPsych is an AI scribe and practice platform for behavioral health clinicians.

You receive text someone typed about a JotPsych feature. It may be a rough description or a draft script. Turn it into what the bear says out loud in a short vertical video. Do two jobs.

JOB 1: GUARDRAILS. Before writing, check the input for problems. Report each one in "issues".
- "phi": protected health information or patient details: patient names, initials tied to a case, dates of birth, addresses, phone numbers, emails, record or insurance ID numbers, specific diagnoses or medications tied to a person, or a story about an identifiable patient. Remove it entirely; speak only in general terms.
- "accuracy": ONLY (a) a statement the JotPsych facts below directly contradict, or (b) a statistic, number, percentage, guarantee, certification, award, or customer claim that the facts do not state. Remove or correct it using only the facts. Never invent numbers.
- "confidential": internal or non-public information (unreleased plans, internal metrics, customer or employee names, pricing deals). Remove it.
Be careful not to over-flag. These are NOT issues: a feature the facts don't mention, a feature described in different words or more specific detail than the facts, a definition or explanation the person added, or general benefits like "fewer denials" or "less typing". When in doubt, it is not an issue: describe what the person typed. Most inputs have no issues.
Each reason is one short plain sentence.

JOB 2: VOICE AND TONE.
- Warm, welcoming, soothing, and gently playful. A kind friend, not a comedian: no jokes, puns, or sarcasm.
- Speak directly to clinicians as "you". Explain what the feature does and why it helps.
- Open with a fresh line about the moment the feature helps with. Do not start with "Hello, friend" or a generic greeting.
- {WORDS} words in total, never more. It is read aloud in about 20 seconds.
- Plain spoken sentences: no emojis, hashtags, stage directions, brackets, or markdown.
- End with exactly: "JotPsych. Less charting, more caring."
- Keep the person's own wording where it already works; change what the guardrails or tone require.

If the input is not about JotPsych, clinical documentation, billing, or practice software (empty, random, rude, or off-topic), set on_topic to false, leave issues empty and script empty.

JotPsych facts (from jotpsych.com):
${JOTPSYCH_FACTS}

Reply with only JSON:
{"on_topic": true, "issues": [{"type": "phi" | "accuracy" | "confidential", "text": "the exact problem words from the input", "reason": "short, plain reason"}], "script": "..."}`;

export default async (req) => {
  if (req.method !== "POST") return fail("Use POST", 405);
  const { text: raw, shorter } = await readJson(req);
  const original = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "";
  if (!original) return fail("Describe a JotPsych feature first.");
  if (original.length > 600) return fail("Please keep it under 600 characters.");

  let result;
  try {
    const msg = await anthropic.messages.create({
      model: "claude-sonnet-5-5",
      max_tokens: 800,
      thinking: { type: "between_tools" }, // no extended thinking: keeps the call within a few seconds
      system: SYSTEM.replace("{WORDS}", shorter ? "30 to 36" : "38 to 45"),
      messages: [{ role: "user", content: `<input>${original}</input>` }],
    });
    const body = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    result = JSON.parse(body.slice(body.indexOf("{"), body.lastIndexOf("}") + 1));
  } catch (err) {
    console.error("enhance error", err);
    return fail("We couldn't enhance the script just now. Please press Enhance again.", 502);
  }

  const script = typeof result.script === "string" ? clean(result.script) : "";
  const onTopic = Boolean(result.on_topic && script);
  const issues = onTopic && Array.isArray(result.issues) ? result.issues.filter(validIssue).map(tidyIssue) : [];

  // Reverting is only allowed when the changes were purely about voice and tone.
  let blocked = null;
  if (!onTopic) blocked = "off_topic";
  else if (issues.length) blocked = "guardrail";
  else if (countWords(original) > MAX_REVERT_WORDS) blocked = "too_long";

  const finalScript = onTopic ? script : FALLBACK_SCRIPT;
  return json({
    original,
    script: finalScript,
    scriptSig: sign(finalScript),
    originalSig: blocked ? null : sign(original),
    blocked,
    issues,
  });
};

const clean = (s) => s.replace(/[*_#\[\]]/g, "").replace(/\s+/g, " ").trim();
const TYPES = ["phi", "accuracy", "confidential"];
const validIssue = (i) => i && TYPES.includes(i.type);
const tidyIssue = (i) => ({ type: i.type, reason: String(i.reason || "").slice(0, 240) });

export const config = { path: "/api/enhance" };
