// The audio bus, over a Web Audio context faked just far enough to observe:
// what a cue plays, at what gain, and that nothing about audio can fail a
// frame. The real synthesis is one oscillator through one gain envelope; the
// fake writes down the calls instead of making sound.

import { describe, expect, it } from "vitest";
import { AudioBus, DEFAULT_CUE_GAIN } from "./audio-bus";

interface PlayedNote {
  type: string;
  freq: number;
  gain: number;
  started: boolean;
}

/** A context that records what is asked of it. */
function fakeContext(): { context: AudioContext; notes: PlayedNote[] } {
  const notes: PlayedNote[] = [];
  const destination = {};
  const context = {
    currentTime: 0,
    destination,
    resume: () => Promise.resolve(),
    close: () => Promise.resolve(),
    createOscillator() {
      const note: PlayedNote = {
        type: "sine",
        freq: 0,
        gain: 0,
        started: false,
      };
      notes.push(note);
      return {
        set type(value: string) {
          note.type = value;
        },
        frequency: {
          setValueAtTime: (value: number) => {
            note.freq = value;
          },
          exponentialRampToValueAtTime: () => undefined,
        },
        connect: () => ({
          connect: (next: unknown) => next,
        }),
        start: () => {
          note.started = true;
        },
        stop: () => undefined,
      };
    },
    createGain() {
      return {
        gain: {
          setValueAtTime: (value: number) => {
            const note = notes[notes.length - 1];
            if (note) note.gain = value;
          },
          exponentialRampToValueAtTime: () => undefined,
        },
        connect: (next: unknown) => next,
      };
    },
  } as unknown as AudioContext;
  return { context, notes };
}

/** A bus already unlocked over a recording context. */
function unlockedBus(): { bus: AudioBus; notes: PlayedNote[] } {
  const { context, notes } = fakeContext();
  const bus = new AudioBus(() => context);
  const target = new EventTarget();
  bus.armUnlock(target);
  target.dispatchEvent(new Event("pointerdown"));
  return { bus, notes };
}

describe("cues", () => {
  it("plays a declared cue with its spec's wave, frequency, and gain", () => {
    const { bus, notes } = unlockedBus();
    bus.define("blip", {
      wave: "triangle",
      freq: 440,
      gain: 0.3,
      durationMs: 50,
    });
    bus.play("blip");
    expect(notes).toEqual([
      { type: "triangle", freq: 440, gain: 0.3, started: true },
    ]);
  });

  it("defaults the gain when the spec names none", () => {
    const { bus, notes } = unlockedBus();
    bus.define("blip", { freq: 200, durationMs: 10 });
    bus.play("blip");
    expect(notes[0].gain).toBe(DEFAULT_CUE_GAIN);
  });

  it("throws on a cue that was never defined: a typo is not silence", () => {
    const { bus } = unlockedBus();
    expect(() => bus.play("nope")).toThrow(/never defined/);
  });
});

describe("muting", () => {
  it("silences a cue without skipping it, and reports its own bit", () => {
    const { bus, notes } = unlockedBus();
    bus.define("blip", { freq: 200, durationMs: 10 });
    expect(bus.muted()).toBe(false);
    bus.setMuted(true);
    expect(bus.muted()).toBe(true);
    bus.play("blip");
    expect(notes).toEqual([]);
    bus.setMuted(false);
    bus.play("blip");
    expect(notes).toHaveLength(1);
  });
});

describe("the first-gesture unlock", () => {
  it("opens no context until a gesture arrives", () => {
    const { context } = fakeContext();
    let opened = 0;
    const bus = new AudioBus(() => {
      opened += 1;
      return context;
    });
    const target = new EventTarget();
    bus.armUnlock(target);
    expect(opened).toBe(0);
    expect(bus.unlocked()).toBe(false);
    target.dispatchEvent(new Event("keydown"));
    expect(opened).toBe(1);
    expect(bus.unlocked()).toBe(true);
    // The listeners came down with the unlock: no second open.
    target.dispatchEvent(new Event("keydown"));
    expect(opened).toBe(1);
  });

  it("stays silent, not broken, where the platform has no Web Audio", () => {
    const bus = new AudioBus(() => null);
    const target = new EventTarget();
    bus.armUnlock(target);
    target.dispatchEvent(new Event("pointerdown"));
    bus.define("blip", { freq: 200, durationMs: 10 });
    expect(() => bus.play("blip")).not.toThrow();
    expect(bus.unlocked()).toBe(false);
  });

  it("disposes idempotently, dropping the gesture listeners", () => {
    const { context } = fakeContext();
    let opened = 0;
    const bus = new AudioBus(() => {
      opened += 1;
      return context;
    });
    const target = new EventTarget();
    bus.armUnlock(target);
    bus.dispose();
    bus.dispose();
    target.dispatchEvent(new Event("pointerdown"));
    expect(opened).toBe(0);
  });
});
