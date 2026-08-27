# Song Party 🎤

A local Wi-Fi party game, Jackbox-style. One device (a laptop hooked up to
a TV works great) runs the **host screen** and plays the song. Everyone
else joins the same URL on their phone. Each round:

1. Claude invents a silly shared scenario and writes each player their own
   related-but-different prompt about it (not one shared question) - so
   their answers naturally read as different beats of one story.
2. Everyone answers their own prompt on their phone, without seeing
   anyone else's prompt or answer.
3. Claude weaves everyone's answers into one coherent set of original song
   lyrics, in whatever genre the host picked.
4. The server generates a matching track.
5. It plays back **on the host screen** (the one with the TV/speakers) -
   phones just show the lyrics, no audio, no autoplay permission prompts.

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

- On the host screen, pick a genre and hit **Start round**. Click
  **⛶ Fullscreen** to fill the whole screen (handy on a TV).
- The host screen shows each player's own prompt as they answer (there's a
  soft time limit, and the round auto-advances once everyone's answered or
  time's up).
- Claude turns everyone's answers into one set of lyrics - shown on the
  host screen.
- Hit **Make it a song!** to generate the track. It starts playing
  automatically on the host screen a few seconds later, with a real audio
  player (play/pause/seek/replay) docked at the bottom - use **⏹ Stop
  song** to end it early, or just let it play out. **⬇ Download** saves
  the track file. It stays loaded and replayable through **round_end**
  too, until the next round starts.
- **Next round** to go again, or **New game** to reset everyone.

## How the pieces fit together

```
party-game/
  server.js          Express + WebSocket server, the whole game state machine
  lib/ai.js           Claude calls: generateQuestionSet(), generateLyrics()
  lib/music.js         Pluggable "turn lyrics into a track" interface
  lib/wavSynth.js       Built-in instrumental synthesizer (the default provider)
  lib/genrePresets.js    Tempo/key/chord/waveform settings per genre
  lib/questions.js        Offline fallback prompt bank
  lib/fallbackLyrics.js    Offline fallback lyrics templater
  public/               Player + host front ends (plain HTML/CSS/JS, no build step)
```

### On the music generation

By default (`MUSIC_PROVIDER=mock`), `lib/wavSynth.js` procedurally
generates a short genre-matched instrumental (chords, bassline, arpeggio,
light percussion) with zero external dependencies or API keys, so the
whole pipeline - prompt → answers → lyrics → "a song" → synced playback -
works fully offline out of the box. No sung vocals in this mode, just an
instrumental loop.

Set `MUSIC_PROVIDER=elevenlabs` (plus `ELEVENLABS_API_KEY`) to get a real
sung vocal track instead, via ElevenLabs' public **Eleven Music API**
(`lib/music.js`, `elevenlabsProvider`). It takes the actual lyrics Claude
(or the offline template) just wrote, splits them into `[Verse]`/`[Chorus]`
sections, and sends each section plus genre-flavored style tags
(`lib/genrePresets.js`) to `POST https://api.elevenlabs.io/v1/music` as a
composition plan. Requires a paid ElevenLabs plan - music generation costs
credits (see `.env.example`). If the API call fails for any reason (bad
key, network error, rate limit), the round automatically falls back to the
offline synth rather than breaking - check the host screen's debug panel
(see below) for the actual error.

`lib/music.js` remains a small provider interface, so another backend can
be dropped in later the same way: implement a new branch that calls the
provider's API, downloads the resulting audio into `public/tracks/`, and
returns `{ result: { url, durationSeconds } }`.

## Debug panel (host screen)

The host screen has a collapsible **AI debug log** on the right showing
the raw request and response for every real API call made that round -
the prompt-generation call, the lyrics-generation call, and (if enabled)
the ElevenLabs music call. It's the way to confirm a round actually came
from Claude/ElevenLabs rather than the offline fallback banks, and to see
the exact error if a call fails. It only shows real API attempts, so it
stays empty while running fully offline. It's host-only - players never
see it.

## Configuration (`.env`)

| Variable | Default | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | - | Optional. Without it, prompts/lyrics come from the offline banks. |
| `CLAUDE_MODEL` | `claude-haiku-4-5` | Model used for prompts + lyrics (cheapest current Claude model). |
| `PORT` | `3000` | Port the server listens on. |
| `ANSWER_SECONDS` | `90` | Soft time limit per round. |
| `TRACK_SECONDS` | `26` | Target length of the generated track. |
| `MUSIC_PROVIDER` | `mock` | `mock` (built-in synth, instrumental) or `elevenlabs` (real sung vocals) - see above. |
| `ELEVENLABS_API_KEY` | - | Required when `MUSIC_PROVIDER=elevenlabs`. |

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
