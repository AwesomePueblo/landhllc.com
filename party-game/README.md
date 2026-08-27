# Song Party 🎤

A local Wi-Fi party game, Jackbox-style. One device (a laptop hooked up to
a TV works great) runs the **host screen**. Everyone else joins the same
URL on their phone. Each round:

1. Claude comes up with a silly prompt.
2. Everyone answers on their phone.
3. Claude weaves everyone's answers into original song lyrics, in whatever
   genre the host picked.
4. The server generates a matching instrumental track.
5. It plays back **in sync on every connected device** (host screen +
   everyone's phone), with the lyrics displayed karaoke-style.

Everything runs on one machine on your local network. No accounts, no
passwords - just a nickname.

## Setup

```bash
cd party-game
npm install
cp .env.example .env
```

Edit `.env` and add your key from https://console.anthropic.com/ if you
have one:

```
ANTHROPIC_API_KEY=sk-ant-...
```

No key? The game still works end-to-end - it falls back to a built-in
offline prompt bank and a template lyrics writer.

## Run it

```bash
npm start
```

The console prints something like:

```
============================================================
  Party game server running
============================================================
  Players: http://192.168.1.42:3000

  Host screen: http://192.168.1.42:3000/host?key=a1b2c3
  (host key: a1b2c3)
```

- On the **host device** (the one connected to your TV/speakers, or just
  whoever's driving), open the `Host screen` URL. That link already has
  the host key baked in - bookmark it or leave the tab open.
- Everyone else, on the **same Wi-Fi network**, opens the `Players` URL
  in their phone's browser and types in a name.

Important: open the host screen using the printed LAN IP (not
`localhost`), since that's the address the host page shows to players as
the join URL.

## Playing

- On the host screen, pick a genre and hit **Start round**.
- Everyone answers the prompt on their phone (there's a soft time limit,
  and the round auto-advances once everyone's answered or time's up).
- Claude turns the answers into lyrics - shown on the host screen.
- Hit **Make it a song!** to generate the instrumental. Playback starts on
  every device a few seconds later, synced by a shared start time.
- **Next round** to go again, or **New game** to reset everyone.

### A note on phone audio

Mobile browsers block a web page from playing audio automatically -
they require a real tap first. Each phone gets a **"Tap to enable sound"**
button while the song is being produced; tapping it once per visit is
enough to unlock synced playback for the rest of the game.

## How the pieces fit together

```
party-game/
  server.js          Express + WebSocket server, the whole game state machine
  lib/ai.js           Claude calls: generateQuestion(), generateLyrics()
  lib/music.js         Pluggable "turn lyrics into a track" interface
  lib/wavSynth.js       Built-in instrumental synthesizer (the default provider)
  lib/genrePresets.js    Tempo/key/chord/waveform settings per genre
  lib/questions.js        Offline fallback prompt bank
  lib/fallbackLyrics.js    Offline fallback lyrics templater
  public/               Player + host front ends (plain HTML/CSS/JS, no build step)
```

### On the music generation

There's no simple, publicly available API today that turns arbitrary
lyrics into a fully produced *sung* track (services like Suno or Udio
don't expose an official public REST API). Rather than fake that, this
game ships with a real, working alternative: `lib/wavSynth.js` procedurally
generates a short genre-matched instrumental (chords, bassline, arpeggio,
light percussion) with zero external dependencies or API keys, so the
whole pipeline - prompt → answers → lyrics → "a song" → synced playback -
genuinely works out of the box.

`lib/music.js` is written as a small provider interface specifically so a
real sung-vocal backend can be dropped in later without touching the rest
of the game: implement a new branch that calls the provider's API,
downloads the resulting audio into `public/tracks/`, and returns
`{ url, durationSeconds }`.

## Configuration (`.env`)

| Variable | Default | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | - | Optional. Without it, prompts/lyrics come from the offline banks. |
| `CLAUDE_MODEL` | `claude-sonnet-5` | Model used for prompts + lyrics. |
| `PORT` | `3000` | Port the server listens on. |
| `ANSWER_SECONDS` | `90` | Soft time limit per round. |
| `TRACK_SECONDS` | `26` | Length of the generated instrumental. |
| `MUSIC_PROVIDER` | `mock` | Only `mock` (built-in synth) ships today - see above. |

## Limitations (it's a proof of concept)

- Single shared game/room per server process - fine for one party, not for
  running multiple simultaneous games.
- The host key is a lightweight deterrent (random string in the URL), not
  real auth - anyone who can see it can control the game. Fine for "people
  in my living room," not for anything adversarial.
- The generated track is an instrumental synth loop, not a produced song
  with sung vocals - see "On the music generation" above.
- Everything is in-memory; restarting the server clears all players and
  progress.
