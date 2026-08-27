// Claude wrapper: generates each round's set of related-but-different
// player prompts, and turns the players' answers into song lyrics. Both
// functions return { result: null } on any failure (missing key, network
// error, refusal) so the caller can fall back to the offline content banks
// - the game should never hard-fail a round just because the AI call
// didn't work.
//
// Every call also returns the raw request/response (or error) it made, so
// the server can surface them in the host's debug panel - useful for
// confirming a round actually came from Claude rather than the offline
// fallback banks.
"use strict";

const Anthropic = require("@anthropic-ai/sdk");

const MODEL = process.env.CLAUDE_MODEL || "claude-haiku-4-5";
// No output_config.effort here on purpose: Haiku 4.5 (the default) rejects
// it with a 400 ("This model does not support the effort parameter").
// Only Sonnet 5/Opus 5-tier models support it, and it's not required for
// these short prompt/lyrics calls - dropping it keeps one request shape
// that works regardless of which model CLAUDE_MODEL points at.

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

// Each player gets their OWN prompt (not a shared one) so their answers
// read as different beats of one story - Claude invents a shared scenario
// and writes one prompt per player about it, which the lyrics step later
// weaves into a single coherent song.
async function generateQuestionSet({ playerCount = 4, previousThemes = [] } = {}) {
  const c = getClient();
  if (!c) return { result: null };

  const n = Math.max(2, Math.min(playerCount, 8));
  const avoid = previousThemes.length
    ? `Don't reuse or closely resemble any of these already-used scenarios: ${previousThemes
        .map((t) => `"${t}"`)
        .join(", ")}.`
    : "";
  const request = {
    model: MODEL,
    max_tokens: 500,
    temperature: 1,
    system:
      `You write party-game prompts for a group of friends playing on their phones. ` +
      `Invent one silly shared scenario, then write ${n} DIFFERENT short prompts about ` +
      `that same scenario - one per player - so that when each person answers only their ` +
      `own prompt, the combined answers naturally read as one coherent, funny story that ` +
      `can be turned into a single song afterward. Keep every prompt short, safe for a ` +
      `mixed group, and answerable in one short sentence. Respond in EXACTLY this format, ` +
      `nothing else:\n` +
      `THEME: <short scenario name>\n` +
      `1. <prompt for player 1>\n` +
      `2. <prompt for player 2>\n` +
      `(one numbered line per prompt, exactly ${n} numbered lines, no extra commentary)`,
    messages: [
      {
        role: "user",
        content: `Group size: ${n} players. ${avoid}`,
      },
    ],
  };

  try {
    const message = await c.messages.create(request);
    const text = firstText(message);
    const themeMatch = text.match(/THEME:\s*(.*)/);
    const theme = themeMatch ? themeMatch[1].trim() : "";
    const questions = [...text.matchAll(/^\s*\d+[.)]\s*(.+)$/gm)].map((m) => m[1].trim());
    if (!theme || questions.length === 0) return { result: null, request, response: message };
    return { result: { theme, questions }, request, response: message };
  } catch (err) {
    console.error("[ai] generateQuestionSet failed:", err.message || err);
    return { result: null, request, error: err.message || String(err) };
  }
}

async function generateLyrics({ theme, genre, genreLabel, answers }) {
  const c = getClient();
  if (!c) return { result: null };

  const answerLines = answers
    .map((a) => `- ${a.name} was asked "${a.question}" and answered: "${a.text}"`)
    .join("\n");
  const request = {
    model: MODEL,
    max_tokens: 1200,
    system:
      `You are a witty songwriter for a party game. Players were each asked a different ` +
      `question about one shared scenario, and answered separately without seeing each ` +
      `other's answers. Given the scenario and everyone's question+answer pairs, write ` +
      `original, family-friendly, funny song lyrics in the ${genreLabel} genre that weave ` +
      `all the answers together into ONE coherent story about the scenario, in the order ` +
      `that makes it read as a single narrative. Use standard section labels like ` +
      `[Verse 1], [Chorus], [Verse 2], [Bridge]. Keep it tight - roughly 16-24 lines total. ` +
      `Respond in EXACTLY this format, nothing else:\n` +
      `TITLE: <song title>\n` +
      `---\n` +
      `<lyrics with section labels, one line per lyric line>`,
    messages: [
      {
        role: "user",
        content: `Scenario: "${theme}"\nGenre: ${genreLabel}\nPlayer prompts and answers:\n${answerLines}`,
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

module.exports = { isConfigured, generateQuestionSet, generateLyrics };
