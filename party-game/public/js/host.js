"use strict";

const app = document.getElementById("app");
const audioEl = document.getElementById("host-audio");

let authed = false;
let hostKey = new URLSearchParams(location.search).get("key") || "";
let latestState = null;
let countdownTimer = null;
let karaokeTimer = null;
let scheduledTrackUrl = null;
let audioUnlocked = false;

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
    }
  },
  onClose() {},
});

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

function schedulePlayback(st) {
  if (!st.track || scheduledTrackUrl === st.track.url) return;
  scheduledTrackUrl = st.track.url;
  audioEl.src = st.track.url;
  audioEl.load();
  const delay = st.track.startAt - Date.now();
  const doPlay = () => audioEl.play().catch(() => {});
  if (delay <= 0) doPlay();
  else setTimeout(doPlay, delay);
}

function startKaraoke(st) {
  if (karaokeTimer) clearInterval(karaokeTimer);
  if (!st.track || !st.lyrics) return;
  const lines = st.lyrics.body.split("\n");
  const contentLines = lines
    .map((l, i) => ({ i, isContent: l.trim() && !/^\[.*\]$/.test(l.trim()) }))
    .filter((l) => l.isContent);
  const total = contentLines.length || 1;

  function tick() {
    const el = document.getElementById("lyricsBlock");
    if (!el) { clearInterval(karaokeTimer); return; }
    const elapsed = (Date.now() - st.track.startAt) / 1000;
    const frac = Math.max(0, Math.min(0.999, elapsed / st.track.durationSeconds));
    const activeEntry = contentLines[Math.floor(frac * total)];
    const activeIdx = activeEntry ? activeEntry.i : null;
    el.querySelectorAll("[data-line]").forEach((node) => {
      node.classList.toggle("active-line", Number(node.dataset.line) === activeIdx);
    });
  }
  tick();
  karaokeTimer = setInterval(tick, 400);
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

function genreSelectHTML(st) {
  const options = st.genres
    .map((g) => `<option value="${g.id}" ${g.id === st.genre ? "selected" : ""}>${escapeHtml(g.label)}</option>`)
    .join("");
  return `<select id="genreSelect" style="padding:10px 14px;border-radius:10px;font-size:1rem">${options}</select>`;
}

function wireGenreSelect() {
  const sel = document.getElementById("genreSelect");
  if (sel) sel.addEventListener("change", () => socket.send({ type: "host:setGenre", genre: sel.value }));
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
      <div class="muted">Round ${st.roundNumber}</div>
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

function screenLobby(st) {
  setApp(`
    ${topBar(st)}
    <div class="card col center">
      <h2>Ready when you are</h2>
      <div class="muted">Everyone should join at the URL above first.</div>
      <div class="row center" style="justify-content:center">
        <span class="muted">Genre:</span> ${genreSelectHTML(st)}
      </div>
      <button id="startBtn" ${st.players.length ? "" : "disabled"}>▶️ Start round</button>
    </div>
  `);
  wireGenreSelect();
  wireKickButtons();
  document.getElementById("startBtn").addEventListener("click", () => socket.send({ type: "host:start" }));
}

function screenLoading(st, text) {
  setApp(`
    ${topBar(st)}
    <div class="card col center">
      <div class="spinner"></div>
      <div class="pulse" style="font-size:1.3rem">${escapeHtml(text)}</div>
    </div>
  `);
  wireKickButtons();
}

function screenAnswering(st) {
  const answeredCount = st.players.filter((p) => p.answered).length;
  const total = st.players.length;
  const pct = total ? Math.round((answeredCount / total) * 100) : 0;
  setApp(`
    ${topBar(st)}
    <div class="card col center">
      <div class="muted">${escapeHtml(st.genreLabel)}</div>
      <div class="big-question">${escapeHtml(st.question || "")}</div>
    </div>
    <div class="card col">
      <div class="progress-bar"><div style="width:${pct}%"></div></div>
      <div class="row center" style="justify-content:space-between">
        <span class="muted">${answeredCount}/${total} answered</span>
        <span class="muted" id="countdown"></span>
      </div>
      <button id="lockBtn" class="secondary">🔒 Lock answers now</button>
    </div>
  `);
  wireKickButtons();
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
  wireKickButtons();
  document.getElementById("makeSongBtn").addEventListener("click", () => socket.send({ type: "host:makeSong" }));
}

function screenGeneratingMusic(st) {
  setApp(`
    ${topBar(st)}
    <div class="card col center">
      <div class="spinner"></div>
      <div class="pulse" style="font-size:1.3rem">🎧 Producing your ${escapeHtml(st.genreLabel)} track...</div>
    </div>
    <div class="card host-lyrics lyrics">${st.lyrics ? lyricsLinesHTML(st.lyrics.body) : ""}</div>
  `);
  wireKickButtons();
}

function screenPlayback(st) {
  setApp(`
    ${topBar(st)}
    <div class="card col center">
      <div class="pulse" style="font-size:1.3rem">🎧 Now playing - ${escapeHtml(st.lyrics ? st.lyrics.title : "")}</div>
      ${audioUnlocked ? "" : '<button id="unlockAudioBtn" class="secondary">▶️ Tap to play on this screen</button>'}
    </div>
    <div class="card host-lyrics lyrics" id="lyricsBlock">${st.lyrics ? lyricsLinesHTML(st.lyrics.body) : ""}</div>
  `);
  wireKickButtons();
  const btn = document.getElementById("unlockAudioBtn");
  if (btn) {
    btn.addEventListener("click", () => {
      if (st.track) {
        audioEl.src = st.track.url;
        audioEl.load();
        audioEl.play().catch(() => {});
        scheduledTrackUrl = st.track.url;
      }
      audioUnlocked = true;
      render();
    });
  }
  schedulePlayback(st);
  startKaraoke(st);
}

function screenRoundEnd(st) {
  setApp(`
    ${topBar(st)}
    <div class="card col center">
      <h2>🎉 Song complete!</h2>
      <div class="row center" style="justify-content:center">
        <button id="nextBtn">▶️ Next round</button>
        <button id="newGameBtn" class="secondary">🏁 New game</button>
      </div>
    </div>
    <div class="card host-lyrics lyrics">${st.lyrics ? lyricsLinesHTML(st.lyrics.body) : ""}</div>
  `);
  wireKickButtons();
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
    case "question": return screenLoading(st, "🎲 Claude is thinking of a prompt...");
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
