import { describe, expect, it, vi } from "vitest";

import { AudioBus, DEFAULT_CUE_GAIN, platformAudioContext } from "./audio-bus";
import { CUE_SPECS } from "./audio";
import { CUES } from "./constants";

/** A recording stand-in for the platform's Web Audio context. */
function fakeContext(): {
  context: AudioContext;
  played: { freq: number; gain: number }[];
} {
  const played: { freq: number; gain: number }[] = [];
  let freq = 0;
  const context = {
    currentTime: 0,
    destination: {},
    createOscillator: () => ({
      type: "sine",
      frequency: {
        setValueAtTime: (v: number) => {
          freq = v;
        },
        exponentialRampToValueAtTime: () => undefined,
      },
      connect: (node: unknown) => node,
      start: () => undefined,
      stop: () => undefined,
    }),
    createGain: () => ({
      gain: {
        setValueAtTime: (v: number) => played.push({ freq, gain: v }),
        exponentialRampToValueAtTime: () => undefined,
      },
      connect: () => undefined,
    }),
    resume: () => Promise.resolve(),
    close: () => Promise.resolve(),
  };
  return { context: context as unknown as AudioContext, played };
}

describe("AudioBus", () => {
  it("plays nothing until a gesture has opened the context", () => {
    const { context, played } = fakeContext();
    const bus = new AudioBus(() => context);
    bus.define("blip", { freq: 440, durationMs: 10 });
    expect(bus.unlocked()).toBe(false);
    bus.play("blip");
    expect(played).toHaveLength(0);
  });

  it("opens the context on the first gesture and sounds from then on", () => {
    const { context, played } = fakeContext();
    const target = new EventTarget();
    const bus = new AudioBus(() => context);
    bus.define("blip", { freq: 440, durationMs: 10 });
    bus.armUnlock(target);
    target.dispatchEvent(new Event("keydown"));
    expect(bus.unlocked()).toBe(true);
    bus.play("blip");
    expect(played).toEqual([{ freq: 440, gain: DEFAULT_CUE_GAIN }]);
  });

  it("throws on a cue that was never defined, rather than going silent", () => {
    const bus = new AudioBus(() => null);
    expect(() => bus.play("nonesuch")).toThrow(/never defined/);
  });

  it("sounds nothing while it is muted, and again once it is not", () => {
    const { context, played } = fakeContext();
    const target = new EventTarget();
    const bus = new AudioBus(() => context);
    bus.define("blip", { freq: 440, gain: 0.5, durationMs: 10 });
    bus.armUnlock(target);
    target.dispatchEvent(new Event("pointerdown"));
    bus.setMuted(true);
    expect(bus.muted()).toBe(true);
    bus.play("blip");
    expect(played).toHaveLength(0);
    bus.setMuted(false);
    bus.play("blip");
    expect(played).toHaveLength(1);
  });

  it("degrades to silence on a platform with no Web Audio", () => {
    const bus = new AudioBus(() => null);
    bus.define("blip", { freq: 440, durationMs: 10 });
    const target = new EventTarget();
    bus.armUnlock(target);
    target.dispatchEvent(new Event("touchstart"));
    expect(() => bus.play("blip")).not.toThrow();
    expect(bus.unlocked()).toBe(false);
  });

  it("survives a context that dies mid-cue", () => {
    const target = new EventTarget();
    const bus = new AudioBus(
      () =>
        ({
          currentTime: 0,
          destination: {},
          createOscillator: () => {
            throw new Error("the context is gone");
          },
          createGain: () => ({}),
          resume: () => Promise.resolve(),
          close: () => Promise.resolve(),
        }) as unknown as AudioContext,
    );
    bus.define("blip", { freq: 440, durationMs: 10 });
    bus.armUnlock(target);
    target.dispatchEvent(new Event("keydown"));
    expect(() => bus.play("blip")).not.toThrow();
  });

  it("drops its gesture listeners when it is disposed, twice over", () => {
    const { context } = fakeContext();
    const target = new EventTarget();
    const bus = new AudioBus(() => context);
    bus.armUnlock(target);
    bus.dispose();
    bus.dispose();
    target.dispatchEvent(new Event("keydown"));
    expect(bus.unlocked()).toBe(false);
  });

  it("reads no context where the platform has no constructor", () => {
    const original = globalThis.AudioContext;
    // @ts-expect-error — removing the constructor is the condition under test.
    delete globalThis.AudioContext;
    expect(platformAudioContext()).toBeNull();
    globalThis.AudioContext = original;
  });

  it("reads no context where the constructor throws", () => {
    const original = globalThis.AudioContext;
    globalThis.AudioContext = vi.fn(() => {
      throw new Error("blocked");
    }) as unknown as typeof AudioContext;
    expect(platformAudioContext()).toBeNull();
    globalThis.AudioContext = original;
  });
});

describe("the cue specs", () => {
  it("defines exactly the seven cues the game names", () => {
    expect(Object.keys(CUE_SPECS).sort()).toEqual(Object.values(CUES).sort());
  });

  it("gives each cue a distinct opening pitch, so they are told apart", () => {
    const pitches = Object.values(CUE_SPECS).map((spec) => spec.freq);
    expect(new Set(pitches).size).toBe(pitches.length);
  });
});
