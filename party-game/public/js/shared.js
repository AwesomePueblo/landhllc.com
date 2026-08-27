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

  // Wires up a <select> (by id) as the theme picker: sets its initial
  // value to the saved theme and applies+persists on change. Safe to call
  // once at script load - the element lives outside any screen that gets
  // re-rendered, so it never needs rewiring.
  function wireThemePicker(selectId) {
    const sel = document.getElementById(selectId);
    if (!sel) return;
    sel.value = initTheme();
    sel.addEventListener("change", () => setTheme(sel.value));
  }

  function fmtCountdown(deadline) {
    if (!deadline) return "";
    const secs = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    return `${secs}s`;
  }

  return { createSocket, fmtCountdown, THEMES, wireThemePicker };
})();
