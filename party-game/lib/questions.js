// Fallback prompt bank, used when ANTHROPIC_API_KEY isn't set or the API
// call fails. Keeps the game playable fully offline.
//
// Each round now gives every player a DIFFERENT prompt sharing one theme,
// so their combined answers naturally tell one coherent story (see
// lib/ai.js generateQuestionSet). THEME_SETS is the offline equivalent -
// hand-written theme + related-prompts groups.
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

const THEME_SETS = [
  {
    theme: "a chaotic road trip",
    questions: [
      "What's the one snack you'd refuse to share on this trip?",
      "Who's most likely to get us hopelessly lost, and how?",
      "What's the worst song to get stuck on repeat for 6 hours straight?",
      "What's the real reason we'd have to pull over?",
    ],
  },
  {
    theme: "surviving a haunted house party",
    questions: [
      "What's the first thing you'd grab before running?",
      "Who screams first, and over what?",
      "What's your terrible plan for surviving the night?",
      "What ridiculous thing turns out to be the real monster?",
    ],
  },
  {
    theme: "throwing the world's worst wedding",
    questions: [
      "What's the most chaotic thing that happens during the vows?",
      "What's on the world's worst wedding playlist?",
      "Who gives the most unhinged toast?",
      "What's the real reason the cake gets ruined?",
    ],
  },
  {
    theme: "a heist gone hilariously wrong",
    questions: [
      "What's your role on the crew, and why are you bad at it?",
      "What's the one thing you steal that makes no sense to steal?",
      "What blows the whole plan?",
      "What's your terrible escape plan?",
    ],
  },
  {
    theme: "a reality TV dating show",
    questions: [
      "What's your entrance line walking onto the show?",
      "What's the most embarrassing thing revealed about you on camera?",
      "What ridiculous challenge do the contestants have to do?",
      "What's the dramatic reason for your exit?",
    ],
  },
  {
    theme: "surviving the office holiday party",
    questions: [
      "What's the white elephant gift nobody wants?",
      "Who says something they immediately regret at the mic?",
      "What's the real reason HR gets involved?",
      "What's on your holiday karaoke setlist?",
    ],
  },
];

// Cycles through the theme's prompts if there are more players than
// hand-written questions, so everyone still gets something.
function randomQuestionSet(n) {
  const set = THEME_SETS[Math.floor(Math.random() * THEME_SETS.length)];
  const count = Math.max(1, n);
  const questions = [];
  for (let i = 0; i < count; i++) questions.push(set.questions[i % set.questions.length]);
  return { theme: set.theme, questions };
}

module.exports = { QUESTIONS, randomQuestion, THEME_SETS, randomQuestionSet };
