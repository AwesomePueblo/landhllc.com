// The song's style is no longer a single host-picked dropdown value - it's
// crowd-sourced. Each round, these 4 fixed questions get distributed among
// the connected players (see assignGenreQuestions), and their answers are
// combined into a style profile that steers both lyric-writing and music
// generation (lib/ai.js, lib/music.js).
"use strict";

const GENRE_QUESTIONS = [
  { key: "style", label: "Style", question: "What music style should this song be? (e.g. pop, metal, lo-fi, country, jazz...)" },
  { key: "vocalGender", label: "Vocal", question: "What kind of voice should sing it? (e.g. male, female, choir, robotic, whispered...)" },
  { key: "weirdness", label: "Weirdness", question: "How weird should this song be - totally normal, or completely unhinged?" },
  { key: "styleInfluence", label: "Influence", question: "Name an artist, band, or era this should sound like." },
];

// Assigns the 4 fixed questions across however many players are connected.
//   - playerCount >= 4: one question per player, cycling through the set -
//     repeats happen naturally once playerCount exceeds the question count.
//   - playerCount < 4: the question set is split across the few players as
//     evenly as possible (a solo player gets all 4).
// Returns a Map<playerId, GENRE_QUESTIONS[]> - each player's assigned list
// (never empty, since every branch assigns something to every player).
function assignGenreQuestions(playerIds) {
  const n = playerIds.length;
  const byPlayer = new Map(playerIds.map((id) => [id, []]));
  if (n === 0) return byPlayer;

  if (n >= GENRE_QUESTIONS.length) {
    playerIds.forEach((id, i) => {
      byPlayer.get(id).push(GENRE_QUESTIONS[i % GENRE_QUESTIONS.length]);
    });
  } else {
    GENRE_QUESTIONS.forEach((gq, i) => {
      byPlayer.get(playerIds[i % n]).push(gq);
    });
  }
  return byPlayer;
}

// Merges however many raw answers a given question key received (1 if
// playerCount >= 4, possibly more if it was asked to multiple players)
// into one final value for the style profile.
function combineAnswers(texts) {
  const cleaned = texts.map((t) => String(t || "").trim()).filter(Boolean);
  if (cleaned.length === 0) return "";
  const distinct = [...new Set(cleaned.map((t) => t.toLowerCase()))].map(
    (lower) => cleaned.find((t) => t.toLowerCase() === lower)
  );
  if (distinct.length === 1) return distinct[0];
  return distinct.join(" and ");
}

module.exports = { GENRE_QUESTIONS, assignGenreQuestions, combineAnswers };
