"use strict";

const app = document.getElementById("app");
const audioEl = document.getElementById("host-audio");

let authed = false;
let hostKey = new URLSearchParams(location.search).get("key") || "";
let latestState = null;
let countdownTimer = null;
let scheduledTrackUrl = null;

function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function setApp(html) {
  if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
  app.innerHTML = html;
}

function flashError(msg) {
  const el = document.createElement("div");
  el.textContent = msg;
  el.style.cssText =
    "position:fixed;top:12px;left:50%;transform:translateX(-50%);background:#ff5f5f;" +
    "color:#1a0f2e;padding:10px 16px;border-radius:10px;font-weight:700;z-index:999;" +
    "box-shadow:0 6px 20px rgba(0,0,0,.4);max-width:90vw;text-align:center;";
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

const socket = PartyGame.createSocket({
  onOpen() {
    if (hostKey) socket.send({ type: "host:auth", key: hostKey });
    else render();
  },
  onMessage(msg) {
    if (msg.type === "host:authOk") {
      authed = true;
      render();
    } else if (msg.type === "error") {
      if (!authed) flashError(msg.message || "Could not authenticate as host");
      else flashError(msg.message);
      render();
    } else if (msg.type === "state") {
      latestState = msg.state;
      render();
      renderDebug(msg.state.debugLog || []);
      updateAudioDock(msg.state);
    }
  },
  onClose() {},
});

function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour12: false });
}

function debugEntryHTML(entry) {
  const typeLabel = { question: "🎲 Question call", lyrics: "✍️ Lyrics call", music: "🎧 Music call" }[entry.type] || entry.type;
  const statusHTML = entry.error
    ? `<span class="debug-status err">${entry.usedFallback ? "FAILED (fell back)" : "FAILED"}</span>`
    : `<span class="debug-status ok">OK</span>`;
  const parts = [
    `<div class="debug-section">
       <div class="debug-label">Request</div>
       <pre>${escapeHtml(JSON.stringify(entry.request, null, 2))}</pre>
     </div>`,
  ];
  if (entry.response) {
    parts.push(`<div class="debug-section">
       <div class="debug-label">Response</div>
       <pre>${escapeHtml(JSON.stringify(entry.response, null, 2))}</pre>
     </div>`);
  }
  if (entry.error) {
    parts.push(`<div class="debug-section">
       <div class="debug-label">Error</div>
       <pre class="debug-error-text">${escapeHtml(entry.error)}</pre>
     </div>`);
  }
  return `
    <details class="debug-entry ${entry.error ? "debug-error" : ""}">
      <summary>${typeLabel} · ${fmtTime(entry.at)} ${statusHTML}</summary>
      ${parts.join("")}
    </details>
  `;
}

function renderDebug(entries) {
  const body = document.getElementById("debugBody");
  if (!body) return;
  if (!entries.length) {
    body.innerHTML = '<div class="muted" style="font-size:0.8rem">No AI/API calls yet - this stays empty while running fully offline.</div>';
    return;
  }
  body.innerHTML = entries.map(debugEntryHTML).join("");
}

(function wireDebugToggle() {
  const panel = document.getElementById("debugPanel");
  const btn = document.getElementById("debugToggle");
  if (!panel || !btn) return;
  btn.addEventListener("click", () => {
    panel.classList.toggle("collapsed");
    btn.textContent = panel.classList.contains("collapsed") ? "Show" : "Hide";
  });
})();

// The fullscreen button lives inside #app and gets recreated by setApp()
// on every render (wireTopBar() rewires its click handler each time), but
// the browser can also exit fullscreen without a render happening (e.g.
// pressing Escape) - keep its label in sync either way.
document.addEventListener("fullscreenchange", () => {
  const btn = document.getElementById("fullscreenBtn");
  if (btn) btn.textContent = document.fullscreenElement ? "⛶ Exit fullscreen" : "⛶ Fullscreen";
});

