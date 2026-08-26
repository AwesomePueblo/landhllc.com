// Pluggable "music generation" backend. The game asks this module for a
// track given lyrics + a genre and gets back a URL the browser can play.
//
// Only a "mock" provider ships here: a procedurally generated instrumental
// (lib/wavSynth.js), written to public/tracks/ and served statically. There
// is no widely available public API that turns arbitrary lyrics into a full
// sung track (services like Suno/Udio don't offer a simple public REST API
// today) - so real vocal song generation is deliberately left as a plug-in
// point rather than faked. To wire one in:
//
//   1. Add a branch below keyed by MUSIC_PROVIDER's value.
//   2. Call the provider's API, download the resulting audio file into
//      public/tracks/<id>.<ext>.
//   3. Return { url: "/tracks/<id>.<ext>", durationSeconds }.
//
// The rest of the game (state machine, synced playback) doesn't care which
// provider produced the file.
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { generateTrack } = require("./wavSynth");

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
  return { url: `/tracks/${filename}`, durationSeconds };
}

async function generateSong({ lyrics, genre }) {
  const provider = process.env.MUSIC_PROVIDER || "mock";
  switch (provider) {
    case "mock":
    default:
      return mockProvider({ lyrics, genre });
  }
}

module.exports = { generateSong };
