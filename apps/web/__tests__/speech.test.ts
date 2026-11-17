import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type FakeUtterance = {
  text: string;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
};

/**
 * A speech engine that behaves like a network voice: speak() only queues, and
 * audio starts later. `ignoreCancel` makes cancel() a no-op, like a cancel
 * that arrives while the voice is still fetching audio.
 */
function installFakeSynth() {
  const synth = {
    speaking: false,
    pending: false,
    ignoreCancel: false,
    queued: null as FakeUtterance | null,
    cancel: vi.fn(() => {
      if (synth.ignoreCancel) return;
      synth.speaking = false;
      synth.pending = false;
      synth.queued = null;
    }),
    speak: vi.fn((utterance: FakeUtterance) => {
      synth.queued = utterance;
      synth.pending = true;
    }),
    /** The browser starts playing the queued utterance. */
    start() {
      const utterance = synth.queued;
      if (!utterance) return;
      synth.pending = false;
      synth.speaking = true;
      utterance.onstart?.();
    },
    /** The playing utterance reaches its end, even if a cancel was ignored. */
    end() {
      const utterance = synth.queued;
      if (!utterance) return;
      synth.speaking = false;
      synth.queued = null;
      utterance.onend?.();
    },
    getVoices: () => synth.voices,
    voices: [] as Array<{ name: string; lang: string; localService: boolean; default: boolean }>,
    addEventListener: () => {},
  };
  class Utterance {
    text: string;
    onstart = null;
    onend = null;
    onerror = null;
    voice = null;
    lang = "";
    rate = 1;
    pitch = 1;
    constructor(text: string) {
      this.text = text;
    }
  }
  Object.defineProperty(window, "speechSynthesis", { value: synth, configurable: true });
  Object.defineProperty(window, "SpeechSynthesisUtterance", { value: Utterance, configurable: true });
  return synth;
}

describe("speech", () => {
  let synth: ReturnType<typeof installFakeSynth>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    synth = installFakeSynth();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("silences an instruction that starts playing after it was cancelled", async () => {
    const { speak } = await import("@/lib/speech");
    const handle = speak("Lie on your back with your knees bent.", () => {}, 20);

    // The pace switches to Real-time while the voice is still loading.
    synth.ignoreCancel = true;
    handle.cancel();
    synth.ignoreCancel = false;

    synth.start();
    expect(synth.speaking).toBe(false);
  });

  it("keeps cancelling for a moment when the first cancel is ignored", async () => {
    const { speak, stopSpeaking } = await import("@/lib/speech");
    speak("Hold the position.", () => {}, 20);
    synth.start();

    synth.ignoreCancel = true;
    stopSpeaking();
    synth.ignoreCancel = false;
    expect(synth.speaking).toBe(true);

    vi.advanceTimersByTime(150);
    expect(synth.speaking).toBe(false);
  });

  it("does not cut off a new instruction spoken right after a cancel", async () => {
    const { speak } = await import("@/lib/speech");
    const first = speak("Hold the position.", () => {}, 20);
    first.cancel();

    speak("Slowly return to the start.", () => {}, 20);
    synth.start();
    vi.advanceTimersByTime(2000);

    expect(synth.speaking).toBe(true);
    expect(synth.queued?.text).toBe("Slowly return to the start.");
  });

  it("does not report a cancelled instruction as finished", async () => {
    const { speak } = await import("@/lib/speech");
    const onDone = vi.fn();
    const handle = speak("Relax and breathe.", onDone, 5);
    handle.cancel();

    vi.advanceTimersByTime(10_000);
    expect(onDone).not.toHaveBeenCalled();
  });

  it("cancels speech left over from before the page loaded", async () => {
    synth.speaking = true;
    await import("@/lib/speech");
    expect(synth.cancel).toHaveBeenCalled();
    expect(synth.speaking).toBe(false);
  });

  it("uses Chrome's Google US English voice, as before", async () => {
    synth.voices = [
      { name: "Microsoft David - English (United States)", lang: "en-US", localService: true, default: true },
      { name: "Microsoft Zira - English (United States)", lang: "en-US", localService: true, default: false },
      { name: "Google US English", lang: "en-US", localService: false, default: false },
      { name: "Google UK English Male", lang: "en-GB", localService: false, default: false },
    ];
    const { pickVoice } = await import("@/lib/speech");
    expect(pickVoice()?.name).toBe("Google US English");
  });

  it("falls back to the device's default voice when no Google voice exists", async () => {
    synth.voices = [
      { name: "Microsoft Zira - English (United States)", lang: "en-US", localService: true, default: false },
      { name: "Microsoft David - English (United States)", lang: "en-US", localService: true, default: true },
    ];
    const { pickVoice } = await import("@/lib/speech");
    expect(pickVoice()?.name).toBe("Microsoft David - English (United States)");
  });

  it("splits long instructions into short sentence chunks", async () => {
    const { splitIntoChunks } = await import("@/lib/speech");
    const text =
      "Lie on your back with your knees bent and feet flat on the floor. Gently tighten your stomach muscles and press your lower back into the floor. Hold for a few seconds, then relax. Stop if pain spreads further down your leg.";
    const chunks = splitIntoChunks(text);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= 140)).toBe(true);
    expect(chunks.join(" ")).toBe(text);
    expect(splitIntoChunks("Hold.")).toEqual(["Hold."]);
    expect(splitIntoChunks("a ".repeat(200)).every((chunk) => chunk.length <= 140)).toBe(true);
  });

  it("speaks the chunks in order and finishes after the last one", async () => {
    const { speak } = await import("@/lib/speech");
    const onDone = vi.fn();
    speak(
      "Lie on your back with your knees bent and feet flat on the floor and your arms by your sides. Gently tighten your stomach muscles and press your lower back into the floor.",
      onDone,
      60,
    );

    const spoken: string[] = [];
    while (synth.queued) {
      spoken.push(synth.queued.text);
      synth.start();
      synth.end();
    }
    expect(spoken.length).toBe(2);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("a stop that Chrome ignores can only finish the current sentence", async () => {
    const { speak } = await import("@/lib/speech");
    const onDone = vi.fn();
    const handle = speak(
      "Lie on your back with your knees bent and feet flat on the floor and your arms by your sides. Gently tighten your stomach muscles and press your lower back into the floor. Stop if pain spreads down your leg.",
      onDone,
      60,
    );
    synth.start();

    // Switch to Real-time: Chrome ignores the stop and finishes the sentence.
    synth.ignoreCancel = true;
    handle.cancel();
    synth.end();
    vi.advanceTimersByTime(30_000);

    expect(synth.speak).toHaveBeenCalledTimes(1);
    expect(onDone).not.toHaveBeenCalled();
  });

  it("moves to the next sentence when the voice sends no end event", async () => {
    const { speak } = await import("@/lib/speech");
    speak(
      "Hold the position and keep breathing slowly and evenly through the whole of the hold phase. Keep your shoulders relaxed and flat on the floor while you hold the tilt.",
      () => {},
      60,
    );
    expect(synth.speak).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(20_000);
    expect(synth.speak).toHaveBeenCalledTimes(2);
  });

  it("enforceSilence cuts off anything still playing", async () => {
    const { enforceSilence, speak } = await import("@/lib/speech");
    speak("Hold the position.", () => {}, 20);
    synth.start();

    enforceSilence();
    expect(synth.speaking).toBe(false);
  });
});
