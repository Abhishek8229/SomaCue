"use client";

/**
 * Short celebration chimes made with the Web Audio API (no audio files).
 * Every function is a safe no-op where Web Audio is missing (SSR, jsdom).
 */

type AudioContextClass = typeof AudioContext;

let context: AudioContext | null = null;

function audioContextClass(): AudioContextClass | null {
  if (typeof window === "undefined") return null;
  const scope = window as typeof window & { webkitAudioContext?: AudioContextClass };
  return scope.AudioContext ?? scope.webkitAudioContext ?? null;
}

function getContext(): AudioContext | null {
  if (context) return context;
  const Context = audioContextClass();
  if (!Context) return null;
  try {
    context = new Context();
  } catch {
    context = null;
  }
  return context;
}

function ready(): AudioContext | null {
  const audio = getContext();
  if (!audio) return null;
  if (audio.state === "suspended") void audio.resume().catch(() => {});
  return audio;
}

/** Create or resume the shared context. Call from a click so autoplay rules allow sound. */
export function primeCelebrationAudio() {
  ready();
}

type Tone = {
  type: OscillatorType;
  from: number;
  to?: number;
  start: number;
  attack: number;
  sustain: number;
  release: number;
  gain: number;
};

function playTone(audio: AudioContext, destination: AudioNode, tone: Tone) {
  const oscillator = audio.createOscillator();
  const envelope = audio.createGain();
  const begin = audio.currentTime + tone.start;
  const peak = begin + tone.attack;
  const fade = peak + tone.sustain;
  const end = fade + tone.release;

  oscillator.type = tone.type;
  oscillator.frequency.setValueAtTime(tone.from, begin);
  if (tone.to) oscillator.frequency.exponentialRampToValueAtTime(tone.to, peak + tone.sustain * 0.5 + 0.02);

  envelope.gain.setValueAtTime(0.0001, begin);
  envelope.gain.exponentialRampToValueAtTime(tone.gain, peak);
  envelope.gain.setValueAtTime(tone.gain, fade);
  envelope.gain.exponentialRampToValueAtTime(0.0001, end);

  oscillator.connect(envelope);
  envelope.connect(destination);
  oscillator.onended = () => {
    oscillator.disconnect();
    envelope.disconnect();
  };
  oscillator.start(begin);
  oscillator.stop(end + 0.02);
}

/** Small, soft pop with a quick upward glide (about 160 ms). */
export function playRepChime() {
  const audio = ready();
  if (!audio) return;
  try {
    playTone(audio, audio.destination, {
      type: "sine",
      from: 660,
      to: 990,
      start: 0,
      attack: 0.008,
      sustain: 0.02,
      release: 0.13,
      gain: 0.1,
    });
    playTone(audio, audio.destination, {
      type: "triangle",
      from: 1320,
      to: 1980,
      start: 0,
      attack: 0.006,
      sustain: 0.01,
      release: 0.08,
      gain: 0.025,
    });
  } catch {
    // Sound is a bonus; never break playback over it.
  }
}

const SET_NOTES = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6

/** Bigger, brighter rising arpeggio with a soft shimmer (about 1 s). */
export function playSetChime() {
  const audio = ready();
  if (!audio) return;
  try {
    const bus = audio.createGain();
    bus.gain.value = 1;
    bus.connect(audio.destination);
    SET_NOTES.forEach((frequency, index) => {
      const last = index === SET_NOTES.length - 1;
      const start = index * 0.09;
      playTone(audio, bus, {
        type: "triangle",
        from: frequency,
        start,
        attack: 0.015,
        sustain: last ? 0.22 : 0.06,
        release: last ? 0.55 : 0.32,
        gain: last ? 0.17 : 0.13,
      });
      // Shimmer: a quiet octave overtone on each note.
      playTone(audio, bus, {
        type: "sine",
        from: frequency * 2,
        start: start + 0.005,
        attack: 0.02,
        sustain: last ? 0.18 : 0.04,
        release: last ? 0.5 : 0.25,
        gain: 0.035,
      });
    });
    window.setTimeout(() => bus.disconnect(), 1400);
  } catch {
    // Sound is a bonus; never break playback over it.
  }
}
