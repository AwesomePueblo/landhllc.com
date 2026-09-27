// Role Ratings: rate a person's specific performance on a specific
// movie/show, instead of just the title as a whole (which is all IMDb-style
// sites let you do). Search a title, see its cast & crew, rate each of
// them individually; or open a person's page and see every project they've
// worked on with the community's per-project rating for that person.
//
// Works with zero setup using a small built-in demo dataset. Add a free
// TMDB_API_KEY (see .env.example) to search and rate real movies/shows.
"use strict";

require("dotenv").config();

const path = require("path");
const os = require("os");
const express = require("express");

const tmdb = require("./lib/tmdb");
const fallback = require("./lib/fallbackData");
const db = require("./lib/db");

const PORT = Number(process.env.PORT) || 3300;
const source = tmdb.hasApiKey() ? tmdb : fallback;

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

function attachTitleRatings(titleData, voterId) {
  const agg = db.getTitleAggregates(titleData.type, titleData.id);
  const mine = voterId ? db.getTitleMine(titleData.type, titleData.id, voterId) : {};
  const withRatings = (person) => ({
    ...person,
    rating: agg[person.personId] || null,
    myRating: mine[person.personId] || null,
  });
  return {
    ...titleData,
    cast: titleData.cast.map(withRatings),
    crew: titleData.crew.map(withRatings),
  };
}

function attachPersonRatings(personData, voterId) {
  const agg = db.getPersonAggregates(personData.id);
  const mine = voterId ? db.getPersonMine(personData.id, voterId) : {};
  return {
    ...personData,
    filmography: personData.filmography.map((credit) => {
      const key = `${credit.titleType}:${credit.titleId}`;
      return { ...credit, rating: agg[key] || null, myRating: mine[key] || null };
    }),
  };
}

app.get("/api/meta", (req, res) => {
  res.json({ usingFallback: !tmdb.hasApiKey() });
});

app.get("/api/search", async (req, res) => {
  try {
    const q = String(req.query.q || "");
    const results = await source.search(q);
    res.json({ results });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.get("/api/title/:type/:id", async (req, res) => {
  try {
    const { type, id } = req.params;
    const voterId = String(req.query.voterId || "");
    const title = await source.getTitle(type, Number(id));
    if (!title) return res.status(404).json({ error: "Not found" });
    res.json(attachTitleRatings(title, voterId));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.get("/api/person/:id", async (req, res) => {
  try {
    const voterId = String(req.query.voterId || "");
    const person = await source.getPerson(Number(req.params.id));
    if (!person) return res.status(404).json({ error: "Not found" });
    res.json(attachPersonRatings(person, voterId));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.post("/api/ratings", (req, res) => {
  const { titleType, titleId, titleName, posterPath, personId, personName, role, department, voterId, score } = req.body || {};

  if (!["movie", "tv"].includes(titleType)) return res.status(400).json({ error: "Invalid titleType" });
  if (!Number.isFinite(Number(titleId)) || !Number.isFinite(Number(personId))) {
    return res.status(400).json({ error: "Invalid titleId/personId" });
  }
  if (!titleName || !personName) return res.status(400).json({ error: "Missing titleName/personName" });
  if (!voterId || typeof voterId !== "string") return res.status(400).json({ error: "Missing voterId" });
  const numericScore = Number(score);
  if (!Number.isInteger(numericScore) || numericScore < 1 || numericScore > 10) {
    return res.status(400).json({ error: "score must be an integer 1-10" });
  }

  db.upsertRating({
    titleType,
    titleId: Number(titleId),
    titleName: String(titleName).slice(0, 300),
    posterPath: posterPath ? String(posterPath).slice(0, 300) : null,
    personId: Number(personId),
    personName: String(personName).slice(0, 200),
    role: role ? String(role).slice(0, 200) : null,
    department: department ? String(department).slice(0, 100) : null,
    voterId: String(voterId).slice(0, 100),
    score: numericScore,
  });

  const agg = db.getTitleAggregates(titleType, Number(titleId))[Number(personId)] || { avg: numericScore, count: 1 };
  res.json({ rating: agg });
});

app.delete("/api/ratings", (req, res) => {
  const { titleType, titleId, personId, voterId } = req.body || {};
  if (!titleType || !titleId || !personId || !voterId) {
    return res.status(400).json({ error: "Missing fields" });
  }
  db.deleteRating({ titleType, titleId: Number(titleId), personId: Number(personId), voterId: String(voterId) });
  const agg = db.getTitleAggregates(titleType, Number(titleId))[Number(personId)] || null;
  res.json({ rating: agg });
});

function lanUrl() {
  const nets = os.networkInterfaces();
  for (const iface of Object.values(nets)) {
    for (const net of iface || []) {
      if (net.family === "IPv4" && !net.internal) return `http://${net.address}:${PORT}`;
    }
  }
  return `http://localhost:${PORT}`;
}

app.listen(PORT, () => {
  console.log("=".repeat(60));
  console.log("  Role Ratings server running");
  console.log("=".repeat(60));
  console.log(`  Local:  http://localhost:${PORT}`);
  console.log(`  LAN:    ${lanUrl()}`);
  console.log(
    tmdb.hasApiKey()
      ? "  Data source: TMDb (live)"
      : "  Data source: built-in demo dataset (add TMDB_API_KEY in .env for real titles)"
  );
});
