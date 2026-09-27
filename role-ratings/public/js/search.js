"use strict";

const form = document.getElementById("search-form");
const input = document.getElementById("search-input");
const resultsEl = document.getElementById("results");
const emptyEl = document.getElementById("empty");

function resultLink(r) {
  if (r.type === "person") return `/person.html?id=${r.id}`;
  return `/title.html?type=${r.type}&id=${r.id}`;
}

function renderResults(results) {
  resultsEl.innerHTML = "";
  emptyEl.hidden = results.length > 0;
  for (const r of results) {
    const li = document.createElement("li");
    li.className = "card";
    const a = document.createElement("a");
    a.className = "card-link";
    a.href = resultLink(r);

    const thumb = document.createElement("div");
    thumb.className = "poster";
    posterOrInitial(thumb, r.posterPath, r.title);

    const body = document.createElement("div");
    body.className = "card-body";
    const title = document.createElement("div");
    title.className = "card-title";
    title.textContent = r.title;
    const badge = document.createElement("span");
    badge.className = "type-badge";
    badge.textContent = r.type;
    title.appendChild(badge);
    const meta = document.createElement("div");
    meta.className = "card-meta";
    meta.textContent = r.year || "";

    body.appendChild(title);
    body.appendChild(meta);
    a.appendChild(thumb);
    a.appendChild(body);
    li.appendChild(a);
    resultsEl.appendChild(li);
  }
}

async function runSearch(q) {
  if (!q.trim()) {
    resultsEl.innerHTML = "";
    emptyEl.hidden = true;
    return;
  }
  try {
    const { results } = await api(`/api/search?q=${encodeURIComponent(q)}`);
    renderResults(results);
  } catch (err) {
    emptyEl.hidden = false;
    emptyEl.textContent = `Search failed: ${err.message}`;
  }
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  runSearch(input.value);
});

let debounceTimer;
input.addEventListener("input", () => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => runSearch(input.value), 350);
});

loadDemoBanner();
