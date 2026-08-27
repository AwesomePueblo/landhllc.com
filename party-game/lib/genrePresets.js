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
  },
};

const GENRE_LIST = Object.keys(GENRES);

function getGenre(id) {
  return GENRES[id] || GENRES.pop;
}

module.exports = { GENRES, GENRE_LIST, getGenre };
