"use strict";

const NAME_KEY = "pg_name";
const ID_KEY = "pg_playerId";

const app = document.getElementById("app");

PartyGame.wireThemePicker("themeSelect");

let myId = null;
let awaitingJoin = false;
let latestState = null;
let countdownTimer = null;

// The server pushes a fresh state to every client whenever ANYTHING changes
// (another player joining, someone else submitting their answer, etc.) -
// including to players who are mid-typing. A naive re-render on every one
// of those pushes would blow away the textarea/name field the player is
// actively editing. currentScreenKey tracks which "input screen" is
// currently shown; the input-taking screens skip re-rendering entirely
// when the incoming state doesn't actually change what they'd show.
let currentScreenKey = null;

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

function screenSpinner(text) {
  currentScreenKey = null;
  setApp(`
    <div class="title">🎤 Song Party</div>
    <div class="spinner"></div>
    <div class="muted center pulse">${escapeHtml(text)}</div>
  `);
}

function screenNameForm() {
  if (currentScreenKey === "nameForm") return; // preserve in-progress typing
  currentScreenKey = "nameForm";
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
  currentScreenKey = null;
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
    currentScreenKey = null;
    setApp(`
      <div class="title">🎤 Song Party</div>
      <div class="card col center">
        <div style="font-size:2rem">✅</div>
        <div>Answer locked in! Waiting on the rest of the crew...</div>
        <div class="progress-bar"><div style="width:${pct}%"></div></div>
        <div class="muted">${answeredCount}/${total} answered</div>
      </div>
    `);
    return;
  }

  // Nothing in this screen depends on other players' state (the deadline
  // countdown ticks itself via its own timer) - so if we're already
  // showing the form for this exact round/question, do nothing rather
  // than wiping out what the player is mid-typing.
  const screenKey = `answering:${st.roundNumber}:${st.question}`;
  if (currentScreenKey === screenKey) return;
  currentScreenKey = screenKey;

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

function screenLoading(text) {
  currentScreenKey = null;
  setApp(`
    <div class="title">🎤 Song Party</div>
    <div class="card col center">
      <div class="spinner"></div>
      <div class="pulse">${escapeHtml(text)}</div>
    </div>
  `);
}

function screenLyrics(st) {
  currentScreenKey = null;
  setApp(`
    <div class="title">🎶 ${escapeHtml(st.lyrics.title)}</div>
    <div class="card col center">
      <div class="muted">The song's ready! Watch the host screen for playback 🎧</div>
    </div>
    <div class="card lyrics">${lyricsLinesHTML(st.lyrics.body)}</div>
  `);
}

function screenPlayback(st) {
  currentScreenKey = null;
  setApp(`
    <div class="title">🎶 ${escapeHtml(st.lyrics ? st.lyrics.title : "Now Playing")}</div>
    <div class="card col center">
      <div class="pulse">🎧 Now playing on the host screen</div>
    </div>
    <div class="card lyrics">${st.lyrics ? lyricsLinesHTML(st.lyrics.body) : ""}</div>
  `);
}

function screenRoundEnd(st) {
  currentScreenKey = null;
  setApp(`
    <div class="title">🎉 Song complete!</div>
    <div class="card col center">
      <div>Nice work, crew. Waiting for the host to start the next round...</div>
    </div>
    <div class="card lyrics">${st.lyrics ? lyricsLinesHTML(st.lyrics.body) : ""}</div>
  `);
}

function render() {
  if (!myId) {
    if (awaitingJoin) return screenSpinner("Joining...");
    return screenNameForm();
  }
  if (!latestState) return screenSpinner("Loading game...");

  const st = latestState;
  const me = st.players.find((p) => p.id === myId);

  switch (st.phase) {
    case "lobby": return screenLobby(st, me);
    case "question": return screenLoading("🎲 Claude is thinking of everyone's prompts...");
    case "answering": return screenAnswering(st, me);
    case "generating_lyrics": return screenLoading("✍️ Claude is writing your song lyrics...");
    case "lyrics_ready": return screenLyrics(st);
    case "generating_music": return screenLoading("🎧 Producing your track...");
    case "playback": return screenPlayback(st);
    case "round_end": return screenRoundEnd(st);
    default: return screenSpinner("...");
  }
}

render();
