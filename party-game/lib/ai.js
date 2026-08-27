// Claude wrapper: generates the party prompt/question each round, and turns
// the players' answers into song lyrics. Both functions return { result: null }
// on any failure (missing key, network error, refusal) so the caller can fall
// back to the offline content banks - the game should never hard-fail a round
// just because the AI call didn't work.
//
// Every call also returns the raw request/response (or error) it made, so
// the server can surface them in the host's debug panel - useful for
// confirming a round actually came from Claude rather than the offline
// fallback banks.
"use strict";

const Anthropic = require("@anthropic-ai/sdk");

const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-5";

let client = null;
function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!client) client = new Anthropic();
  return client;
}

function isConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

function firstText(message) {
  const block = message.content.find((b) => b.type === "text");
  return block ? block.text.trim() : "";
}

// A generic "give me a silly party prompt" request has an obvious generic
// answer (a wedding running late, missing the bus, etc.) that Claude tends
// to converge on every time, especially right after a server restart when
// there's no previousQuestions history yet to steer away from it. Picking
// a random theme per call breaks that convergence regardless of history.
const QUESTION_THEMES = [
  "childhood memories",
  "embarrassing moments",
  "superpowers or magic",
  "weird food combinations",
  "workplace or school mishaps",
  "family gatherings",
  "travel disasters",
  "first impressions",
  "hidden talents",
  "roommate or neighbor drama",
  "pets or animals",
  "technology going wrong",
  "conspiracy theories (silly, not real ones)",
  "fashion choices",
  "secret identities",
];

async function generateQuestion({ previousQuestions = [] } = {}) {
  const c = getClient();
  if (!c) return { result: null };

  const theme = QUESTION_THEMES[Math.floor(Math.random() * QUESTION_THEMES.length)];
  const avoid = previousQuestions.length
    ? `Don't repeat or closely resemble any of these already-used prompts: ${previousQuestions
        .map((q) => `"${q}"`)
        .join(", ")}.`
    : "";
  const request = {
    model: MODEL,
    max_tokens: 300,
    temperature: 1,
    output_config: { effort: "low" },
    system:
      "You write a single short, funny, party-game prompt. It will be shown to a group of friends on their phones; each of them types a short answer, and those answers get woven into song lyrics afterward. Keep it silly, inclusive, safe for a mixed group, and answerable in one short sentence. Reply with ONLY the prompt text itself - no quotes, no preamble, no label.",
    messages: [
      {
        role: "user",
        content: `Give me one new party prompt for this round, themed loosely around: ${theme}. ${avoid}`,
      },
    ],
  };

  try {
    const message = await c.messages.create(request);
    const text = firstText(message).replace(/^["']|["']$/g, "");
    return { result: text || null, request, response: message };
  } catch (err) {
    console.error("[ai] generateQuestion failed:", err.message || err);
    return { result: null, request, error: err.message || String(err) };
  }
}

async function generateLyrics({ question, genre, genreLabel, answers }) {
  const c = getClient();
  if (!c) return { result: null };

  const answerLines = answers.map((a) => `- ${a.name}: "${a.text}"`).join("\n");
  const request = {
    model: MODEL,
    max_tokens: 1200,
    output_config: { effort: "medium" },
    system:
      `You are a witty songwriter for a party game. Given a prompt and a list of ` +
      `players' short answers, write original, family-friendly, funny song lyrics ` +
      `in the ${genreLabel} genre that weave in as many players' names and answers as ` +
      `you naturally can. Use standard section labels like [Verse 1], [Chorus], ` +
      `[Verse 2], [Bridge]. Keep it tight - roughly 16-24 lines total. ` +
      `Respond in EXACTLY this format, nothing else:\n` +
      `TITLE: <song title>\n` +
      `---\n` +
      `<lyrics with section labels, one line per lyric line>`,
    messages: [
      {
        role: "user",
        content: `Prompt: "${question}"\nGenre: ${genreLabel}\nAnswers:\n${answerLines}`,
      },
    ],
  };

  try {
    const message = await c.messages.create(request);
    const text = firstText(message);
    const [, titlePart, bodyPart] = text.match(/TITLE:\s*(.*?)\s*\n---\s*\n([\s\S]*)/) || [];
    if (!bodyPart) return { result: null, request, response: message };
    return {
      result: { title: titlePart.trim() || "Untitled", body: bodyPart.trim() },
      request,
      response: message,
    };
  } catch (err) {
    console.error("[ai] generateLyrics failed:", err.message || err);
    return { result: null, request, error: err.message || String(err) };
  }
}

module.exports = { isConfigured, generateQuestion, generateLyrics };
