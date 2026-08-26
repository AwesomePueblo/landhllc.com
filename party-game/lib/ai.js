// Claude wrapper: generates the party prompt/question each round, and turns
// the players' answers into song lyrics. Both functions return null on any
// failure (missing key, network error, refusal) so the caller can fall back
// to the offline content banks - the game should never hard-fail a round
// just because the AI call didn't work.
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

async function generateQuestion({ previousQuestions = [] } = {}) {
  const c = getClient();
  if (!c) return null;
  try {
    const avoid = previousQuestions.length
      ? `Don't repeat or closely resemble any of these already-used prompts: ${previousQuestions
          .map((q) => `"${q}"`)
          .join(", ")}.`
      : "";
    const message = await c.messages.create({
      model: MODEL,
      max_tokens: 300,
      output_config: { effort: "low" },
      system:
        "You write a single short, funny, party-game prompt. It will be shown to a group of friends on their phones; each of them types a short answer, and those answers get woven into song lyrics afterward. Keep it silly, inclusive, safe for a mixed group, and answerable in one short sentence. Reply with ONLY the prompt text itself - no quotes, no preamble, no label.",
      messages: [
        {
          role: "user",
          content: `Give me one new party prompt for this round. ${avoid}`,
        },
      ],
    });
    const text = firstText(message).replace(/^["']|["']$/g, "");
    return text || null;
  } catch (err) {
    console.error("[ai] generateQuestion failed:", err.message || err);
    return null;
  }
}

async function generateLyrics({ question, genre, genreLabel, answers }) {
  const c = getClient();
  if (!c) return null;
  try {
    const answerLines = answers
      .map((a) => `- ${a.name}: "${a.text}"`)
      .join("\n");
    const message = await c.messages.create({
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
    });
    const text = firstText(message);
    const [, titlePart, bodyPart] = text.match(/TITLE:\s*(.*?)\s*\n---\s*\n([\s\S]*)/) || [];
    if (!bodyPart) return null;
    return { title: titlePart.trim() || "Untitled", body: bodyPart.trim() };
  } catch (err) {
    console.error("[ai] generateLyrics failed:", err.message || err);
    return null;
  }
}

module.exports = { isConfigured, generateQuestion, generateLyrics };