// A real, persistent audio player: visible native controls (play/pause/
// seek/volume - so playback isn't a one-shot autoplay, it can be replayed
// any time), a download link, and the song title. Lives outside #app so
// setApp()'s innerHTML wipes never interrupt playback. Only the host plays
// audio - players' phones just show the lyrics.
function updateAudioDock(st) {
  const dock = document.getElementById("audioDock");
  if (!dock) return;

  if (!st.track) {
    dock.classList.remove("visible");
    if (!audioEl.paused) audioEl.pause();
    audioEl.removeAttribute("src");
    scheduledTrackUrl = null;
    return;
  }

  dock.classList.add("visible");
  const titleEl = document.getElementById("audioDockTitle");
  if (titleEl) titleEl.textContent = st.lyrics ? `🎵 ${st.lyrics.title}` : "🎵 Song";

  const link = document.getElementById("downloadLink");
  if (link) {
    link.href = st.track.url;
    const ext = st.track.url.slice(st.track.url.lastIndexOf(".") + 1) || "mp3";
    const safeTitle = ((st.lyrics && st.lyrics.title) || "song").replace(/[^a-z0-9\- ]+/gi, "").trim() || "song";
    link.download = `${safeTitle}.${ext}`;
  }

  schedulePlayback(st);
}

function schedulePlayback(st) {
  if (!st.track || scheduledTrackUrl === st.track.url) return;
  scheduledTrackUrl = st.track.url;
  audioEl.src = st.track.url;
  audioEl.load();
  const delay = st.track.startAt - Date.now();
  const doPlay = () => audioEl.play().catch(() => {
    // Autoplay blocked - the dock's native controls are visible, so the
    // host can just press play themselves. Nothing more to do here.
  });
  if (delay <= 0) doPlay();
  else setTimeout(doPlay, delay);
}

function joinUrl() {
  return location.origin;
}

function lyricsLinesHTML(body) {
  return body
    .split("\n")
    .map((line, i) => {
      const trimmed = line.trim();
      const isSection = /^\[.*\]$/.test(trimmed);
      const cls = isSection ? "section" : "line";
      return `<div class="${cls}" data-line="${i}">${escapeHtml(line) || "&nbsp;"}</div>`;
    })
    .join("");
}

function updateCountdown(deadline) {
  function tick() {
    const el = document.getElementById("countdown");
    if (!el) { clearInterval(countdownTimer); return; }
    const secs = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    el.textContent = secs > 0 ? `⏱ ${secs}s left` : "Time's up - locking in answers...";
  }
  tick();
  countdownTimer = setInterval(tick, 500);
}

function playerListHTML(players) {
  if (!players.length) return '<span class="muted">Nobody has joined yet</span>';
  return players
    .map(
      (p) => `
      <span class="badge">
        <span class="dot" style="background:${p.color}"></span>
        ${escapeHtml(p.name)}${p.connected ? "" : " (away)"}
        <button class="ghost" style="padding:2px 8px;font-size:0.75rem" data-kick="${p.id}">✕</button>
      </span>`
    )
    .join("");
}

function wireKickButtons() {
  document.querySelectorAll("[data-kick]").forEach((btn) => {
    btn.addEventListener("click", () => socket.send({ type: "host:kick", playerId: btn.dataset.kick }));
  });
}

function styleSummaryText(sp) {
  if (!sp) return "";
  return [
    sp.style,
    sp.vocalGender && `${sp.vocalGender} vocals`,
    sp.weirdness && `${sp.weirdness} weirdness`,
    sp.styleInfluence && `like ${sp.styleInfluence}`,
  ].filter(Boolean).join(" · ");
}

function screenKeyForm() {
  setApp(`
    <div class="host-title title">🎤 Song Party - Host</div>
    <div class="card col">
      <h2>Enter host key</h2>
      <div class="muted">Check the server console for the host URL (it includes the key), or paste the key below.</div>
      <input type="text" id="keyInput" placeholder="host key" />
      <button id="keyBtn">Connect</button>
    </div>
  `);
  const input = document.getElementById("keyInput");
  const btn = document.getElementById("keyBtn");
  btn.addEventListener("click", () => {
    hostKey = input.value.trim();
    socket.send({ type: "host:auth", key: hostKey });
  });
}

