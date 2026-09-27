// Thin client for The Movie Database (TMDb) API v3.
// https://developer.themoviedb.org/reference/intro/getting-started
"use strict";

const API_BASE = "https://api.themoviedb.org/3";
const IMAGE_BASE = "https://image.tmdb.org/t/p/w342";
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

const apiKey = process.env.TMDB_API_KEY || "";
const cache = new Map(); // url -> { at, data }

function hasApiKey() {
  return Boolean(apiKey);
}

function imagePath(path) {
  return path ? `${IMAGE_BASE}${path}` : null;
}

async function tmdbFetch(pathname, params = {}) {
  const url = new URL(`${API_BASE}${pathname}`);
  url.searchParams.set("api_key", apiKey);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) url.searchParams.set(key, value);
  }
  const key = url.toString();

  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.data;

  const res = await fetch(key);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`TMDb request failed (${res.status}): ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  cache.set(key, { at: Date.now(), data });
  return data;
}

async function search(query) {
  const data = await tmdbFetch("/search/multi", { query, include_adult: "false" });
  return (data.results || [])
    .filter((r) => r.media_type === "movie" || r.media_type === "tv" || r.media_type === "person")
    .slice(0, 20)
    .map((r) => {
      if (r.media_type === "person") {
        return { id: r.id, type: "person", title: r.name, year: null, posterPath: imagePath(r.profile_path) };
      }
      const title = r.media_type === "movie" ? r.title : r.name;
      const date = r.media_type === "movie" ? r.release_date : r.first_air_date;
      return {
        id: r.id,
        type: r.media_type,
        title,
        year: date ? Number(String(date).slice(0, 4)) : null,
        posterPath: imagePath(r.poster_path),
      };
    });
}

async function getTitle(type, id) {
  if (type !== "movie" && type !== "tv") return null;
  const data = await tmdbFetch(`/${type}/${id}`, { append_to_response: "credits" });
  const title = type === "movie" ? data.title : data.name;
  const date = type === "movie" ? data.release_date : data.first_air_date;
  const credits = data.credits || { cast: [], crew: [] };

  return {
    id: data.id,
    type,
    title,
    year: date ? Number(String(date).slice(0, 4)) : null,
    posterPath: imagePath(data.poster_path),
    overview: data.overview || "",
    cast: credits.cast.slice(0, 30).map((c) => ({
      personId: c.id,
      name: c.name,
      character: c.character,
      profilePath: imagePath(c.profile_path),
      order: c.order,
    })),
    crew: credits.crew
      .filter((c) => ["Directing", "Writing", "Production"].includes(c.department))
      .slice(0, 20)
      .map((c) => ({
        personId: c.id,
        name: c.name,
        job: c.job,
        department: c.department,
        profilePath: imagePath(c.profile_path),
      })),
  };
}

async function getPerson(id) {
  const data = await tmdbFetch(`/person/${id}`, { append_to_response: "combined_credits" });
  const credits = data.combined_credits || { cast: [], crew: [] };

  const filmography = [];
  for (const c of credits.cast || []) {
    const title = c.media_type === "movie" ? c.title : c.name;
    const date = c.media_type === "movie" ? c.release_date : c.first_air_date;
    filmography.push({
      titleType: c.media_type,
      titleId: c.id,
      titleName: title,
      year: date ? Number(String(date).slice(0, 4)) : null,
      posterPath: imagePath(c.poster_path),
      role: c.character,
      department: "Acting",
    });
  }
  for (const c of credits.crew || []) {
    if (!["Directing", "Writing", "Production"].includes(c.department)) continue;
    const title = c.media_type === "movie" ? c.title : c.name;
    const date = c.media_type === "movie" ? c.release_date : c.first_air_date;
    filmography.push({
      titleType: c.media_type,
      titleId: c.id,
      titleName: title,
      year: date ? Number(String(date).slice(0, 4)) : null,
      posterPath: imagePath(c.poster_path),
      role: c.job,
      department: c.department,
    });
  }
  filmography.sort((a, b) => (b.year || 0) - (a.year || 0));

  return {
    id: data.id,
    name: data.name,
    biography: data.biography || "",
    profilePath: imagePath(data.profile_path),
    filmography,
  };
}

module.exports = { hasApiKey, search, getTitle, getPerson };
