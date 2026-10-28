// LLM wrapper: generates each round's set of related-but-different player
// prompts, and turns the players' answers into song lyrics. Every exported
// function returns { result: null } on any failure (not configured,
// unreachable, refusal) so the caller can fall back to the offline content
// banks - the game should never hard-fail a round just because the AI call
// didn't work.
//
// Two providers, picked with LLM_PROVIDER (same pattern as
// MUSIC_PROVIDER in lib/music.js):
//   - "anthropic" (default): Claude API, needs ANTHROPIC_API_KEY.
//   - "ollama": a local model served by `ollama serve` on the same
//     machine the party server runs on (OLLAMA_HOST, default
//     http://localhost:11434, and OLLAMA_MODEL, e.g. "llama3.1" - whatever
//     you've pulled with `ollama pull`). No API key, no per-call cost, no
//     internet required once the model's on disk - trades that for needing
//     a GPU/decent CPU to run at a usable speed.
//
// Both providers funnel through complete() below, which returns
// { text, request, response, error } using one shape regardless of
// provider, so the three functions below (and the server's debug panel)
// don't need to know which one is active.
"use strict";

const Anthropic = require("@anthropic-ai/sdk");

const PROVIDER = (process.env.LLM_PROVIDER || "anthropic").toLowerCase();

const MODEL = process.env.CLAUDE_MODEL || "claude-haiku-4-5";
// No output_config.effort here on purpose: Haiku 4.5 (the default) rejects
// it with a 400 ("This model does not support the effort parameter").
// Only Sonnet 5/Opus 5-tier models support it, and it's not required for
// these short prompt/lyrics calls - dropping it keeps one request shape
// that works regardless of which model CLAUDE_MODEL points at.

const OLLAMA_HOST = process.env.OLLAMA_HOST || "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "llama3.1";

let anthropicClient = null;
function getAnthropicClient() {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!anthropicClient) anthropicClient = new Anthropic();
  return anthropicClient;
}

function isConfigured() {
  if (PROVIDER === "ollama") return true; // no key to check - reachability is checked per-call
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

function firstText(message) {
  const block = message.content.find((b) => b.type === "text");
  return block ? block.text.trim() : "";
}

async function completeAnthropic({ system, messages, maxTokens, temperature }) {
  const c = getAnthropicClient();
  if (!c) return { text: null };

  const request = {
    model: MODEL,
    max_tokens: maxTokens,
    ...(temperature === undefined ? {} : { temperature }),
    system,
    messages,
  };
  try {
    const message = await c.messages.create(request);
    return { text: firstText(message), request, response: message };
  } catch (err) {
    return { text: null, request, error: err.message || String(err) };
  }
}

async function completeOllama({ system, messages, maxTokens, temperature }) {
  const request = {
    url: `${OLLAMA_HOST}/api/chat`,
    model: OLLAMA_MODEL,
    messages: [{ role: "system", content: system }, ...messages],
    stream: false,
    options: { temperature: temperature === undefined ? 1 : temperature, num_predict: maxTokens },
  };

  const controller = new AbortController();
  const timeoutMs = 60000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(request.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: request.model,
        messages: request.messages,
        stream: false,
        options: request.options,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const bodyText = await res.text().catch(() => "");
      return { text: null, request, error: `Ollama returned HTTP ${res.status}: ${bodyText.slice(0, 300)}` };
    }
    const data = await res.json();
    const text = ((data.message && data.message.content) || "").trim();
    return { text, request, response: data };
  } catch (err) {
    const msg =
      err.name === "AbortError"
        ? `request to Ollama timed out after ${timeoutMs / 1000}s - is "ollama serve" running at ${OLLAMA_HOST}?`
        : err.code === "ECONNREFUSED" || /ECONNREFUSED|fetch failed/.test(err.message || "")
        ? `couldn't reach Ollama at ${OLLAMA_HOST} - is "ollama serve" running?`
        : err.message || String(err);
    return { text: null, request, error: msg };
  } finally {
    clearTimeout(timeout);
  }
}

function complete(args) {
  return PROVIDER === "ollama" ? completeOllama(args) : completeAnthropic(args);
}

// Each player gets their OWN prompt (not a shared one) so their answers
// read as different beats of one story - the model invents a shared
// scenario and writes one prompt per player about it, which the lyrics
// step later weaves into a single coherent song.
async function generateQuestionSet({ playerCount = 4, previousThemes = [] } = {}) {
  if (!isConfigured()) return { result: null };

  const n = Math.max(2, Math.min(playerCount, 8));
  const avoid = previousThemes.length
    ? `Don't reuse or closely resemble any of these already-used scenarios: ${previousThemes
        .map((t) => `"${t}"`)
        .join(", ")}.`
    : "";
  const system =
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
    `(one numbered line per prompt, exactly ${n} numbered lines, no extra commentary)`;

  const { text, request, response, error } = await complete({
    system,
    messages: [{ role: "user", content: `Group size: ${n} players. ${avoid}` }],
    maxTokens: 500,
    temperature: 1,
  });
  if (!text) {
    if (error) console.error("[ai] generateQuestionSet failed:", error);
    return { result: null, request, response, error };
  }

  const themeMatch = text.match(/THEME:\s*(.*)/);
  const theme = themeMatch ? themeMatch[1].trim() : "";
  const questions = [...text.matchAll(/^\s*\d+[.)]\s*(.+)$/gm)].map((m) => m[1].trim());
  if (!theme || questions.length === 0) return { result: null, request, response };
  return { result: { theme, questions }, request, response };
}