function topBar(st) {
  return `
    <div class="row" style="align-items:center;justify-content:space-between">
      <div class="host-title title">🎤 Song Party</div>
      <div class="row" style="align-items:center;gap:14px">
        <div class="muted">Round ${st.roundNumber}</div>
        ${PartyGame.themeSwatchesHTML("themeSwatches")}
        <button id="fullscreenBtn" class="ghost small">⛶ Fullscreen</button>
      </div>
    </div>
    <div class="card join-panel">
      <div>
        <div class="muted">Join at</div>
        <div class="url">${escapeHtml(joinUrl())}</div>
      </div>
      <div class="spacer"></div>
      <div class="player-list">${playerListHTML(st.players)}</div>
    </div>
  `;
}

function wireTopBar() {
  wireKickButtons();
  PartyGame.wireThemeSwatches("themeSwatches");
  // Fullscreen button is re-created on every setApp(), so its listener
  // needs rewiring each time too (unlike the debug/panel ones, which are
  // wired once outside #app).
  const btn = document.getElementById("fullscreenBtn");
  if (btn) {
    btn.textContent = document.fullscreenElement ? "⛶ Exit fullscreen" : "⛶ Fullscreen";
    btn.addEventListener("click", () => {
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen().catch(() => flashError("Fullscreen wasn't allowed - try F11."));
    });
  }
}

function screenLobby(st) {
  setApp(`
    ${topBar(st)}
    <div class="card col center">
      <h2>Ready when you are</h2>
      <div class="muted">Everyone should join at the URL above first. The crew decides this round's sound and story - no genre to pick.</div>
      <button id="startBtn" ${st.players.length ? "" : "disabled"}>▶️ Start round</button>
    </div>
  `);
  wireTopBar();
  document.getElementById("startBtn").addEventListener("click", () => socket.send({ type: "host:start" }));
}

function screenGenreAnswering(st) {
  const answeredCount = st.players.filter((p) => p.genreAnswered).length;
  const total = st.players.length;
  const pct = total ? Math.round((answeredCount / total) * 100) : 0;
  const rows = st.players
    .map((p) => {
      const qs = (p.genreQuestions || []).map((gq) => gq.label).join(", ") || "(none assigned)";
      return `
      <div class="row" style="justify-content:space-between;align-items:center;gap:12px">
        <span class="badge"><span class="dot" style="background:${p.color}"></span>${escapeHtml(p.name)}</span>
        <span class="muted" style="flex:1;text-align:right">${escapeHtml(qs)}${p.genreAnswered ? " ✅" : ""}</span>
      </div>`;
    })
    .join("");
  setApp(`
    ${topBar(st)}
    <div class="card col center">
      <div class="muted">🎨 Deciding this round's sound</div>
      <div class="muted" style="font-size:0.9rem">Everyone's answering a piece of the song's style</div>
    </div>
    <div class="card col">${rows}</div>
    <div class="card col">
      <div class="progress-bar"><div style="width:${pct}%"></div></div>
      <div class="row center" style="justify-content:space-between">
        <span class="muted">${answeredCount}/${total} done</span>
        <span class="muted" id="countdown"></span>
      </div>
      <button id="lockGenreBtn" class="secondary">🔒 Lock it in now</button>
    </div>
  `);
  wireTopBar();
  document.getElementById("lockGenreBtn").addEventListener("click", () => socket.send({ type: "host:lockGenreAnswers" }));
  if (st.deadline) updateCountdown(st.deadline);
}

function screenLoading(st, text) {
  setApp(`
    ${topBar(st)}
    <div class="card col center">
      <div class="spinner"></div>
      <div class="pulse" style="font-size:1.3rem">${escapeHtml(text)}</div>
    </div>
  `);
  wireTopBar();
}

