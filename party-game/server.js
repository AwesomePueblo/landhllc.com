// Local Wi-Fi party game server.
//
// One process, one shared game ("room") - built for a group of people on
// the same Wi-Fi network, Jackbox-style: one device (a laptop plugged into
// a TV, say) opens /host, everyone else opens the printed URL on their
// phone. No accounts, no passwords - just a nickname.
//
// Flow: lobby -> Claude writes a prompt -> everyone answers on their phone
// -> Claude turns the answers into song lyrics in the chosen genre -> a
// genre-matched instrumental is generated -> it plays back in sync on
// every connected device.
"use strict";

require("dotenv").config();

const path = require("path");
const os = require("os");
const crypto = require("crypto");
const express = require("express");
const { WebSocketServer, WebSocket } = require("ws");

const ai = require("./lib/ai");
const music = require("./lib/music");
const { fallbackLyrics } = require("./lib/fallbackLyrics");
const { randomQuestionSet } = require("./lib/questions");
const { GENRE_LIST, getGenre } = require("./lib/genrePresets");

const PORT = Number(process.env.PORT) || 3000;
const ANSWER_SECONDS = Number(process.env.ANSWER_SECONDS) || 90;
const PLAYBACK_BUFFER_MS = 4000;
const HOST_KEY = crypto.randomBytes(3).toString("hex");

// ---------------------------------------------------------------------------
// Game state (single shared room)
// ---------------------------------------------------------------------------

const players = new Map(); // playerId -> { id, name, color, ws, connected, answer, question }

const state = {
  phase: "lobby", // lobby | question | answering | generating_lyrics | lyrics_ready | generating_music | playback | round_end
  roundNumber: 0,
  genre: "pop",
  questionSet: null, // { theme, questions: [...] } - each player gets their own entry, see startRound()
  deadline: null,
  lyrics: null, // { title, body }
  track: null, // { url, durationSeconds, startAt }
  previousThemes: [],
  debugLog: [], // host-only: raw request/response for each AI + music call, newest first
};

const DEBUG_LOG_MAX = 20;

// Records one AI/music provider call so the host UI's debug panel can show
// exactly what was sent and received - the only way to confirm a round
// actually came from a real API call rather than the offline fallback.
function logDebug(type, { request, response, error, usedFallback } = {}) {
  state.debugLog.unshift({
    id: crypto.randomUUID(),
    type, // "question" | "lyrics" | "music"
    at: Date.now(),
    request: request ?? null,
    response: response ?? null,
    error: error ?? null,
    usedFallback: !!usedFallback,
  });
  if (state.debugLog.length > DEBUG_LOG_MAX) state.debugLog.length = DEBUG_LOG_MAX;
}

let autoLockTimer = null;
let roundEndTimer = null;

function clean(text, max = 140) {
  return String(text || "").trim().slice(0, max);
}

function pickColor(seed) {
  const hash = crypto.createHash("md5").update(seed).digest();
  const hue = hash[0] * (360 / 255);
  return `hsl(${Math.round(hue)}, 70%, 55%)`;
}

// ---------------------------------------------------------------------------
// State broadcasting
// ---------------------------------------------------------------------------

// forHost=true gets the full picture (everyone's individual prompt, the
// debug log). A player only ever gets their OWN prompt in `question` -
// never anyone else's - via viewerId.
function buildState(forHost, viewerId) {
  const revealPhases = ["lyrics_ready", "generating_music", "playback", "round_end"];
  const viewer = viewerId ? players.get(viewerId) : null;
  const base = {
    phase: state.phase,
    roundNumber: state.roundNumber,
    genre: state.genre,
    genreLabel: getGenre(state.genre).label,
    genres: GENRE_LIST.map((id) => ({ id, label: getGenre(id).label })),
    question: viewer ? viewer.question : null,
    questionTheme: state.questionSet ? state.questionSet.theme : null,
    deadline: state.deadline,
    answerSeconds: ANSWER_SECONDS,
    players: [...players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      connected: !!p.connected,
      answered: !!p.answer,
      question: forHost ? p.question : undefined,
    })),
    answers: revealPhases.includes(state.phase)
      ? [...players.values()].filter((p) => p.answer).map((p) => ({ name: p.name, text: p.answer, question: p.question }))
      : undefined,
    lyrics: state.lyrics,
    track: state.track,
  };
  if (forHost) base.debugLog = state.debugLog;
  return base;
}

function sendTo(ws, obj) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

function broadcastState() {
  const hostPayload = JSON.stringify({ type: "state", state: buildState(true) });
  wss.clients.forEach((c) => {
    if (c.readyState !== WebSocket.OPEN) return;
    if (c.isHost) {
      c.send(hostPayload);
      return;
    }
    c.send(JSON.stringify({ type: "state", state: buildState(false, c.playerId) }));
  });
}

