// Spectra — the audio bus: named cues, a muted bus that starts nothing, and no
// sound before the first gesture.

import { describe, expect, it } from "vitest";
import { AudioBus, platformAudioContext } from "./audio-bus";

/** The smallest thing that records what a cue actually did to a context. */
function fakeContext() {
  const started: number[] = [];
  const context = {
    currentTime: 0,
    createOscillator: () => ({
      type: "sine",
      frequency: {
        setValueAtTime: () => undefined,
        exponentialRampToValueAtTime: () => undefined,
      },
      connect: (node: unknown) => node,
      start: (at: number) => void started.push(at),
      stop: () => undefined,
    }),
    createGain: () => ({
      gain: {
        setValueAtTime: () => undefined,
        exponentialRampToValueAtTime: () => undefined,
      },
      connect: () => undefined,
    }),
    destination: {},
    resume: () => Promise.resolve(),
    close: () => Promise.resolve(),
  };
  return { started, context: context as unknown as AudioContext };
}

describe("AudioBus", () => {
  it("starts no source until a gesture has opened the context", () => {
    const { started, context } = fakeContext();
    const target = new EventTarget();
    const bus = new AudioBus(() => context);
    bus.define("fire", { freq: 440, durationMs: 50 });
    bus.armUnlock(target);
    expect(bus.unlocked()).toBe(false);
    bus.play("fire");
    expect(started).toHaveLength(0);

    target.dispatchEvent(new Event("keydown"));
    expect(bus.unlocked()).toBe(true);
    bus.play("fire");
    expect(started).toHaveLength(1);
  });

  it("starts nothing at all while it is muted", () => {
    const { started, context } = fakeContext();
    const target = new EventTarget();
    const bus = new AudioBus(() => context);
    bus.define("fire", { freq: 440, durationMs: 50 });
    bus.armUnlock(target);
    target.dispatchEvent(new Event("keydown"));
    bus.setMuted(true);
    expect(bus.muted()).toBe(true);
    bus.play("fire");
    expect(started).toHaveLength(0);
    bus.setMuted(false);
    bus.play("fire");
    expect(started).toHaveLength(1);
  });

  it("throws on a cue that was never declared", () => {
    const bus = new AudioBus(() => null);
    expect(() => bus.play("nope")).toThrow(/never defined/);
  });

  it("degrades to silence where the platform has no context", () => {
    const bus = new AudioBus(() => null);
    const target = new EventTarget();
    bus.define("fire", { freq: 440, durationMs: 50 });
    bus.armUnlock(target);
    target.dispatchEvent(new Event("keydown"));
    expect(bus.unlocked()).toBe(false);
    expect(() => bus.play("fire")).not.toThrow();
  });

  it("never throws into a frame from a context that has died", () => {
    const bus = new AudioBus(
      () =>
        ({
          currentTime: 0,
          createOscillator: () => {
            throw new Error("gone");
          },
          resume: () => Promise.resolve(),
          close: () => Promise.resolve(),
        }) as unknown as AudioContext,
    );
    const target = new EventTarget();
    bus.define("fire", { freq: 440, durationMs: 50 });
    bus.armUnlock(target);
    target.dispatchEvent(new Event("keydown"));
    expect(() => bus.play("fire")).not.toThrow();
  });

  it("drops its gesture listeners on dispose, idempotently", () => {
    const { started, context } = fakeContext();
    const target = new EventTarget();
    const bus = new AudioBus(() => context);
    bus.define("fire", { freq: 440, durationMs: 50 });
    bus.armUnlock(target);
    bus.dispose();
    bus.dispose();
    target.dispatchEvent(new Event("keydown"));
    bus.play("fire");
    expect(started).toHaveLength(0);
  });

  it("reports no context where the platform declares none", () => {
    expect(platformAudioContext()).toBeNull();
  });
});
