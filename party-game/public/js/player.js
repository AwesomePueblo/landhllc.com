"use strict";

const NAME_KEY = "pg_name";
const ID_KEY = "pg_playerId";

const app = document.getElementById("app");
const audioEl = document.getElementById("player-audio");

let myId = null;
let awaitingJoin = false;
let latestState = null;
let audioUnlocked = false;
let countdownTimer = null;
let karaokeTimer = null;
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
  setTimeout(() => el.remove(), 3000);
}

const socket = PartyGame.createSocket({
  onOpen() {
    const name = localStorage.getItem(NAME_KEY);
    if (name) {
      awaitingJoin = true;
      socket.send({ type: "join", name, playerId: localStorage.getItem(ID_KEY) || undefined });
    }
    render();
  },
  onMessage(msg) {
    if (msg.type === "joined") {
      myId = msg.playerId;
      awaitingJoin = false;
      localStorage.setItem(ID_KEY, myId);
      localStorage.setItem(NAME_KEY, msg.name);
      render();
    } else if (msg.type === "error") {
      awaitingJoin = false;
      flashError(msg.message || "Something went wrong");
      render();
    } else if (msg.type === "state") {
      latestState = msg.state;
      render();
    } else if (msg.type === "kicked") {
      myId = null;
      localStorage.removeItem(ID_KEY);
      flashError("You were removed from the game.");
      render();
    }
  },
  onClose() {
    // socket auto-reconnects; UI just shows whatever the last known state was
  },
});

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

function wireUnlockButton() {
  const btn = document.getElementById("unlockAudioBtn");
  if (!btn) return;
  btn.addEventListener("click", () => {
    PartyGame.unlockAudio(audioEl);
    audioUnlocked = true;
    render();
  });
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
    if (activeIdx != null) {
      const activeNode = el.querySelector(`[data-line="${activeIdx}"]`);
      if (activeNode) activeNode.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }
  tick();
  karaokeTimer = setInterval(tick, 400);
}

function screenSpinner(text) {
  setApp(`
    <div class="title">🎤 Song Party</div>
    <div class="spinner"></div>
    <div class="muted center pulse">${escapeHtml(text)}</div>
  `);
}

function screenNameForm() {
  setApp(`
    <div class="title">🎤 Song Party</div>
    <div class="card col">
      <h2>What's your name?</h2>
      <input type="text" id="nameInput" maxlength="20" placeholder="e.g. Sam" autocomplete="off" />
      <button id="joinBtn">Join the game</button>
    </div>
  `);
  const input = document.getElementById("nameInput");
  const btn = document.getElementById("joinBtn");
  input.focus();
  function doJoin() {
    const name = input.value.trim();
    if (!name) return;
    localStorage.setItem(NAME_KEY, name);
    awaitingJoin = true;
    socket.send({ type: "join", name, playerId: localStorage.getItem(ID_KEY) || undefined });
    render();
  }
  btn.addEventListener("click", doJoin);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") doJoin(); });
}

function screenLobby(st, me) {
  const list = st.players
    .map((p) => `<span class="badge"><span class="dot" style="background:${p.color}"></span>${escapeHtml(p.name)}${p.connected ? "" : " (away)"}</span>`)
    .join("");
  setApp(`
    <div class="title">🎤 Song Party</div>
    <div class="card col center">
      <div>You're in as <strong>${escapeHtml(me ? me.name : "")}</strong> 🎉</div>
      <div class="muted">Waiting for the host to start the round...</div>
    </div>
    <div class="card col">
      <div class="muted">Players (${st.players.length})</div>
      <div class="player-list">${list || '<span class="muted">Just you so far</span>'}</div>
    </div>
  `);
}

