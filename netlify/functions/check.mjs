import Anthropic from "@anthropic-ai/sdk";
import { json, fail, readJson, sign, countWords } from "../lib/shared.mjs";
import { JOTPSYCH_FACTS } from "../lib/facts.mjs";

const anthropic = new Anthropic({ timeout: 9000, maxRetries: 0 });

// Text Tomo says as-is must fit in about 20 seconds.
const MAX_WORDS = 50;

const SYSTEM = `You review a script that JotPsych's mascot, Tomo the bear, will read aloud word for word in a short video. You do NOT rewrite it. You only decide whether it can be used exactly as written.

Report every problem in "issues":
- "phi": protected health information or patient details: patient names, initials tied to a case, dates of birth, addresses, phone numbers, emails, record or insurance ID numbers, specific diagnoses or medications tied to a person, or a story about an identifiable patient.
- "accuracy": ONLY (a) a statement the JotPsych facts below directly contradict, or (b) a statistic, number, percentage, guarantee, certification, award, or customer claim that the facts do not state.
- "confidential": internal or non-public information (unreleased plans, internal metrics, customer or employee names, pricing deals).
- "spelling": a misspelled word or an obvious typo or grammar slip that would sound wrong read aloud. Name the word and its fix.

Be careful not to over-flag. These are NOT issues: a feature the facts don't mention, a feature described in different words or more detail than the facts, general benefits like "fewer denials", casual or informal style, or a sentence you would phrase differently. When in doubt, it is not an issue.

If the text is not about JotPsych, clinical documentation, billing, or practice software (random, rude, or off-topic), set on_topic to false.

Each reason is one short plain sentence.

JotPsych facts (from jotpsych.com):
${JOTPSYCH_FACTS}

Reply with only JSON:
{"on_topic": true, "issues": [{"type": "phi" | "accuracy" | "confidential" | "spelling", "reason": "..."}]}`;

const TYPES = ["phi", "accuracy", "confidential", "spelling"];

export default async (req) => {
  if (req.method !== "POST") return fail("Use POST", 405);
  const { text: raw } = await readJson(req);
  const text = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "";
  if (!text) return fail("Write something to check first.");
  if (text.length > 600) return fail("Please keep it under 600 characters.");

  let result;
  try {
    const msg = await anthropic.messages.create({
      model: "claude-sonnet-5-5",
      max_tokens: 600,
      thinking: { type: "between_tools" }, // no extended thinking: keeps the call within a few seconds
      system: SYSTEM,
      messages: [{ role: "user", content: `<script>${text}</script>` }],
    });
    const body = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    result = JSON.parse(body.slice(body.indexOf("{"), body.lastIndexOf("}") + 1));
  } catch (err) {
    console.error("check error", err);
    return fail("We couldn't run the check just now. Please try again.", 502);
  }

  const issues = Array.isArray(result.issues)
    ? result.issues.filter((i) => i && TYPES.includes(i.type)).map((i) => ({ type: i.type, reason: String(i.reason || "").slice(0, 240) }))
    : [];
  if (!result.on_topic) issues.unshift({ type: "topic", reason: "This doesn't describe a JotPsych feature." });
  if (countWords(text) > MAX_WORDS)
    issues.push({ type: "length", reason: `It's ${countWords(text)} words; Tomo can say about ${MAX_WORDS} in 20 seconds.` });

  const passed = issues.length === 0;
  // Same signature as Enhance, so /api/voice accepts it. The page sends the text exactly as checked.
  return json({ passed, text, sig: passed ? sign(text) : null, issues });
};

export const config = { path: "/api/check" };