// ---------------------------------------------------------------------------
// Round flow
// ---------------------------------------------------------------------------

function clearTimers() {
  if (autoLockTimer) clearTimeout(autoLockTimer);
  if (roundEndTimer) clearTimeout(roundEndTimer);
  autoLockTimer = null;
  roundEndTimer = null;
}

async function startRound() {
  if (state.phase !== "lobby" && state.phase !== "round_end") return;
  clearTimers();
  players.forEach((p) => {
    p.answer = null;
    p.question = null;
  });
  state.lyrics = null;
  state.track = null;
  state.phase = "question";
  broadcastState();

  const connectedPlayers = [...players.values()].filter((p) => p.connected);
  const playerCount = Math.max(connectedPlayers.length, 1);

  const q = await ai.generateQuestionSet({ playerCount, previousThemes: state.previousThemes });
  if (q.request) logDebug("question", q);
  const questionSet = q.result || randomQuestionSet(playerCount);
  state.questionSet = questionSet;
  state.previousThemes.push(questionSet.theme);

  // Each connected player gets their own related-but-different prompt from
  // the set (cycling through it if there are more players than prompts).
  connectedPlayers.forEach((p, i) => {
    p.question = questionSet.questions[i % questionSet.questions.length];
  });

  state.roundNumber += 1;
  state.deadline = Date.now() + ANSWER_SECONDS * 1000;
  state.phase = "answering";
  broadcastState();

  autoLockTimer = setTimeout(() => {
    if (state.phase === "answering") lockAnswers();
  }, ANSWER_SECONDS * 1000);
}

function maybeAutoLock() {
  const connected = [...players.values()].filter((p) => p.connected);
  if (connected.length > 0 && connected.every((p) => p.answer)) {
    lockAnswers();
  }
}

async function lockAnswers() {
  if (state.phase !== "answering") return;
  clearTimers();

  const answers = [...players.values()]
    .filter((p) => p.answer)
    .map((p) => ({ name: p.name, text: p.answer, question: p.question }));

  if (answers.length === 0) {
    state.phase = "lobby";
    state.questionSet = null;
    broadcastState();
    return;
  }

  state.phase = "generating_lyrics";
  broadcastState();

  const genreLabel = getGenre(state.genre).label;
  const theme = state.questionSet ? state.questionSet.theme : "tonight's chaos";
  const lyricsCall = await ai.generateLyrics({ theme, genre: state.genre, genreLabel, answers });
  if (lyricsCall.request) logDebug("lyrics", lyricsCall);
  const lyrics = lyricsCall.result || fallbackLyrics({ theme, genre: genreLabel, answers });

  state.lyrics = lyrics;
  state.phase = "lyrics_ready";
  broadcastState();
}

async function makeSong() {
  if (state.phase !== "lyrics_ready") return;
  state.phase = "generating_music";
  broadcastState();

  let track;
  try {
    const genreLabel = getGenre(state.genre).label;
    const musicCall = await music.generateSong({ lyrics: state.lyrics.body, genre: state.genre, genreLabel });
    if (musicCall.request) logDebug("music", musicCall);
    track = musicCall.result;
    if (!track) throw new Error(musicCall.error || "music provider returned no track");
  } catch (err) {
    console.error("[server] music generation failed:", err);
    state.phase = "lyrics_ready";
    broadcastState();
    return;
  }

  state.track = {
    url: track.url,
    durationSeconds: track.durationSeconds,
    startAt: Date.now() + PLAYBACK_BUFFER_MS,
  };
  state.phase = "playback";
  broadcastState();

  const totalMs = PLAYBACK_BUFFER_MS + track.durationSeconds * 1000 + 1500;
  roundEndTimer = setTimeout(() => {
    if (state.phase === "playback") {
      state.phase = "round_end";
      broadcastState();
    }
  }, totalMs);
}

function nextRound() {
  if (state.phase !== "round_end") return;
  startRound();
}

function resetGame() {
  clearTimers();
  players.forEach((p) => {
    p.answer = null;
    p.question = null;
  });
  state.phase = "lobby";
  state.roundNumber = 0;
  state.questionSet = null;
  state.deadline = null;
  state.lyrics = null;
  state.track = null;
  state.previousThemes = [];
  broadcastState();
}

function kickPlayer(playerId) {
  const player = players.get(playerId);
  if (!player) return;
  if (player.ws) {
    sendTo(player.ws, { type: "kicked" });
    player.ws.close();
  }
  players.delete(playerId);
  broadcastState();
}

// ---------------------------------------------------------------------------
// WebSocket handling
// ---------------------------------------------------------------------------

