# Role Ratings 🎭

IMDb-style sites let you rate a *movie*, or a *show*. They don't let you
rate a specific person's specific performance *on* that title, separately
from the title's overall score. This does: search a movie or show, see its
cast and crew, and rate each person's work on that one project. Or open a
person's page and see their whole filmography with the community's
per-project rating for each thing they've done.

No accounts - ratings are anonymous per-browser (so you can change your own
vote later), and aggregated scores are shared and persisted for everyone in
a SQLite database on the server.

## Setup

```bash
cd role-ratings
npm install
cp .env.example .env
```

Get a free API key at https://www.themoviedb.org/settings/api (the "API
Key (v3 auth)" one) and add it to `.env`:

```
TMDB_API_KEY=...
```

No key? The app still runs end-to-end against a small built-in demo
dataset (a handful of fictional movies/people) so you can try the concept
with zero setup.

## Run it

```bash
npm start
```

```
============================================================
  Role Ratings server running
============================================================
  Local:  http://localhost:3300
  LAN:    http://192.168.1.42:3300
  Data source: TMDb (live)
```

Open the printed URL. Search a title, click into it, rate the cast/crew
with the star widget. Click a person's name to see their filmography and
rate other projects they've worked on from there too.

## How the pieces fit together

```
role-ratings/
  server.js            Express app: search, title/person detail + rating endpoints
  lib/tmdb.js            TMDb API client (search, title credits, person combined credits)
  lib/fallbackData.js      Built-in demo dataset, used when no TMDB_API_KEY is set
  lib/db.js                node:sqlite storage + aggregate queries for ratings
  data/ratings.db            The SQLite database (created on first run, gitignored)
  public/                  Plain HTML/CSS/JS front end, no build step
```

## API

| Route | Description |
|---|---|
| `GET /api/search?q=` | Search titles (and people) |
| `GET /api/title/:type/:id` | Title details + cast/crew + rating aggregates |
| `GET /api/person/:id` | Person bio + filmography + per-project rating aggregates |
| `POST /api/ratings` | Upsert the caller's 1-10 rating for a person on a title |
| `DELETE /api/ratings` | Remove the caller's rating |

## Limitations (it's a proof of concept)

- Anonymous voting: a rating is tied to a random id stored in the voter's
  browser, not a real account - someone can clear `localStorage` to vote
  again. Fine for personal/small-group use, not for anything adversarial.
- Single shared SQLite file - fine for one deployment, not built for
  horizontal scaling.
- TMDb search covers movies, TV shows, and people; crew credits are
  limited to Directing/Writing/Production departments to keep title pages
  readable.
