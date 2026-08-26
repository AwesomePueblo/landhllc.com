// Shared client helpers: a reconnecting WebSocket wrapper and the mobile
// audio-unlock trick (browsers block audio.play() unless it was triggered
// by a real user gesture at least once per page session).
"use strict";

window.PartyGame = (function () {
  const SILENCE_WAV =
    "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";

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

  // Call from inside a real click/tap handler, once, before you ever need
  // to autoplay. Reuse the SAME <audio> element for the real playback later.
  function unlockAudio(audioEl) {
    try {
      audioEl.src = SILENCE_WAV;
      audioEl.muted = true;
      const p = audioEl.play();
      if (p && p.catch) p.catch(() => {});
      setTimeout(() => {
        audioEl.pause();
        audioEl.currentTime = 0;
        audioEl.muted = false;
      }, 80);
    } catch {
      // best effort - if it fails, playback will just require a manual tap
    }
  }

  function fmtCountdown(deadline) {
    if (!deadline) return "";
    const secs = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    return `${secs}s`;
  }

  return { createSocket, unlockAudio, fmtCountdown };
})();
