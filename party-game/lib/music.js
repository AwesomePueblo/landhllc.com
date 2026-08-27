// Pluggable "music generation" backend. The game asks this module for a
// track given lyrics + a genre and gets back a URL the browser can play.
//
// Two providers ship here:
//   - "mock" (default): a procedurally generated instrumental
//     (lib/wavSynth.js), written to public/tracks/ and served statically.
//     Works fully offline, zero API keys, zero cost.
//   - "elevenlabs": calls ElevenLabs' Eleven Music API
//     (https://elevenlabs.io/docs/api-reference/music/compose) with the
//     actual generated lyrics, producing a real sung vocal track in the
//     chosen genre. Requires ELEVENLABS_API_KEY and a paid ElevenLabs plan
//     (music generation costs credits - see their pricing page).
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
const { getGenre } = require("./genrePresets");

const TRACKS_DIR = path.join(__dirname, "..", "public", "tracks");
const TRACK_SECONDS = Number(process.env.TRACK_SECONDS) || 26;

async function mockProvider({ genre }) {
  const { buffer, durationSeconds } = generateTrack({
    genreId: genre,
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

async function elevenlabsProvider({ lyrics, genre, genreLabel }) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return { error: "MUSIC_PROVIDER=elevenlabs but ELEVENLABS_API_KEY is not set" };
  }

  const preset = getGenre(genre);
  const sections = parseLyricsSections(lyrics);
  if (sections.length === 0) {
    return { error: "no lyrics sections to compose from" };
  }

  const targetMs = TRACK_SECONDS * 1000;
  const perChunkMs = Math.max(3000, Math.min(120000, Math.round(targetMs / sections.length)));
  const chunks = sections.map((s) => ({
    text: [s.label, ...s.lines].join("\n"),
    duration_ms: perChunkMs,
    positive_styles: preset.styles || [genreLabel],
    context_adherence: "high",
  }));

  const request = {
    url: "https://api.elevenlabs.io/v1/music",
    method: "POST",
    body: { composition_plan: { chunks }, model_id: "music_v2" },
  };

  let res;
  try {
    res = await fetch(request.url, {
      method: "POST",
      headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify(request.body),
    });
  } catch (err) {
    return { error: `network error calling ElevenLabs: ${err.message || err}`, request };
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

async function generateSong({ lyrics, genre, genreLabel }) {
  const provider = process.env.MUSIC_PROVIDER || "mock";
  switch (provider) {
    case "elevenlabs": {
      const out = await elevenlabsProvider({ lyrics, genre, genreLabel });
      if (out.result) return out;
      console.error("[music] elevenlabs provider failed, falling back to mock:", out.error);
      const fallback = await mockProvider({ genre });
      return { ...fallback, request: out.request, response: out.response, error: out.error, usedFallback: true };
    }
    case "mock":
    default:
      return mockProvider({ genre });
  }
}

module.exports = { generateSong };
