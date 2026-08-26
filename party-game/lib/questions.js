// Fallback prompt bank, used when ANTHROPIC_API_KEY isn't set or the API
// call fails. Keeps the game playable fully offline.
"use strict";

const QUESTIONS = [
  "What's the most ridiculous thing you'd do for a free burrito?",
  "What would your autobiography be titled if you were brutally honest?",
  "What's a lie you told as a kid that spiraled out of control?",
  "If your pet could talk, what's the first thing they'd complain about?",
  "What's the weirdest thing you've ever done to impress someone?",
  "What's your go-to excuse for being late?",
  "What superpower would you absolutely ruin for everyone else?",
  "What's the most chaotic thing that could happen at this party right now?",
  "What's a household item that deserves its own theme song?",
  "What's the worst advice you've ever confidently given?",
  "What would you name your villain origin story?",
  "What's something you'd 100% do if nobody was watching?",
  "What's the strangest thing you've ever eaten on a dare?",
  "If you had a warning label, what would it say?",
  "What's the most Monday thing that's ever happened to you on a Friday?",
];

function randomQuestion() {
  return QUESTIONS[Math.floor(Math.random() * QUESTIONS.length)];
}

module.exports = { QUESTIONS, randomQuestion };
