// Renders a clickable 1-10 star widget. `myScore` (1-10 or null) is the
// current visitor's own rating, if any; clicking a star that's already
// their score clears it. `onRate(score|null)` fires after a successful
// server round-trip.
"use strict";

function renderStars(container, myScore, onRate) {
  container.innerHTML = "";
  container.className = "stars";
  container.setAttribute("role", "radiogroup");
  container.setAttribute("aria-label", "Rate this performance, 1 to 10");

  const starEls = [];
  for (let i = 1; i <= 10; i++) {
    const star = document.createElement("span");
    star.className = "star";
    star.textContent = "★";
    star.dataset.value = String(i);
    star.setAttribute("role", "radio");
    star.setAttribute("aria-checked", String(i === myScore));
    starEls.push(star);
    container.appendChild(star);
  }

  function paint(upTo) {
    starEls.forEach((star, idx) => {
      star.classList.toggle("filled", idx < upTo);
    });
  }

  paint(myScore || 0);

  container.addEventListener("mousemove", (e) => {
    const target = e.target.closest(".star");
    if (!target) return;
    paint(Number(target.dataset.value));
  });

  container.addEventListener("mouseleave", () => paint(myScore || 0));

  container.addEventListener("click", async (e) => {
    const target = e.target.closest(".star");
    if (!target) return;
    const value = Number(target.dataset.value);
    const next = value === myScore ? null : value;
    container.style.pointerEvents = "none";
    try {
      await onRate(next);
      myScore = next;
      paint(myScore || 0);
    } finally {
      container.style.pointerEvents = "";
    }
  });
}
