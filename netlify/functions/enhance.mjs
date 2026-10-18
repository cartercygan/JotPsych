import Anthropic from "@anthropic-ai/sdk";
import { json, fail, readJson, sign, countWords } from "../lib/shared.mjs";
import { JOTPSYCH_FACTS } from "../lib/facts.mjs";

const anthropic = new Anthropic({ timeout: 9000, maxRetries: 0 });

// Spoken whenever the input isn't about a JotPsych feature. ~17s in the Matilda voice.
const FALLBACK_SCRIPT =
  "Let’s get back to what matters. JotPsych is an AI scribe built for behavioral health. It listens to your sessions and turns them into clear, complete notes, so you can spend less time on documentation and more time with your patients. JotPsych. Less charting, more caring.";

// The longest original text we'll let someone keep verbatim: ~70 words stays under the 30-second hard stop.
const MAX_REVERT_WORDS = 70;

const SYSTEM = `You write the lines for JotPsych's mascot: a cuddly plush bear in a midnight-blue sweater, standing in a cozy therapy office by the fireplace. JotPsych is an AI scribe and practice platform for behavioral health clinicians.

You receive text someone typed about a JotPsych feature. It may be a rough description or a draft script. Turn it into what the bear says out loud in a short vertical video. Do two jobs.

JOB 1: GUARDRAILS. Before writing, check the input for problems. Report each one in "issues".
- "phi": protected health information or patient details: patient names, initials tied to a case, dates of birth, addresses, phone numbers, emails, record or insurance ID numbers, specific diagnoses or medications tied to a person, or a story about an identifiable patient. Remove it entirely; speak only in general terms.
- "accuracy": ONLY (a) a statement the JotPsych facts below directly contradict, or (b) a statistic, number, percentage, guarantee, certification, award, or customer claim that the facts do not state. Remove or correct it using only the facts. Never invent numbers.
- "confidential": internal or non-public information (unreleased plans, internal metrics, customer or employee names, pricing deals). Remove it.
If <confirmed_facts> are given, the person has already verified those statistics and data points. Treat them as accurate: keep them in the script (you may rephrase around them, but keep the figures) and never report them as issues.
Be careful not to over-flag. These are NOT issues: a feature the facts don't mention, a feature described in different words or more specific detail than the facts, a definition or explanation the person added, or general benefits like "fewer denials" or "less typing". When in doubt, it is not an issue: describe what the person typed. Most inputs have no issues.
Each reason is one short plain sentence.

JOB 2: VOICE AND TONE. This is the person's message; you are polishing it for Tomo to say, not replacing it.
- Start from their text. Keep their key words, their specific details, and their order wherever they work. If it already reads well aloud, change very little.
- Make it sound spoken: warm, welcoming, soothing, and gently playful. A kind friend, not a comedian: no jokes, puns, or sarcasm. Speak to clinicians as "you".
- Mention JotPsych by name at least once, and make clear what the feature does and why it helps.
- Only add facts from the list below when they directly support what the person wrote. Do not pad it with other features or numbers they didn't mention.
- Let the structure follow their content. No fixed formula: no stock openers ("Here's something", "That moment when", "Imagine", "Picture this", "Hello, friend") and no slogan or tagline at the end. Close with a natural line that fits this particular feature.
- At most 45 words; it is read aloud in about 20 seconds. A short input can become a short script.
- Plain spoken sentences: no emojis, hashtags, stage directions, brackets, or markdown.

If the input is not about JotPsych, clinical documentation, billing, or practice software (empty, random, rude, or off-topic), set on_topic to false, leave issues empty and script empty.

JotPsych facts (from jotpsych.com):
${JOTPSYCH_FACTS}

Reply with only JSON:
{"on_topic": true, "issues": [{"type": "phi" | "accuracy" | "confidential", "text": "the exact problem words from the input", "reason": "short, plain reason"}], "script": "..."}`;

export default async (req) => {
  if (req.method !== "POST") return fail("Use POST", 405);
  const { text: raw, confirmedFacts } = await readJson(req);
  // Statistics the person confirmed via "Facts confirmed" on the Check step.
  const confirmed = Array.isArray(confirmedFacts)
    ? confirmedFacts.filter((f) => typeof f === "string" && f.trim()).slice(0, 10).map((f) => f.slice(0, 200))
    : [];
  const original = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "";
  if (!original) return fail("Describe a JotPsych feature first.");
  if (original.length > 600) return fail("Please keep it under 600 characters.");

  let result;
  try {
    const msg = await anthropic.messages.create({
      model: "claude-sonnet-5-5",
      max_tokens: 800,
      thinking: { type: "between_tools" }, // no extended thinking: keeps the call within a few seconds
      system: SYSTEM,
      messages: [{
        role: "user",
        content: `<input>${original}</input>` +
          (confirmed.length ? `\n<confirmed_facts>\n${confirmed.map((f) => `- ${f}`).join("\n")}\n</confirmed_facts>` : ""),
      }],
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