function screenAnswering(st) {
  const answeredCount = st.players.filter((p) => p.answered).length;
  const total = st.players.length;
  const pct = total ? Math.round((answeredCount / total) * 100) : 0;
  const promptRows = st.players
    .map(
      (p) => `
      <div class="row" style="justify-content:space-between;align-items:center;gap:12px">
        <span class="badge"><span class="dot" style="background:${p.color}"></span>${escapeHtml(p.name)}</span>
        <span class="muted" style="flex:1;text-align:right">${escapeHtml(p.question || "")}${p.answered ? " ✅" : ""}</span>
      </div>`
    )
    .join("");
  setApp(`
    ${topBar(st)}
    <div class="card col center">
      <div class="muted">${escapeHtml(styleSummaryText(st.styleProfile))} · themed around: <strong>${escapeHtml(st.questionTheme || "")}</strong></div>
      <div class="muted" style="font-size:0.9rem">Everyone's got their own related prompt this round</div>
    </div>
    <div class="card col">${promptRows}</div>
    <div class="card col">
      <div class="progress-bar"><div style="width:${pct}%"></div></div>
      <div class="row center" style="justify-content:space-between">
        <span class="muted">${answeredCount}/${total} answered</span>
        <span class="muted" id="countdown"></span>
      </div>
      <button id="lockBtn" class="secondary">🔒 Lock answers now</button>
    </div>
  `);
  wireTopBar();
  document.getElementById("lockBtn").addEventListener("click", () => socket.send({ type: "host:lockAnswers" }));
  if (st.deadline) updateCountdown(st.deadline);
}

function screenLyricsReady(st) {
  setApp(`
    ${topBar(st)}
    <div class="card col center">
      <h2>🎶 ${escapeHtml(st.lyrics.title)}</h2>
      <button id="makeSongBtn">🎵 Make it a song!</button>
    </div>
    <div class="card host-lyrics lyrics">${lyricsLinesHTML(st.lyrics.body)}</div>
  `);
  wireTopBar();
  document.getElementById("makeSongBtn").addEventListener("click", () => socket.send({ type: "host:makeSong" }));
}

function screenGeneratingMusic(st) {
  setApp(`
    ${topBar(st)}
    <div class="card col center">
      <div class="spinner"></div>
      <div class="pulse" style="font-size:1.3rem">🎧 Producing your ${escapeHtml(styleSummaryText(st.styleProfile)) || "custom"} track...</div>
    </div>
    <div class="card host-lyrics lyrics">${st.lyrics ? lyricsLinesHTML(st.lyrics.body) : ""}</div>
  `);
  wireTopBar();
}

function screenPlayback(st) {
  setApp(`
    ${topBar(st)}
    <div class="card col center">
      <div class="pulse" style="font-size:1.3rem">🎧 Now playing - ${escapeHtml(st.lyrics ? st.lyrics.title : "")}</div>
      <div class="muted" style="font-size:0.85rem">Use the player below to pause, replay, or download</div>
    </div>
    <div class="card host-lyrics lyrics">${st.lyrics ? lyricsLinesHTML(st.lyrics.body) : ""}</div>
  `);
  wireTopBar();
}

function screenRoundEnd(st) {
  setApp(`
    ${topBar(st)}
    <div class="card col center">
      <h2>🎉 Song complete!</h2>
      <div class="muted" style="font-size:0.85rem">Song's still loaded in the player below - replay or download it any time</div>
      <div class="row center" style="justify-content:center">
        <button id="nextBtn">▶️ Next round</button>
        <button id="newGameBtn" class="secondary">🏁 New game</button>
      </div>
    </div>
    <div class="card host-lyrics lyrics">${st.lyrics ? lyricsLinesHTML(st.lyrics.body) : ""}</div>
  `);
  wireTopBar();
  document.getElementById("nextBtn").addEventListener("click", () => socket.send({ type: "host:next" }));
  document.getElementById("newGameBtn").addEventListener("click", () => socket.send({ type: "host:newGame" }));
}

function render() {
  if (!authed) return screenKeyForm();
  if (!latestState) {
    setApp(`
      <div class="host-title title">🎤 Song Party</div>
      <div class="spinner"></div>
      <div class="muted center">Loading game...</div>
    `);
    return;
  }

  const st = latestState;
  switch (st.phase) {
    case "lobby": return screenLobby(st);
    case "genre_answering": return screenGenreAnswering(st);
    case "question": return screenLoading(st, "🎲 Claude is thinking of everyone's prompts...");
    case "answering": return screenAnswering(st);
    case "generating_lyrics": return screenLoading(st, "✍️ Claude is writing your song lyrics...");
    case "lyrics_ready": return screenLyricsReady(st);
    case "generating_music": return screenGeneratingMusic(st);
    case "playback": return screenPlayback(st);
    case "round_end": return screenRoundEnd(st);
    default: return screenLoading(st, "...");
  }
}

render();