async function generateLyrics({ theme, styleProfile, answers, mustInclude }) {
  if (!isConfigured()) return { result: null };

  const answerLines = answers
    .map((a) => `- ${a.name} was asked "${a.question}" and answered: "${a.text}"`)
    .join("\n");
  const style = styleProfile || {};
  const styleLines = [
    style.style && `Musical style: ${style.style}`,
    style.vocalGender && `Vocal delivery: ${style.vocalGender}`,
    style.weirdness && `Weirdness level: ${style.weirdness}`,
    style.styleInfluence && `Sounds like: ${style.styleInfluence}`,
  ].filter(Boolean).join("\n");

  // mustInclude is set on a retry, after a first attempt skipped someone -
  // every player who submitted an answer paid the same "wait for the
  // round" cost, so the lyrics should never quietly drop one of them.
  const inclusionNote = mustInclude && mustInclude.length
    ? `\n\nIMPORTANT: your previous attempt did not mention these players by name: ` +
      `${mustInclude.join(", ")}. This version MUST reference every single player by name ` +
      `and use their specific answer somewhere in the lyrics - do not omit anyone, even if a ` +
      `rhyme suffers for it.`
    : "";

  const system =
    `You are a witty songwriter for a party game. Players were each asked a different ` +
    `question about one shared scenario, and answered separately without seeing each ` +
    `other's answers. A separate group of players also crowd-sourced the song's style - ` +
    `treat their answers below as direct creative direction, even if they're silly or ` +
    `contradictory (lean into contradictions rather than ignoring them). Given the ` +
    `scenario, the style direction, and everyone's question+answer pairs, write original, ` +
    `family-friendly, funny song lyrics that weave all the answers together into ONE ` +
    `coherent story about the scenario, in the order that makes it read as a single ` +
    `narrative. EVERY player must be named at least once in the lyrics, with their specific ` +
    `answer referenced somewhere - nobody gets left out, even in a large group. Use standard ` +
    `section labels like [Verse 1], [Chorus], [Verse 2], [Bridge]. Keep it tight - roughly ` +
    `16-24 lines total (add more verses rather than dropping players if the group is large). ` +
    `Respond in EXACTLY this format, nothing else:\n` +
    `TITLE: <song title>\n` +
    `---\n` +
    `<lyrics with section labels, one line per lyric line>`;

  const { text, request, response, error } = await complete({
    system,
    messages: [
      {
        role: "user",
        content: `Scenario: "${theme}"\nStyle direction:\n${styleLines || "(none given - use your own judgment)"}\nPlayer prompts and answers:\n${answerLines}${inclusionNote}`,
      },
    ],
    maxTokens: 1200,
  });
  if (!text) {
    if (error) console.error("[ai] generateLyrics failed:", error);
    return { result: null, request, response, error };
  }

  const [, titlePart, bodyPart] = text.match(/TITLE:\s*(.*?)\s*\n---\s*\n([\s\S]*)/) || [];
  if (!bodyPart) return { result: null, request, response };
  return { result: { title: titlePart.trim() || "Untitled", body: bodyPart.trim() }, request, response };
}

// Players are asked to "name an artist, band, or era" for the song's
// influence, and that raw name gets used directly in lyrics generation
// (a text-writing context - fine). But ElevenLabs' music API explicitly
// disallows copyrighted artist/band names in its style prompts, and
// passing one straight through caused a real "violated our Terms of
// Service" rejection. This paraphrases the reference into generic
// descriptive language (instrumentation, era, mood, vocal style) with no
// proper nouns, so the influence still shapes the generated music safely.
async function describeInfluence({ styleInfluence }) {
  if (!isConfigured() || !styleInfluence) return { result: null };

  const system =
    `You describe a musical influence in plain, generic descriptive terms - ` +
    `instrumentation, era, tempo, mood, vocal style - so it can be used safely as a ` +
    `music-generation style prompt. NEVER include the artist's name, band name, song ` +
    `titles, or any other trademarked/copyrighted proper noun, even though one is given to ` +
    `you - describe only the SOUND, in your own words, as one short phrase under 15 words. ` +
    `If you don't recognize the reference, describe it as a generic, era-appropriate style ` +
    `based on any clues in the text. Reply with ONLY the descriptive phrase - no quotes, no ` +
    `preamble, no the artist's name anywhere in your answer.`;

  const { text: raw, request, response, error } = await complete({
    system,
    messages: [{ role: "user", content: `Influence: "${styleInfluence}"` }],
    maxTokens: 150,
    temperature: 0.7,
  });
  if (!raw) {
    if (error) console.error("[ai] describeInfluence failed:", error);
    return { result: null, request, response, error };
  }

  const text = raw.replace(/^["']|["']$/g, "");
  // Defensive check: models don't always follow "never say the name"
  // instructions perfectly. If the paraphrase still contains the
  // original reference (or a word from it), treat it as failed rather
  // than risk sending a name through to ElevenLabs after all.
  const leaked = String(styleInfluence)
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 3)
    .some((word) => text.toLowerCase().includes(word));
  if (!text || leaked) {
    return { result: null, request, response, error: leaked ? "paraphrase still contained the original name" : undefined };
  }
  return { result: text, request, response };
}

module.exports = { isConfigured, generateQuestionSet, generateLyrics, describeInfluence };
