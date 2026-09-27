// Small built-in demo dataset used when no TMDB_API_KEY is configured, so
// the app is fully click-through-able with zero setup. Deliberately
// fictional (not real movies/people) rather than a handful of hardcoded
// real-world facts that would go stale or read as "official" data.
"use strict";

const PEOPLE = {
  "-1": { id: -1, name: "Alex Rivera", biography: "Demo person. Add a TMDB_API_KEY to see real filmographies.", profilePath: null },
  "-2": { id: -2, name: "Jordan Blake", biography: "Demo person. Add a TMDB_API_KEY to see real filmographies.", profilePath: null },
  "-3": { id: -3, name: "Sam Okafor", biography: "Demo person. Add a TMDB_API_KEY to see real filmographies.", profilePath: null },
  "-4": { id: -4, name: "Priya Anand", biography: "Demo person. Add a TMDB_API_KEY to see real filmographies.", profilePath: null },
  "-5": { id: -5, name: "Lee Chen", biography: "Demo person. Add a TMDB_API_KEY to see real filmographies.", profilePath: null },
};

const TITLES = {
  "movie:-101": {
    id: -101,
    type: "movie",
    title: "Midnight Ferry",
    year: 2019,
    posterPath: null,
    overview: "Demo title. A late-night ferry crossing goes sideways when the crew realizes one passenger isn't on the manifest.",
    cast: [
      { personId: -1, name: "Alex Rivera", character: "Mara", profilePath: null, order: 0 },
      { personId: -2, name: "Jordan Blake", character: "Theo", profilePath: null, order: 1 },
    ],
    crew: [
      { personId: -3, name: "Sam Okafor", job: "Director", department: "Directing", profilePath: null },
    ],
  },
  "movie:-102": {
    id: -102,
    type: "movie",
    title: "Paper Cranes",
    year: 2021,
    posterPath: null,
    overview: "Demo title. Two estranged sisters fold a thousand paper cranes to keep a promise made to their grandmother.",
    cast: [
      { personId: -2, name: "Jordan Blake", character: "Whit", profilePath: null, order: 0 },
      { personId: -4, name: "Priya Anand", character: "Dana", profilePath: null, order: 1 },
    ],
    crew: [
      { personId: -3, name: "Sam Okafor", job: "Director", department: "Directing", profilePath: null },
    ],
  },
  "tv:-103": {
    id: -103,
    type: "tv",
    title: "Harbor Lights",
    year: 2023,
    posterPath: null,
    overview: "Demo title. A small coastal town's harbor patrol handles equal parts smuggling and small-town gossip.",
    cast: [
      { personId: -1, name: "Alex Rivera", character: "Captain Reyes", profilePath: null, order: 0 },
      { personId: -4, name: "Priya Anand", character: "Nora", profilePath: null, order: 1 },
    ],
    crew: [
      { personId: -5, name: "Lee Chen", job: "Director", department: "Directing", profilePath: null },
    ],
  },
};

function search(query) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const results = [];
  for (const t of Object.values(TITLES)) {
    if (t.title.toLowerCase().includes(q)) {
      results.push({ id: t.id, type: t.type, title: t.title, year: t.year, posterPath: t.posterPath });
    }
  }
  for (const p of Object.values(PEOPLE)) {
    if (p.name.toLowerCase().includes(q)) {
      results.push({ id: p.id, type: "person", title: p.name, year: null, posterPath: p.profilePath });
    }
  }
  return results;
}

function getTitle(type, id) {
  return TITLES[`${type}:${id}`] || null;
}

function getPerson(id) {
  const person = PEOPLE[String(id)];
  if (!person) return null;
  const filmography = [];
  for (const t of Object.values(TITLES)) {
    const asCast = t.cast.find((c) => c.personId === Number(id));
    const asCrew = t.crew.find((c) => c.personId === Number(id));
    if (asCast) {
      filmography.push({ titleType: t.type, titleId: t.id, titleName: t.title, year: t.year, posterPath: t.posterPath, role: asCast.character, department: "Acting" });
    }
    if (asCrew) {
      filmography.push({ titleType: t.type, titleId: t.id, titleName: t.title, year: t.year, posterPath: t.posterPath, role: asCrew.job, department: asCrew.department });
    }
  }
  return { ...person, filmography };
}

module.exports = { search, getTitle, getPerson };