function screenAnswering(st, me) {
  const answeredCount = st.players.filter((p) => p.answered).length;
  const total = st.players.length;
  const pct = total ? Math.round((answeredCount / total) * 100) : 0;

  if (me && me.answered) {
    setApp(`
      <div class="title">🎤 Song Party</div>
      <div class="card col center">
        <div style="font-size:2rem">✅</div>
        <div>Answer locked in! Waiting on the rest of the crew...</div>
        <div class="progress-bar"><div style="width:${pct}%"></div></div>
        <div class="muted">${answeredCount}/${total} answered</div>
        ${audioUnlocked ? "" : '<button id="unlockAudioBtn" class="ghost">🔊 Tap to enable sound for later</button>'}
      </div>
    `);
    wireUnlockButton();
    return;
  }

  setApp(`
    <div class="title">🎤 Song Party</div>
    <div class="card col">
      <div class="muted">Round ${st.roundNumber} · ${escapeHtml(st.genreLabel)}</div>
      <div style="font-size:1.3rem;font-weight:700;line-height:1.4">${escapeHtml(st.question || "")}</div>
    </div>
    <div class="card col">
      <textarea id="answerInput" maxlength="140" placeholder="Type your answer..."></textarea>
      <button id="submitBtn">Submit answer</button>
      <div class="muted center" id="countdown"></div>
    </div>
  `);
  const input = document.getElementById("answerInput");
  const btn = document.getElementById("submitBtn");
  input.focus();
  function submit() {
    const text = input.value.trim();
    if (!text) return;
    socket.send({ type: "answer:submit", text });
  }
  btn.addEventListener("click", submit);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
  });
  if (st.deadline) updateCountdown(st.deadline);
}

function screenLoading(text, opts = {}) {
  setApp(`
    <div class="title">🎤 Song Party</div>
    <div class="card col center">
      <div class="spinner"></div>
      <div class="pulse">${escapeHtml(text)}</div>
      ${opts.withUnlock && !audioUnlocked ? '<button id="unlockAudioBtn" class="ghost">🔊 Tap to enable sound</button>' : ""}
    </div>
  `);
  wireUnlockButton();
}

function screenLyrics(st) {
  setApp(`
    <div class="title">🎶 ${escapeHtml(st.lyrics.title)}</div>
    <div class="card col center">
      <div class="muted">The song's ready! Watch the host screen while it's produced 🎧</div>
      ${audioUnlocked ? "" : '<button id="unlockAudioBtn" class="secondary">🔊 Tap to enable sound on this phone</button>'}
    </div>
    <div class="card lyrics">${lyricsLinesHTML(st.lyrics.body)}</div>
  `);
  wireUnlockButton();
}

function screenPlayback(st) {
  setApp(`
    <div class="title">🎶 ${escapeHtml(st.lyrics ? st.lyrics.title : "Now Playing")}</div>
    <div class="card col center">
      <div class="pulse">🎧 Now playing on everyone's device</div>
      ${audioUnlocked ? "" : '<button id="unlockAudioBtn" class="secondary">▶️ Tap to play on this phone</button>'}
    </div>
    <div class="card lyrics" id="lyricsBlock">${st.lyrics ? lyricsLinesHTML(st.lyrics.body) : ""}</div>
  `);
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
    <div class="title">🎉 Song complete!</div>
    <div class="card col center">
      <div>Nice work, crew. Waiting for the host to start the next round...</div>
      <button id="replayBtn" class="secondary">🔁 Replay on this phone</button>
    </div>
    <div class="card lyrics">${st.lyrics ? lyricsLinesHTML(st.lyrics.body) : ""}</div>
  `);
  const btn = document.getElementById("replayBtn");
  if (btn) {
    btn.addEventListener("click", () => {
      if (st.track) {
        audioEl.src = st.track.url;
        audioEl.currentTime = 0;
        audioEl.play().catch(() => {});
      }
    });
  }
}

function render() {
  if (!myId) {
    if (awaitingJoin) return screenSpinner("Joining...");
    return screenNameForm();
  }
  if (!latestState) return screenSpinner("Loading game...");

  if (latestState.phase !== "playback" && !audioEl.paused) audioEl.pause();

  const st = latestState;
  const me = st.players.find((p) => p.id === myId);

  switch (st.phase) {
    case "lobby": return screenLobby(st, me);
    case "question": return screenLoading("🎲 Claude is thinking of a prompt...");
    case "answering": return screenAnswering(st, me);
    case "generating_lyrics": return screenLoading("✍️ Claude is writing your song lyrics...");
    case "lyrics_ready": return screenLyrics(st);
    case "generating_music": return screenLoading("🎧 Producing your track...", { withUnlock: true });
    case "playback": return screenPlayback(st);
    case "round_end": return screenRoundEnd(st);
    default: return screenSpinner("...");
  }
}

render();
