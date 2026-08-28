# Song Party 🎤

A local Wi-Fi party game, Jackbox-style. One device (a laptop hooked up to
a TV works great) runs the **host screen** and plays the song. Everyone
else joins the same URL on their phone. Each round:

1. There's no host-picked genre - the 4 fixed style questions (style,
   vocal, weirdness, influence) get split across the connected players
   (see "Style questions" below) and combined into this round's sound.
2. Claude invents a silly shared scenario and writes each player their own
   related-but-different prompt about it (not one shared question) - so
   their answers naturally read as different beats of one story.
3. Everyone answers their own prompt on their phone, without seeing
   anyone else's prompt or answer.
4. Claude weaves everyone's answers into one coherent set of original song
   lyrics, in the crowd-sourced style - every player who answered is
   verified to be named in the result (retried, then guaranteed by the
   offline template if the AI still misses someone).
5. The server generates a matching track.
6. It plays back **on the host screen** (the one with the TV/speakers) -
   phones just show the lyrics, no audio, no autoplay permission prompts.
7. Anyone can leave 👍/👎 feedback on the round from their phone - see
   "Feedback" below.

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

- On the host screen, hit **Start round**. Click **⛶ Fullscreen** to fill
  the whole screen (handy on a TV).
- First, everyone answers their piece of this round's **style questions**
  (see below) - the host screen shows who's got which question and who's
  done.
- Then the host screen shows each player's own story prompt as they answer
  (there's a soft time limit, and each stage auto-advances once everyone's
  answered or time's up).
- Claude turns everyone's answers into one set of lyrics, in the
  crowd-sourced style - shown on the host screen.
- Hit **Make it a song!** to generate the track. It starts playing
  automatically on the host screen a few seconds later, with a real audio
  player (play/pause/seek/replay) docked at the bottom - use its own pause
  button to stop early. **⬇ Download** saves the track file. It stays
  loaded and replayable through **round_end** too, until the next round
  starts.
- **Next round** to go again, or **New game** to reset everyone.
- On **round_end**, each player's phone offers a one-tap 👍/👎 for the
  round (once per round, per player) - see "Feedback" below. The host
  screen shows the running tally for the room.

### Style questions (replaces the old genre picker)

There's no host-picked genre dropdown anymore - each round, the group
decides the sound together via 4 fixed questions (`lib/genreQuestions.js`):
**Style**, **Vocal**, **Weirdness**, **Influence**. They're distributed
across the connected players, balanced by player count:

- 4 players → one question each.
- More than 4 → still one question each, cycling back through the 4
  (so some questions get asked to more than one player - their answers
  are combined into a single value, e.g. "female and male").
- Fewer than 4 → the questions are split across the players as evenly as
  possible (a solo player answers all 4).

The combined answers become this round's style profile, which steers both
the lyrics (Claude is told the vocal/weirdness/influence direction
directly) and the music generation - for `MUSIC_PROVIDER=elevenlabs` the
players' own words go straight into the composition's style tags; for the
offline synth, the free-text style answer gets matched to the closest of
the 8 built-in genre presets.

### Color theme

Both the host screen and every player's phone have a small theme picker
(top-right corner on phones, next to Fullscreen on the host) - Default,
Blue, Gold, Silver, Dark, Green, Orange. It's a per-device cosmetic
preference (saved in that browser's `localStorage`), not shared game
state - everyone can pick their own without affecting anyone else's
screen.

## How the pieces fit together

```
party-game/
  server.js          Express + WebSocket server, the whole game state machine
  lib/ai.js           Claude calls: generateQuestionSet(), generateLyrics()
  lib/genreQuestions.js Fixed style questions + assignGenreQuestions()/combineAnswers()
  lib/music.js         Pluggable "turn lyrics into a track" interface
  lib/wavSynth.js       Built-in instrumental synthesizer (the default provider)
  lib/genrePresets.js    Tempo/key/chord/waveform settings per genre + free-text matching
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
sections, and sends each section plus style tags built from the players'
own style-question answers (topped up with the matched preset's canned
tags) to `POST https://api.elevenlabs.io/v1/music` as a composition plan.
Each section always gets at least 14s of singing time
regardless of `TRACK_SECONDS` (`MIN_SECTION_MS` in `lib/music.js`) - a
short total split across several sections doesn't leave enough time to
actually sing the lines, which is why early tracks sounded truncated and
skipped most of the lyrics. Requires a paid ElevenLabs plan - music
generation costs credits (see `.env.example`). If the API call fails for
any reason (bad key, network error, rate limit, timeout), the round
automatically falls back to the offline synth rather than breaking - check
the host screen's debug panel (see below) for the actual error.

If ElevenLabs specifically rejects the request for a copyright/Terms-of-
Service reason (`bad_composition_plan`), the server doesn't just give up -
it auto-corrects and retries once: drops every player-supplied style tag
down to just the matched genre's safe canned tags, and strips any literal
occurrence of the player's named artist/band/era out of the actual lyrics
text, then resends. Only falls back to the offline synth if that
corrected retry also fails.

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

## Feedback

Each round_end screen offers a one-tap 👍/👎 per player (`feedback:submit`
over the WebSocket, handled in `server.js`). It's opt-in and per-round -
nobody's forced to rate, and rounds nobody rates are never logged.

Whenever someone *does* rate a round, the server appends one JSON object
to `party-game/data/feedback.jsonl` (created on first use, gitignored) -
not just the thumb, but everything about that round: the theme, the
crowd-sourced style profile, the full lyrics, the track info, and every
player's story prompt/answer and style-question answers. That's the
"document everything about the experience" record - each line is a
complete, self-contained snapshot of one rated round, so you can review
later what worked and what didn't without needing the server still
running. It survives restarts (unlike the rest of the game state, which
is in-memory only).

## Configuration (`.env`)

| Variable | Default | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | - | Optional. Without it, prompts/lyrics come from the offline banks. |
| `CLAUDE_MODEL` | `claude-haiku-4-5` | Model used for prompts + lyrics (cheapest current Claude model). |
| `PORT` | `3000` | Port the server listens on. |
| `ANSWER_SECONDS` | `90` | Soft time limit per round. |
| `TRACK_SECONDS` | `60` | Target length of the generated track (see "On the music generation" above for why this matters more than it sounds). |
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
