// Zero-dependency procedural instrumental generator. Renders a short,
// genre-flavored backing track (chord pad + bass + arpeggio + light
// percussion) straight to PCM and wraps it in a WAV header. No external
// audio libraries, no network access, no API key required - this is the
// default "mock" music provider so the whole game works fully offline.
//
// It is intentionally simple: a handful of additive oscillators over a
// short chord loop. It will never sound like a produced record - it exists
// so the end-to-end pipeline (lyrics -> "a song" -> synced playback on
// every device) always works, even with zero API keys configured.
"use strict";

const { getGenre } = require("./genrePresets");

const SAMPLE_RATE = 44100;

function midiToFreq(midiNote) {
  return 440 * Math.pow(2, (midiNote - 69) / 12);
}

function osc(wave, phase) {
  const p = phase - Math.floor(phase);
  switch (wave) {
    case "sine":
      return Math.sin(2 * Math.PI * p);
    case "square":
      return p < 0.5 ? 1 : -1;
    case "triangle":
      return 4 * Math.abs(p - 0.5) - 1;
    case "saw":
      return 2 * (p - Math.floor(p + 0.5));
    default:
      return Math.sin(2 * Math.PI * p);
  }
}

function trapEnv(tRel, dur, attack, release) {
  if (tRel < 0 || tRel > dur) return 0;
  if (tRel < attack) return tRel / attack;
  if (tRel > dur - release) return Math.max(0, (dur - tRel) / release);
  return 1;
}

function decayEnv(tRel, dur, tau) {
  if (tRel < 0 || tRel > dur) return 0;
  return Math.exp(-tRel / tau);
}

function normalize(buf, target = 0.9) {
  let peak = 0;
  for (let i = 0; i < buf.length; i++) {
    const a = Math.abs(buf[i]);
    if (a > peak) peak = a;
  }
  if (peak <= 0) return;
  const scale = target / peak;
  for (let i = 0; i < buf.length; i++) buf[i] *= scale;
}

function encodeWav(floatBuf, sampleRate) {
  const numSamples = floatBuf.length;
  const dataSize = numSamples * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28); // byte rate
  buffer.writeUInt16LE(2, 32); // block align
  buffer.writeUInt16LE(16, 34); // bits per sample
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, floatBuf[i]));
    buffer.writeInt16LE(Math.round(s * 32767), 44 + i * 2);
  }
  return buffer;
}

/**
 * Renders a short instrumental loop for the given genre.
 * Returns { buffer, sampleRate, durationSeconds }.
 */
function generateTrack({ genreId = "pop", seconds = 26 } = {}) {
  const preset = getGenre(genreId);
  const totalSamples = Math.floor(seconds * SAMPLE_RATE);
  const buf = new Float32Array(totalSamples);

  const secondsPerBeat = 60 / preset.tempo;
  const chordLen = preset.chordProg.length;

  function addNote({ freq, startTime, dur, wave, amp, envelope }) {
    const startSample = Math.max(0, Math.floor(startTime * SAMPLE_RATE));
    const endSample = Math.min(totalSamples, Math.floor((startTime + dur) * SAMPLE_RATE));
    for (let i = startSample; i < endSample; i++) {
      const tRel = i / SAMPLE_RATE - startTime;
      const phase = freq * tRel;
      buf[i] += osc(wave, phase) * amp * envelope(tRel);
    }
  }

  function addNoiseBurst({ startTime, dur, amp, envelope }) {
    const startSample = Math.max(0, Math.floor(startTime * SAMPLE_RATE));
    const endSample = Math.min(totalSamples, Math.floor((startTime + dur) * SAMPLE_RATE));
    let prev = 0;
    for (let i = startSample; i < endSample; i++) {
      const tRel = i / SAMPLE_RATE - startTime;
      const white = Math.random() * 2 - 1;
      const hp = white - prev * 0.7;
      prev = white;
      buf[i] += hp * amp * envelope(tRel);
    }
  }

  let bar = 0;
  while (bar * 4 * secondsPerBeat < seconds) {
    const barStart = bar * 4 * secondsPerBeat;
    const barDur = 4 * secondsPerBeat;
    const chordRootSemi = preset.chordProg[bar % chordLen];
    const chordRootFreq = midiToFreq(preset.key + chordRootSemi);

    const tones = [0, preset.third, 7];
    if (preset.seventh) tones.push(preset.third === 3 ? 10 : 11);
    const chordFreqs = tones.map((t) => chordRootFreq * Math.pow(2, t / 12));

    // Sustained pad
    chordFreqs.forEach((f) => {
      addNote({
        freq: f,
        startTime: barStart,
        dur: barDur,
        wave: preset.wave,
        amp: 0.05 * preset.brightness,
        envelope: (tRel) => trapEnv(tRel, barDur, barDur * 0.06, barDur * 0.15),
      });
      if (preset.detune) {
        addNote({
          freq: f * 1.006,
          startTime: barStart,
          dur: barDur,
          wave: preset.wave,
          amp: 0.035 * preset.brightness,
          envelope: (tRel) => trapEnv(tRel, barDur, barDur * 0.06, barDur * 0.15),
        });
      }
    });

    // Bass, on every beat
    for (let beat = 0; beat < 4; beat++) {
      const t = barStart + beat * secondsPerBeat;
      if (t >= seconds) break;
      const bassFreq = preset.power ? chordRootFreq : chordRootFreq / 2;
      addNote({
        freq: bassFreq,
        startTime: t,
        dur: secondsPerBeat * 0.92,
        wave: preset.power ? "square" : "sine",
        amp: 0.18,
        envelope: (tRel) => decayEnv(tRel, secondsPerBeat * 0.92, secondsPerBeat * 0.5),
      });
    }

    // Arpeggio
    const stepsPerBar = Math.max(2, Math.round(preset.arpRate * 4));
    const stepDur = barDur / stepsPerBar;
    const arpTones = [...chordFreqs, chordRootFreq * 2];
    for (let s = 0; s < stepsPerBar; s++) {
      const t = barStart + s * stepDur;
      if (t >= seconds) break;
      const f = arpTones[s % arpTones.length];
      addNote({
        freq: f,
        startTime: t,
        dur: stepDur * 0.85,
        wave: preset.wave,
        amp: 0.09 * preset.brightness,
        envelope: (tRel) => decayEnv(tRel, stepDur * 0.85, stepDur * 0.35),
      });
    }

    // Percussion
    for (let beat = 0; beat < 4; beat++) {
      const t = barStart + beat * secondsPerBeat;
      if (t >= seconds) break;
      if (preset.kick) {
        addNote({
          freq: 58,
          startTime: t,
          dur: 0.16,
          wave: "sine",
          amp: 0.32,
          envelope: (tRel) => decayEnv(tRel, 0.16, 0.045),
        });
      }
      addNoiseBurst({
        startTime: t + secondsPerBeat / 2,
        dur: 0.05,
        amp: preset.kick ? 0.06 : 0.045,
        envelope: (tRel) => decayEnv(tRel, 0.05, 0.02),
      });
    }

    bar++;
  }

  normalize(buf);
  return {
    buffer: encodeWav(buf, SAMPLE_RATE),
    sampleRate: SAMPLE_RATE,
    durationSeconds: seconds,
  };
}

module.exports = { generateTrack };
