"use strict";

const content = document.getElementById("content");
const params = new URLSearchParams(location.search);
const personId = Number(params.get("id"));

function filmographyRow(credit, person) {
  const li = document.createElement("li");
  li.className = "card";

  const link = document.createElement("a");
  link.className = "card-link";
  link.href = `/title.html?type=${credit.titleType}&id=${credit.titleId}`;

  const poster = document.createElement("div");
  poster.className = "poster";
  posterOrInitial(poster, credit.posterPath, credit.titleName);

  const body = document.createElement("div");
  body.className = "card-body";
  const title = document.createElement("div");
  title.className = "card-title";
  title.textContent = `${credit.titleName}${credit.year ? ` (${credit.year})` : ""}`;
  const role = document.createElement("div");
  role.className = "card-meta";
  role.textContent = credit.role || credit.department;

  body.appendChild(title);
  body.appendChild(role);
  link.appendChild(poster);
  link.appendChild(body);
  li.appendChild(link);

  const ratingBlock = document.createElement("div");
  ratingBlock.className = "rating-block";
  const avgEl = document.createElement("div");
  avgEl.className = "rating-avg";
  const starsEl = document.createElement("div");

  function paintAvg(rating) {
    avgEl.innerHTML = rating
      ? `<strong>${rating.avg.toFixed(1)}</strong>/10 &middot; ${rating.count} rating${rating.count === 1 ? "" : "s"}`
      : "Not yet rated";
  }

  paintAvg(credit.rating);
  ratingBlock.appendChild(avgEl);
  ratingBlock.appendChild(starsEl);
  li.appendChild(ratingBlock);

  renderStars(starsEl, credit.myRating, async (score) => {
    const payload = {
      titleType: credit.titleType,
      titleId: credit.titleId,
      titleName: credit.titleName,
      posterPath: credit.posterPath,
      personId: person.id,
      personName: person.name,
      role: credit.role,
      department: credit.department,
    };
    const { rating } = score === null ? await clearRating(payload) : await rateCredit({ ...payload, score });
    paintAvg(rating);
  });

  return li;
}

async function load() {
  if (!personId) {
    content.innerHTML = `<div class="empty-state">Missing person.</div>`;
    return;
  }
  try {
    const person = await api(`/api/person/${personId}?voterId=${encodeURIComponent(getVoterId())}`);

    content.innerHTML = "";

    const hero = document.createElement("div");
    hero.className = "hero";
    const avatar = document.createElement("div");
    avatar.className = "avatar person-hero";
    posterOrInitial(avatar, person.profilePath, person.name);
    const info = document.createElement("div");
    info.innerHTML = `
      <h1>${person.name}</h1>
      <div class="overview">${person.biography || ""}</div>
    `;
    hero.appendChild(avatar);
    hero.appendChild(info);
    content.appendChild(hero);

    const section = document.createElement("section");
    section.innerHTML = "<h2>Filmography &mdash; rate each project individually</h2>";
    const list = document.createElement("ul");
    list.className = "filmography-list";
    if (person.filmography.length === 0) {
      list.innerHTML = `<div class="empty-state">No credits found.</div>`;
    } else {
      for (const credit of person.filmography) list.appendChild(filmographyRow(credit, person));
    }
    section.appendChild(list);
    content.appendChild(section);
  } catch (err) {
    content.innerHTML = `<div class="empty-state">Couldn't load this person: ${err.message}</div>`;
  }
}

load();
loadDemoBanner();
