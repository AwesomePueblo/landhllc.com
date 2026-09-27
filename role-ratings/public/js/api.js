// Shared helpers: fetch wrapper + a per-browser anonymous voter id so a
// visitor's own rating can be shown/edited, while the aggregate scores are
// stored server-side in the shared SQLite database (visible to everyone).
"use strict";

function getVoterId() {
  const KEY = "roleRatingsVoterId";
  let id = localStorage.getItem(KEY);
  if (!id) {
    id = (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
    localStorage.setItem(KEY, id);
  }
  return id;
}

async function api(pathname, options) {
  const res = await fetch(pathname, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options && options.headers) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  return res.json();
}

function rateCredit(payload) {
  return api("/api/ratings", { method: "POST", body: JSON.stringify({ ...payload, voterId: getVoterId() }) });
}

function clearRating(payload) {
  return api("/api/ratings", { method: "DELETE", body: JSON.stringify({ ...payload, voterId: getVoterId() }) });
}

function posterOrInitial(el, url, name) {
  if (url) {
    el.style.backgroundImage = `url(${url})`;
    el.style.backgroundSize = "cover";
    el.style.backgroundPosition = "center";
    el.textContent = "";
  } else {
    el.textContent = (name || "?").slice(0, 1).toUpperCase();
  }
}

async function loadDemoBanner() {
  try {
    const meta = await api("/api/meta");
    if (meta.usingFallback) {
      const banner = document.createElement("div");
      banner.className = "demo-banner";
      banner.textContent = "Showing built-in demo data. Add a TMDB_API_KEY in role-ratings/.env to search and rate real movies & shows.";
      const header = document.querySelector("header.site");
      header ? header.after(banner) : document.body.prepend(banner);
    }
  } catch {
    // Non-critical; skip the banner if /api/meta is unreachable.
  }
}
