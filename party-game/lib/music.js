// Pluggable "music generation" backend. The game asks this module for a
// track given lyrics + the crowd-sourced style profile (see
// lib/genreQuestions.js) and gets back a URL the browser can play.
//
// Two providers ship here:
//   - "mock" (default): a procedurally generated instrumental
//     (lib/wavSynth.js), written to public/tracks/ and served statically.
//     Works fully offline, zero API keys, zero cost. It needs a discrete
//     preset (tempo/key/chords), so styleProfile.style gets matched to the
//     closest of the 8 built-in genres (lib/genrePresets.js).
//   - "elevenlabs": calls ElevenLabs' Eleven Music API
//     (https://elevenlabs.io/docs/api-reference/music/compose) with the
//     actual generated lyrics and the players' own free-text style answers
//     (no need to match them to a fixed genre - the real API just takes
//     descriptive style tags). Requires ELEVENLABS_API_KEY and a paid
//     ElevenLabs plan (music generation costs credits - see their pricing
//     page).
//
// Every provider returns { result, request, response, error } so the
// caller can log the raw request/response for the host's debug panel, the
// same pattern lib/ai.js uses. `result` is null on any failure so the
// caller can fall back to the mock provider - a round should never hard-
// fail just because a paid API call didn't work.
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { generateTrack } = require("./wavSynth");
const { getGenre, matchGenreFromText } = require("./genrePresets");

const TRACKS_DIR = path.join(__dirname, "..", "public", "tracks");
const TRACK_SECONDS = Number(process.env.TRACK_SECONDS) || 60;
// Floor on how long each lyric section gets in the ElevenLabs composition
// plan. Dividing a short total (e.g. the old 26s default) across ~4
// sections left ~6.5s each - not enough time to actually sing a section's
// lines, which is why generated tracks sounded truncated and didn't use
// the full lyrics. This guarantees real singing time per section
// regardless of how TRACK_SECONDS is configured.
const MIN_SECTION_MS = 14000;

async function mockProvider({ styleProfile }) {
  const genreId = matchGenreFromText(styleProfile && styleProfile.style);
  const { buffer, durationSeconds } = generateTrack({
    genreId,
    seconds: TRACK_SECONDS,
  });
  const id = crypto.randomBytes(6).toString("hex");
  const filename = `${id}.wav`;
  fs.mkdirSync(TRACKS_DIR, { recursive: true });
  fs.writeFileSync(path.join(TRACKS_DIR, filename), buffer);
  return { result: { url: `/tracks/${filename}`, durationSeconds } };
}

// Splits lyrics body text into [SectionLabel]/lines groups, matching the
// format lib/ai.js and lib/fallbackLyrics.js both already produce.
function parseLyricsSections(body) {
  const sections = [];
  let current = null;
  for (const raw of String(body || "").split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (/^\[.*\]$/.test(line)) {
      current = { label: line, lines: [] };
      sections.push(current);
    } else if (current) {
      current.lines.push(line);
    } else {
      current = { label: "[Verse 1]", lines: [line] };
      sections.push(current);
    }
  }
  return sections;
}

// Turns the players' crowd-sourced style answers into ElevenLabs style
// tags, falling back to the matched discrete genre's canned tags for
// anything the players didn't actually answer.
//
// Deliberately excludes styleInfluence (the "name an artist/band/era"
// answer): ElevenLabs' own docs say a composition's style prompt "cannot
// include copyrighted artist/band names," and passing a real artist name
// straight through (e.g. "influenced by Nirvana") is exactly what tripped
// a real "bad_composition_plan / violated our Terms of Service" 400 in
// testing. It's still used for lyrics generation (lib/ai.js), which is a
// text-writing context, not a music-generation one, and isn't subject to
// the same restriction.
function buildPositiveStyles(styleProfile) {
  const sp = styleProfile || {};
  const fromPlayers = [
    sp.style,
    sp.vocalGender && `${sp.vocalGender} vocals`,
    sp.weirdness && `${sp.weirdness} vibe`,
  ].filter(Boolean);
  const genreId = matchGenreFromText(sp.style);
  const preset = getGenre(genreId);
  const combined = [...fromPlayers, ...(preset.styles || [])];
  return [...new Set(combined)].slice(0, 12);
}

async function elevenlabsProvider({ lyrics, styleProfile }) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return { error: "MUSIC_PROVIDER=elevenlabs but ELEVENLABS_API_KEY is not set" };
  }

  const sections = parseLyricsSections(lyrics);
  if (sections.length === 0) {
    return { error: "no lyrics sections to compose from" };
  }

  const positiveStyles = buildPositiveStyles(styleProfile);
  const targetMs = Math.max(TRACK_SECONDS * 1000, sections.length * MIN_SECTION_MS);
  const perChunkMs = Math.min(120000, Math.round(targetMs / sections.length));
  const chunks = sections.map((s) => ({
    text: [s.label, ...s.lines].join("\n"),
    duration_ms: perChunkMs,
    positive_styles: positiveStyles,
    context_adherence: "high",
  }));

  const request = {
    url: "https://api.elevenlabs.io/v1/music",
    method: "POST",
    body: { composition_plan: { chunks }, model_id: "music_v2" },
  };

  const controller = new AbortController();
  const timeoutMs = 90000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(request.url, {
      method: "POST",
      headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify(request.body),
      signal: controller.signal,
    });
  } catch (err) {
    const msg = err.name === "AbortError" ? `request timed out after ${timeoutMs / 1000}s` : err.message || String(err);
    return { error: `network error calling ElevenLabs: ${msg}`, request };
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    const bodyText = await res.text().catch(() => "");
    return {
      error: `ElevenLabs API returned HTTP ${res.status}: ${bodyText.slice(0, 500)}`,
      request,
      response: { status: res.status, body: bodyText.slice(0, 500) },
    };
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  const id = crypto.randomBytes(6).toString("hex");
  const filename = `${id}.mp3`;
  fs.mkdirSync(TRACKS_DIR, { recursive: true });
  fs.writeFileSync(path.join(TRACKS_DIR, filename), buffer);

  const durationSeconds = Math.round((chunks.length * perChunkMs) / 1000);
  return {
    result: { url: `/tracks/${filename}`, durationSeconds },
    request,
    response: { status: res.status, bytes: buffer.length },
  };
}

async function generateSong({ lyrics, styleProfile }) {
  const provider = process.env.MUSIC_PROVIDER || "mock";
  switch (provider) {
    case "elevenlabs": {
      const out = await elevenlabsProvider({ lyrics, styleProfile });
      if (out.result) return out;
      console.error("[music] elevenlabs provider failed, falling back to mock:", out.error);
      const fallback = await mockProvider({ styleProfile });
      return { ...fallback, request: out.request, response: out.response, error: out.error, usedFallback: true };
    }
    case "mock":
    default:
      return mockProvider({ styleProfile });
  }
}

module.exports = { generateSong };
