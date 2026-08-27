// Shared client helpers: a reconnecting WebSocket wrapper and the
// per-device color theme picker.
"use strict";

window.PartyGame = (function () {
  function createSocket({ onOpen, onMessage, onClose } = {}) {
    let ws;
    let backoff = 1000;

    function connect() {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      ws = new WebSocket(`${proto}://${location.host}`);

      ws.addEventListener("open", () => {
        backoff = 1000;
        if (onOpen) onOpen();
      });
      ws.addEventListener("message", (ev) => {
        let msg;
        try {
          msg = JSON.parse(ev.data);
        } catch {
          return;
        }
        if (onMessage) onMessage(msg);
      });
      ws.addEventListener("close", () => {
        if (onClose) onClose();
        setTimeout(connect, backoff);
        backoff = Math.min(backoff * 1.5, 8000);
      });
      ws.addEventListener("error", () => ws.close());
    }

    connect();

    return {
      send(obj) {
        if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
      },
    };
  }

  // Color theme: a per-device cosmetic preference (not shared game state),
  // remembered in localStorage. "default" removes the [data-theme]
  // attribute, falling back to the built-in purple/pink palette in
  // style.css's :root.
  const THEME_KEY = "pg_theme";
  const THEMES = ["default", "blue", "gold", "silver", "dark", "green", "orange"];
  // Swatch dot colors - each theme's own --accent value, kept in sync with
  // the [data-theme] blocks in style.css.
  const THEME_COLORS = {
    default: "#ff5fa2",
    blue: "#3fa9ff",
    gold: "#ffcc4d",
    silver: "#c9d3dc",
    dark: "#e0e0e0",
    green: "#4ade80",
    orange: "#ff8a3d",
  };

  function applyTheme(name) {
    if (name && name !== "default") document.documentElement.setAttribute("data-theme", name);
    else document.documentElement.removeAttribute("data-theme");
  }

  function initTheme() {
    const saved = localStorage.getItem(THEME_KEY) || "default";
    applyTheme(saved);
    return saved;
  }

  function setTheme(name) {
    localStorage.setItem(THEME_KEY, name);
    applyTheme(name);
  }

  // Renders a row of clickable color swatch dots (one per theme) plus a
  // "Theme" label, inside a container with the given id.
  function themeSwatchesHTML(containerId) {
    const current = localStorage.getItem(THEME_KEY) || "default";
    const dots = THEMES.map(
      (t) =>
        `<button type="button" class="theme-dot${t === current ? " active" : ""}" data-theme="${t}" style="background:${THEME_COLORS[t]}" aria-label="${t} theme" title="${t}"></button>`
    ).join("");
    return `<div class="theme-swatches" id="${containerId}"><span class="theme-label">Theme</span>${dots}</div>`;
  }

  // Wires the swatch dots inside the given container id: applies the saved
  // theme on load, and clicking a dot switches + persists + updates which
  // dot shows as active. Safe to call once - the caller re-renders the
  // container's innerHTML itself (via themeSwatchesHTML) whenever needed.
  function wireThemeSwatches(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    initTheme();
    container.querySelectorAll(".theme-dot").forEach((btn) => {
      btn.addEventListener("click", () => {
        setTheme(btn.dataset.theme);
        container.querySelectorAll(".theme-dot").forEach((b) => b.classList.toggle("active", b === btn));
      });
    });
  }

  function fmtCountdown(deadline) {
    if (!deadline) return "";
    const secs = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    return `${secs}s`;
  }

  return { createSocket, fmtCountdown, THEMES, themeSwatchesHTML, wireThemeSwatches };
})();
