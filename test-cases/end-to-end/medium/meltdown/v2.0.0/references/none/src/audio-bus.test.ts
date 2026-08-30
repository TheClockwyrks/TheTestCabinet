// The audio bus.
//
// Ten cues, synthesized, no file loaded (specs/audio.md). Three properties carry
// the weight: nothing about audio may fail a frame, muting emits nothing at all,
// and the context does not open until a gesture asks for it.

import { describe, expect, it, vi } from "vitest";
import { AudioBus, DEFAULT_CUE_GAIN } from "./audio-bus";
import { CUES } from "./constants";
import { CUE_SPECS } from "./audio";

/** A recording stand-in for the parts of Web Audio the bus actually touches. */
function fakeContext() {
  const started: Array<{ type: string; freq: number; gain: number }> = [];
  let closed = false;
  const context = {
    currentTime: 0,
    destination: { kind: "destination" },
    closed: () => closed,
    started,
    createOscillator() {
      const node = {
        type: "sine",
        frequency: {
          setValueAtTime(value: number) {
            node.freq = value;
          },
          exponentialRampToValueAtTime() {},
        },
        freq: 0,
        connect: (next: unknown) => next,
        start() {
          started.push({ type: node.type, freq: node.freq, gain: lastGain });
        },
        stop() {},
      };
      return node;
    },
    createGain() {
      return {
        gain: {
          setValueAtTime(value: number) {
            lastGain = value;
          },
          exponentialRampToValueAtTime() {},
        },
        connect: (next: unknown) => next,
      };
    },
    resume: () => Promise.resolve(),
    close: () => {
      closed = true;
      return Promise.resolve();
    },
  };
  let lastGain = 0;
  return context;
}

type Fake = ReturnType<typeof fakeContext>;

function bench() {
  const context = fakeContext();
  const bus = new AudioBus(() => context as unknown as AudioContext);
  for (const [cue, spec] of CUE_SPECS) bus.define(cue, spec);
  const target = new EventTarget();
  bus.armUnlock(target);
  return { bus, context, target };
}

/** The gesture that opens the context. */
function gesture(target: EventTarget): void {
  target.dispatchEvent(new Event("pointerdown"));
}

describe("the cue table", () => {
  it("declares one cue per event, and the ten the spec names", () => {
    const declared = CUE_SPECS.map(([cue]) => cue);
    expect(new Set(declared).size).toBe(declared.length);
    expect(new Set(declared)).toEqual(new Set(Object.values(CUES)));
  });

  it("keeps every cue short, so none of them outlasts its event", () => {
    for (const [, spec] of CUE_SPECS) {
      expect(spec.durationMs).toBeGreaterThan(0);
      expect(spec.durationMs).toBeLessThanOrEqual(1000);
    }
  });

  it("gives each cue its own voice, so none is mistaken for another", () => {
    const voices = CUE_SPECS.map(
      ([, spec]) => `${spec.wave ?? "sine"}:${spec.freq}:${spec.freqTo ?? ""}`,
    );
    expect(new Set(voices).size).toBe(voices.length);
  });
});

describe("the first-interaction unlock", () => {
  it("opens no context until a gesture asks for one", () => {
    const b = bench();
    expect(b.bus.unlocked()).toBe(false);
    b.bus.play(CUES.place);
    expect(b.context.started).toHaveLength(0);
  });

  it("opens on the first gesture and plays from then on", () => {
    const b = bench();
    gesture(b.target);
    expect(b.bus.unlocked()).toBe(true);
    b.bus.play(CUES.place);
    expect(b.context.started).toHaveLength(1);
  });

  it("takes a keypress as a gesture too", () => {
    const b = bench();
    b.target.dispatchEvent(new Event("keydown"));
    expect(b.bus.unlocked()).toBe(true);
  });

  it("disarms after the first gesture rather than opening twice", () => {
    const b = bench();
    gesture(b.target);
    gesture(b.target);
    expect(b.bus.unlocked()).toBe(true);
  });
});

describe("playing", () => {
  it("sounds the waveform and frequency the cue declared", () => {
    const b = bench();
    gesture(b.target);
    b.bus.play(CUES.trip);
    expect(b.context.started[0]).toMatchObject({
      type: "sawtooth",
      freq: 260,
    });
  });

  it("falls back to the default gain where a cue names none", () => {
    const b = bench();
    gesture(b.target);
    b.bus.define("plain", { freq: 300, durationMs: 20 });
    b.bus.play("plain");
    expect(b.context.started[0].gain).toBe(DEFAULT_CUE_GAIN);
  });

  it("throws on a cue that was never declared, so a typo is not silence", () => {
    const b = bench();
    gesture(b.target);
    expect(() => b.bus.play("no-such-cue")).toThrow(/never defined/);
  });

  it("degrades to silence where the platform has no audio at all", () => {
    const bus = new AudioBus(() => null);
    bus.define("blip", { freq: 200, durationMs: 10 });
    const target = new EventTarget();
    bus.armUnlock(target);
    gesture(target);
    expect(bus.unlocked()).toBe(false);
    expect(() => bus.play("blip")).not.toThrow();
  });

  it("degrades to silence when a node throws mid-frame", () => {
    const context = fakeContext();
    context.createOscillator = () => {
      throw new Error("context died");
    };
    const bus = new AudioBus(() => context as unknown as AudioContext);
    bus.define("blip", { freq: 200, durationMs: 10 });
    const target = new EventTarget();
    bus.armUnlock(target);
    gesture(target);
    expect(() => bus.play("blip")).not.toThrow();
  });

  it("redeclaring a cue replaces it", () => {
    const b = bench();
    gesture(b.target);
    b.bus.define(CUES.place, { wave: "sine", freq: 111, durationMs: 10 });
    b.bus.play(CUES.place);
    expect(b.context.started[0]).toMatchObject({ type: "sine", freq: 111 });
  });
});

describe("mute", () => {
  it("starts no source at all, whatever is played", () => {
    const b = bench();
    gesture(b.target);
    b.bus.setMuted(true);
    expect(b.bus.muted()).toBe(true);
    for (const [cue] of CUE_SPECS) b.bus.play(cue);
    expect(b.context.started).toHaveLength(0);
  });

  it("still throws on an undeclared cue while muted", () => {
    const b = bench();
    b.bus.setMuted(true);
    expect(() => b.bus.play("no-such-cue")).toThrow();
  });

  it("comes back the moment it is unmuted", () => {
    const b = bench();
    gesture(b.target);
    b.bus.setMuted(true);
    b.bus.play(CUES.fire);
    b.bus.setMuted(false);
    b.bus.play(CUES.fire);
    expect(b.context.started).toHaveLength(1);
  });
});

describe("disposing", () => {
  it("closes the context and drops the gesture listeners", () => {
    const b = bench();
    gesture(b.target);
    b.bus.dispose();
    expect(b.context.closed()).toBe(true);
    expect(b.bus.unlocked()).toBe(false);
  });

  it("is idempotent, because teardown races", () => {
    const b = bench();
    b.bus.dispose();
    expect(() => b.bus.dispose()).not.toThrow();
  });

  it("swallows a context that refuses to close", () => {
    const context = fakeContext() as Fake & { close: () => Promise<void> };
    context.close = () => Promise.reject(new Error("nope"));
    const bus = new AudioBus(() => context as unknown as AudioContext);
    const target = new EventTarget();
    bus.armUnlock(target);
    gesture(target);
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(() => bus.dispose()).not.toThrow();
    spy.mockRestore();
  });
});
