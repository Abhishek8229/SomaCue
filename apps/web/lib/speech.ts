"use client";

/**
 * Thin wrapper around the browser Web Speech API (speechSynthesis). Speech is
 * fully on-device or browser-provided: no text is sent to SomaCue servers.
 */

export function speechSupported() {
  return typeof window !== "undefined" && "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
}

// Chrome's "Google US English" voice is the preferred voice. It is an online
// voice that Chrome plays itself, and Chrome can ignore a stop request for it.
// To keep that safe, speak() sends long instructions one sentence at a time:
// a missed stop can only finish the current sentence, never the rest.
const PREFERRED = [/natural/i, /google (us|uk) english/i, /aria|jenny|guy|samantha|daniel/i];

let cachedVoice: SpeechSynthesisVoice | null | undefined;

/** The voice used for instructions. Exported for tests. */
export function pickVoice(): SpeechSynthesisVoice | null {
  if (cachedVoice !== undefined) return cachedVoice;
  const voices = window.speechSynthesis.getVoices();
  if (voices.length === 0) return null; // not loaded yet; try again next time
  const english = voices.filter((voice) => voice.lang.toLowerCase().startsWith("en"));
  const pool = english.length ? english : voices;
  cachedVoice =
    PREFERRED.map((pattern) => pool.find((voice) => pattern.test(voice.name))).find(Boolean) ??
    pool.find((voice) => voice.default) ??
    pool[0] ??
    null;
  return cachedVoice;
}

if (typeof window !== "undefined" && speechSupported()) {
  window.speechSynthesis.addEventListener?.("voiceschanged", () => {
    cachedVoice = undefined;
  });
  // Speech left over from before a reload or another visit to this page.
  window.speechSynthesis.cancel();
  // Leaving or reloading the page always ends speech.
  window.addEventListener("pagehide", () => window.speechSynthesis.cancel());
}

const CHUNK_MAX_CHARS = 140;

/**
 * Splits an instruction into short pieces: whole sentences, merged while they
 * stay short, and over-long sentences split at commas or spaces.
 */
export function splitIntoChunks(text: string, max = CHUNK_MAX_CHARS): string[] {
  const sentences = text.replace(/\s+/g, " ").trim().match(/[^.!?]+[.!?]+["')\]]*|[^.!?]+$/g) ?? [];
  const pieces: string[] = [];
  for (const raw of sentences) {
    let sentence = raw.trim();
    while (sentence.length > max) {
      const head = sentence.slice(0, max);
      const cut = Math.max(head.lastIndexOf(", "), head.lastIndexOf("; "));
      const at = cut > max * 0.4 ? cut + 1 : head.lastIndexOf(" ") > 0 ? head.lastIndexOf(" ") : max;
      pieces.push(sentence.slice(0, at).trim());
      sentence = sentence.slice(at).trim();
    }
    if (sentence) pieces.push(sentence);
  }
  const chunks: string[] = [];
  for (const piece of pieces) {
    const last = chunks.at(-1);
    if (last && last.length + piece.length + 1 <= max) chunks[chunks.length - 1] = `${last} ${piece}`;
    else chunks.push(piece);
  }
  return chunks;
}

/** Generous time for one chunk, used when the voice sends no "end" event. */
function chunkSeconds(chunk: string) {
  const words = chunk.split(" ").filter(Boolean).length;
  return words * 0.6 + 2.5;
}

export type SpeakHandle = { cancel: () => void };

type Session = { cancelled: boolean };

/** The instruction currently being spoken. */
let current: Session | null = null;

/** Cancel now, and keep cancelling briefly in case the browser starts late. */
function silence() {
  const synth = window.speechSynthesis;
  if (current) current.cancelled = true;
  synth.cancel();
  // Online voices fetch audio before playing. A cancel during that fetch can
  // be ignored and the audio plays anyway, so check again for a moment.
  for (const delay of [120, 400, 900, 1800]) {
    window.setTimeout(() => {
      const live = current !== null && !current.cancelled;
      if (!live && (synth.speaking || synth.pending)) synth.cancel();
    }, delay);
  }
}

/**
 * Speak one instruction. `onDone` runs exactly once: when the last sentence
 * ends, or when a safety timer fires (some voices never send "end").
 */
export function speak(text: string, onDone: () => void, safetySeconds: number): SpeakHandle {
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    window.clearTimeout(timer);
    onDone();
  };
  const timer = window.setTimeout(finish, safetySeconds * 1000);

  if (!speechSupported()) {
    return { cancel: () => window.clearTimeout(timer) };
  }

  const synth = window.speechSynthesis;
  if (current) current.cancelled = true;
  synth.cancel();
  const session: Session = { cancelled: false };
  current = session;
  const chunks = splitIntoChunks(text);
  const voice = pickVoice();
  let index = 0;
  let chunkTimer = 0;

  const next = () => {
    window.clearTimeout(chunkTimer);
    if (session.cancelled) return;
    if (index >= chunks.length) {
      finish();
      return;
    }
    const chunk = chunks[index];
    index += 1;
    const utterance = new SpeechSynthesisUtterance(chunk);
    if (voice) utterance.voice = voice;
    utterance.lang = voice?.lang ?? "en-US";
    utterance.rate = 0.95;
    utterance.pitch = 1;
    let advanced = false;
    const advance = () => {
      if (advanced) return;
      advanced = true;
      next();
    };
    // A cancelled sentence that starts anyway is stopped the moment it starts.
    utterance.onstart = () => {
      if (session.cancelled) synth.cancel();
    };
    utterance.onend = advance;
    utterance.onerror = advance;
    // Online voices sometimes send no events; move on after a generous wait.
    chunkTimer = window.setTimeout(advance, chunkSeconds(chunk) * 1000);
    synth.speak(utterance);
  };
  next();

  return {
    cancel: () => {
      finished = true;
      window.clearTimeout(timer);
      window.clearTimeout(chunkTimer);
      if (current === session) silence();
      else session.cancelled = true;
    },
  };
}

export function stopSpeaking() {
  if (speechSupported()) silence();
}

/**
 * Silence anything still playing when speech is not allowed (Real-time pace,
 * muted, paused or stopped). Cheap enough to call on a short interval.
 */
export function enforceSilence() {
  if (!speechSupported()) return;
  const synth = window.speechSynthesis;
  if (current) current.cancelled = true;
  if (synth.speaking || synth.pending) synth.cancel();
}

export function isSpeaking() {
  return speechSupported() && window.speechSynthesis.speaking;
}
