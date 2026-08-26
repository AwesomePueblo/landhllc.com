// Deterministic template-based lyrics writer, used when ANTHROPIC_API_KEY
// isn't set or the API call fails. Keeps the game playable fully offline.
"use strict";

function clean(text) {
  return String(text || "").trim().replace(/\s+/g, " ");
}

function fallbackLyrics({ question, genre, answers }) {
  const lines = answers.map((a) => `${a.name} says: ${clean(a.text)}`);
  const title = `The Ballad of ${answers.map((a) => a.name).join(" & ")}`;

  const body = [];
  body.push("[Verse 1]");
  lines.slice(0, Math.ceil(lines.length / 2)).forEach((l) => body.push(l));
  body.push("");
  body.push("[Chorus]");
  body.push(`We asked the room, "${clean(question)}"`);
  body.push("And everybody answered, out of tune but true");
  body.push(`This is our ${genre} anthem, born right here tonight`);
  body.push("Turn it up and sing along, we're gonna be alright");
  body.push("");
  if (lines.length > 1) {
    body.push("[Verse 2]");
    lines.slice(Math.ceil(lines.length / 2)).forEach((l) => body.push(l));
    body.push("");
  }
  body.push("[Chorus]");
  body.push(`We asked the room, "${clean(question)}"`);
  body.push("And everybody answered, out of tune but true");
  body.push(`This is our ${genre} anthem, born right here tonight`);
  body.push("Turn it up and sing along, we're gonna be alright");

  return { title, body: body.join("\n") };
}

module.exports = { fallbackLyrics };
