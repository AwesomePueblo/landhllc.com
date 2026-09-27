"use strict";

const content = document.getElementById("content");
const params = new URLSearchParams(location.search);
const titleType = params.get("type");
const titleId = Number(params.get("id"));

function creditRow(credit, ctx) {
  const li = document.createElement("li");
  li.className = "card";

  const link = document.createElement("a");
  link.className = "card-link";
  link.href = `/person.html?id=${credit.personId}`;

  const avatar = document.createElement("div");
  avatar.className = "avatar";
  posterOrInitial(avatar, credit.profilePath, credit.name);

  const body = document.createElement("div");
  body.className = "card-body";
  const name = document.createElement("div");
  name.className = "card-title";
  name.textContent = credit.name;
  const role = document.createElement("div");
  role.className = "card-meta";
  role.textContent = credit.character ? `as ${credit.character}` : credit.job;

  body.appendChild(name);
  body.appendChild(role);
  link.appendChild(avatar);
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
      titleType: ctx.type,
      titleId: ctx.id,
      titleName: ctx.title,
      posterPath: ctx.posterPath,
      personId: credit.personId,
      personName: credit.name,
      role: credit.character || credit.job,
      department: credit.character ? "Acting" : credit.department,
    };
    const { rating } = score === null ? await clearRating(payload) : await rateCredit({ ...payload, score });
    paintAvg(rating);
  });

  return li;
}

async function load() {
  if (!titleType || !titleId) {
    content.innerHTML = `<div class="empty-state">Missing title.</div>`;
    return;
  }
  try {
    const title = await api(`/api/title/${titleType}/${titleId}?voterId=${encodeURIComponent(getVoterId())}`);

    content.innerHTML = "";

    const hero = document.createElement("div");
    hero.className = "hero";
    const poster = document.createElement("div");
    poster.className = "poster title-hero";
    posterOrInitial(poster, title.posterPath, title.title);
    const info = document.createElement("div");
    info.innerHTML = `
      <h1>${title.title}</h1>
      <div class="meta">${title.year || ""} &middot; ${title.type === "movie" ? "Movie" : "TV Show"}</div>
      <div class="overview">${title.overview || ""}</div>
    `;
    hero.appendChild(poster);
    hero.appendChild(info);
    content.appendChild(hero);

    const castSection = document.createElement("section");
    castSection.innerHTML = "<h2>Cast</h2>";
    const castList = document.createElement("ul");
    castList.className = "credit-list";
    for (const c of title.cast) castList.appendChild(creditRow(c, title));
    castSection.appendChild(castList);
    content.appendChild(castSection);

    if (title.crew.length) {
      const crewSection = document.createElement("section");
      crewSection.innerHTML = "<h2>Crew</h2>";
      const crewList = document.createElement("ul");
      crewList.className = "credit-list";
      for (const c of title.crew) crewList.appendChild(creditRow(c, title));
      crewSection.appendChild(crewList);
      content.appendChild(crewSection);
    }
  } catch (err) {
    content.innerHTML = `<div class="empty-state">Couldn't load this title: ${err.message}</div>`;
  }
}

load();
loadDemoBanner();
