// Genre presets for the built-in instrumental synthesizer (lib/wavSynth.js).
// `key` is a MIDI note number for the tonic. `chordProg` is a list of
// semitone offsets from `key` used as the chord root for each bar in the
// loop (a simple, genre-flavored progression - not meant to be music-
// theory-perfect, just distinct enough to feel like the right vibe).
"use strict";

const GENRES = {
  pop: {
    label: "Pop",
    tempo: 120,
    key: 60, // C4
    third: 4, // major
    chordProg: [0, 7, 9, 5], // I - V - vi - IV
    wave: "saw",
    kick: true,
    arpRate: 2, // notes per beat
    brightness: 1,
    styles: ["upbeat pop", "catchy vocal hook", "bright synths", "120 bpm", "polished production"],
  },
  rock: {
    label: "Rock",
    tempo: 138,
    key: 57, // A3
    third: 3, // minor
    chordProg: [0, 10, 8, 5], // i - VII - VI - iv
    wave: "square",
    kick: true,
    arpRate: 2,
    brightness: 1.1,
    styles: ["driving rock", "electric guitars", "live drums", "powerful vocals", "138 bpm"],
  },
  hiphop: {
    label: "Hip-Hop",
    tempo: 92,
    key: 55, // G3
    third: 3,
    chordProg: [0, 0, 10, 8], // i - i - VII - VI
    wave: "sine",
    kick: true,
    arpRate: 1,
    brightness: 0.7,
    styles: ["hip-hop", "boom bap drums", "rap vocal delivery", "deep 808 bass", "92 bpm"],
  },
  country: {
    label: "Country",
    tempo: 112,
    key: 62, // D4
    third: 4,
    chordProg: [0, 5, 9, 7], // I - IV - vi - V
    wave: "triangle",
    kick: true,
    arpRate: 2,
    brightness: 0.9,
    styles: ["country", "acoustic guitar", "twangy vocals", "storytelling", "112 bpm"],
  },
  edm: {
    label: "EDM",
    tempo: 128,
    key: 57,
    third: 3,
    chordProg: [0, 8, 10, 5], // i - VI - VII - iv
    wave: "saw",
    detune: true,
    kick: true,
    arpRate: 4,
    brightness: 1.3,
    styles: ["EDM", "festival build-up", "four-on-the-floor kick", "processed vocals", "128 bpm"],
  },
  lofi: {
    label: "Lo-fi",
    tempo: 80,
    key: 60,
    third: 3,
    chordProg: [0, 9, 5, 7], // i - VI - iv - V
    wave: "triangle",
    kick: false,
    arpRate: 1.5,
    brightness: 0.55,
    seventh: true,
    styles: ["lo-fi", "mellow vocals", "warm jazzy chords", "tape hiss", "relaxed 80 bpm"],
  },
  metal: {
    label: "Metal",
    tempo: 160,
    key: 52, // E3
    third: 3,
    chordProg: [0, 1, 8, 5], // i - bII - VI - iv (phrygian-ish)
    wave: "square",
    kick: true,
    arpRate: 3,
    brightness: 1.2,
    power: true,
    styles: ["heavy metal", "distorted guitars", "double kick drums", "aggressive vocals", "160 bpm"],
  },
  jazz: {
    label: "Jazz",
    tempo: 104,
    key: 60,
    third: 3,
    chordProg: [2, 7, 0, 0], // ii - V - i - i
    wave: "sine",
    kick: false,
    arpRate: 1.5,
    brightness: 0.65,
    seventh: true,
    styles: ["jazz", "smooth crooner vocals", "swung rhythm", "upright bass", "brushed drums"],
  },
};

const GENRE_LIST = Object.keys(GENRES);

function getGenre(id) {
  return GENRES[id] || GENRES.pop;
}

// Players now describe the song's style in free text (see
// lib/genreQuestions.js) rather than picking one of these IDs from a
// dropdown. The offline mock synth still needs a discrete preset to pick
// a tempo/key/chord progression, so this maps free text to the closest
// match by keyword, falling back to "pop". lib/music.js's ElevenLabs path
// doesn't need this - it sends the player's actual free-text style
// straight through instead.
const GENRE_ALIASES = {
  pop: ["pop"],
  rock: ["rock", "punk", "grunge", "alternative", "indie rock"],
  hiphop: ["hip hop", "hip-hop", "hiphop", "rap", "trap"],
  country: ["country", "folk", "bluegrass", "americana"],
  edm: ["edm", "electronic", "dance", "techno", "house", "dubstep", "trance"],
  lofi: ["lo-fi", "lofi", "lo fi", "chill", "ambient"],
  metal: ["metal", "hardcore", "screamo", "death metal"],
  jazz: ["jazz", "swing", "blues", "soul", "funk"],
};

function matchGenreFromText(text) {
  const lower = String(text || "").toLowerCase();
  for (const id of GENRE_LIST) {
    if ((GENRE_ALIASES[id] || []).some((alias) => lower.includes(alias))) return id;
  }
  return "pop";
}

module.exports = { GENRES, GENRE_LIST, getGenre, matchGenreFromText };
