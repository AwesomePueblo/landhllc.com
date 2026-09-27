// SQLite storage for per-project ratings. Uses Node's built-in node:sqlite
// (no native dependency, no build step) so `npm install` stays as light as
// the rest of this repo's side projects.
"use strict";

const path = require("path");
const fs = require("fs");
const { DatabaseSync } = require("node:sqlite");

const DATA_DIR = path.join(__dirname, "..", "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, "ratings.db"));

db.exec(`
  CREATE TABLE IF NOT EXISTS ratings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title_type TEXT NOT NULL,
    title_id INTEGER NOT NULL,
    title_name TEXT NOT NULL,
    poster_path TEXT,
    person_id INTEGER NOT NULL,
    person_name TEXT NOT NULL,
    role TEXT,
    department TEXT,
    voter_id TEXT NOT NULL,
    score INTEGER NOT NULL CHECK(score BETWEEN 1 AND 10),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(title_type, title_id, person_id, voter_id)
  );

  CREATE INDEX IF NOT EXISTS idx_ratings_title
    ON ratings(title_type, title_id);

  CREATE INDEX IF NOT EXISTS idx_ratings_person
    ON ratings(person_id);
`);

const upsertStmt = db.prepare(`
  INSERT INTO ratings
    (title_type, title_id, title_name, poster_path, person_id, person_name, role, department, voter_id, score)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(title_type, title_id, person_id, voter_id)
  DO UPDATE SET score = excluded.score, updated_at = datetime('now')
`);

const deleteStmt = db.prepare(`
  DELETE FROM ratings
  WHERE title_type = ? AND title_id = ? AND person_id = ? AND voter_id = ?
`);

const titleAggStmt = db.prepare(`
  SELECT person_id AS personId, AVG(score) AS avg, COUNT(*) AS count
  FROM ratings
  WHERE title_type = ? AND title_id = ?
  GROUP BY person_id
`);

const titleMineStmt = db.prepare(`
  SELECT person_id AS personId, score
  FROM ratings
  WHERE title_type = ? AND title_id = ? AND voter_id = ?
`);

const personAggStmt = db.prepare(`
  SELECT title_type AS titleType, title_id AS titleId, AVG(score) AS avg, COUNT(*) AS count
  FROM ratings
  WHERE person_id = ?
  GROUP BY title_type, title_id
`);

const personMineStmt = db.prepare(`
  SELECT title_type AS titleType, title_id AS titleId, score
  FROM ratings
  WHERE person_id = ? AND voter_id = ?
`);

function upsertRating({ titleType, titleId, titleName, posterPath, personId, personName, role, department, voterId, score }) {
  upsertStmt.run(titleType, titleId, titleName, posterPath || null, personId, personName, role || null, department || null, voterId, score);
}

function deleteRating({ titleType, titleId, personId, voterId }) {
  deleteStmt.run(titleType, titleId, personId, voterId);
}

function getTitleAggregates(titleType, titleId) {
  const rows = titleAggStmt.all(titleType, titleId);
  const byPerson = {};
  for (const row of rows) {
    byPerson[row.personId] = { avg: row.avg, count: row.count };
  }
  return byPerson;
}

function getTitleMine(titleType, titleId, voterId) {
  const rows = titleMineStmt.all(titleType, titleId, voterId);
  const byPerson = {};
  for (const row of rows) byPerson[row.personId] = row.score;
  return byPerson;
}

function getPersonAggregates(personId) {
  const rows = personAggStmt.all(personId);
  const byTitle = {};
  for (const row of rows) {
    byTitle[`${row.titleType}:${row.titleId}`] = { avg: row.avg, count: row.count };
  }
  return byTitle;
}

function getPersonMine(personId, voterId) {
  const rows = personMineStmt.all(personId, voterId);
  const byTitle = {};
  for (const row of rows) byTitle[`${row.titleType}:${row.titleId}`] = row.score;
  return byTitle;
}

module.exports = {
  upsertRating,
  deleteRating,
  getTitleAggregates,
  getTitleMine,
  getPersonAggregates,
  getPersonMine,
};