function handleJoin(ws, msg) {
  const name = clean(msg.name, 20);
  if (!name) {
    sendTo(ws, { type: "error", message: "Name required" });
    return;
  }

  let player = msg.playerId && players.get(msg.playerId);
  if (!player) {
    const id = crypto.randomUUID();
    player = { id, name, color: pickColor(id), ws: null, connected: false, answer: null, question: null };
    players.set(id, player);
  } else {
    player.name = name;
  }

  // A player joining mid-round has no assigned prompt yet - give them one
  // from the current set (cycling through it) so they're not left blank.
  if (state.phase === "answering" && state.questionSet && !player.question) {
    const assignedCount = [...players.values()].filter((p) => p.question).length;
    player.question = state.questionSet.questions[assignedCount % state.questionSet.questions.length];
  }

  player.ws = ws;
  player.connected = true;
  ws.playerId = player.id;
  ws.isHost = false;

  sendTo(ws, { type: "joined", playerId: player.id, name: player.name });
  broadcastState();
}

function handleHostAuth(ws, msg) {
  if (msg.key !== HOST_KEY) {
    sendTo(ws, { type: "error", message: "Invalid host key. Check the server console." });
    return;
  }
  ws.isHost = true;
  sendTo(ws, { type: "host:authOk" });
  sendTo(ws, { type: "state", state: buildState(true) });
}

function handleAnswerSubmit(ws, msg) {
  const player = players.get(ws.playerId);
  if (!player || state.phase !== "answering") return;
  const text = clean(msg.text, 140);
  if (!text) return;
  player.answer = text;
  broadcastState();
  maybeAutoLock();
}

function handleMessage(ws, msg) {
  if (!msg || typeof msg.type !== "string") return;
  switch (msg.type) {
    case "join":
      handleJoin(ws, msg);
      break;
    case "host:auth":
      handleHostAuth(ws, msg);
      break;
    case "host:start":
      if (ws.isHost) startRound();
      break;
    case "host:setGenre":
      if (ws.isHost && GENRE_LIST.includes(msg.genre)) {
        state.genre = msg.genre;
        broadcastState();
      }
      break;
    case "answer:submit":
      handleAnswerSubmit(ws, msg);
      break;
    case "host:lockAnswers":
      if (ws.isHost) lockAnswers();
      break;
    case "host:makeSong":
      if (ws.isHost) makeSong();
      break;
    case "host:next":
      if (ws.isHost) nextRound();
      break;
    case "host:newGame":
      if (ws.isHost) resetGame();
      break;
    case "host:kick":
      if (ws.isHost && msg.playerId) kickPlayer(msg.playerId);
      break;
    case "ping":
      sendTo(ws, { type: "pong" });
      break;
    default:
      break;
  }
}

function handleClose(ws) {
  if (ws.isHost) return;
  const player = players.get(ws.playerId);
  if (player && player.ws === ws) {
    player.connected = false;
    player.ws = null;
    broadcastState();
  }
}

// ---------------------------------------------------------------------------
// HTTP + WebSocket servers
// ---------------------------------------------------------------------------

const app = express();
app.use(express.static(path.join(__dirname, "public")));
app.get("/host", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "host.html"));
});
app.get("/config", (req, res) => {
  res.json({ genres: GENRE_LIST.map((id) => ({ id, label: getGenre(id).label })) });
});

const server = app.listen(PORT, "0.0.0.0", () => {
  const ips = getLocalIPs();
  console.log("");
  console.log("=".repeat(60));
  console.log("  Party game server running");
  console.log("=".repeat(60));
  if (ips.length === 0) {
    console.log(`  Players: http://localhost:${PORT}`);
  } else {
    ips.forEach((ip) => console.log(`  Players: http://${ip}:${PORT}`));
  }
  console.log("");
  const hostIp = ips[0] || "localhost";
  console.log(`  Host screen: http://${hostIp}:${PORT}/host?key=${HOST_KEY}`);
  console.log(`  (host key: ${HOST_KEY})`);
  console.log("");
  console.log(
    ai.isConfigured()
      ? "  ANTHROPIC_API_KEY detected - Claude will write prompts + lyrics."
      : "  No ANTHROPIC_API_KEY set - using offline prompt bank + template lyrics."
  );
  console.log("=".repeat(60));
  console.log("");
});

const wss = new WebSocketServer({ server });

wss.on("connection", (ws) => {
  ws.isAlive = true;
  ws.on("pong", () => {
    ws.isAlive = true;
  });
  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    handleMessage(ws, msg);
  });
  ws.on("close", () => handleClose(ws));
});

const heartbeat = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

server.on("close", () => clearInterval(heartbeat));

function getLocalIPs() {
  const nets = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === "IPv4" && !net.internal) ips.push(net.address);
    }
  }
  return ips;
}

process.on("SIGINT", () => {
  console.log("\nShutting down party server.");
  process.exit(0);
});
