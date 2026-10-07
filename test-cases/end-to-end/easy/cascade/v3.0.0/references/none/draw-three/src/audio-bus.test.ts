// The audio bus: named cues, a first-gesture unlock, and nothing that can fail a
// frame.

import { describe, expect, it, vi } from "vitest";
import { AudioBus, DEFAULT_CUE_GAIN, platformAudioContext } from "./audio-bus";

interface Recorded {
  started: number;
  gains: number[];
  closed: boolean;
  resumed: number;
}

/** A Web Audio context just real enough for the bus to drive. */
function fakeContext(): { context: AudioContext; log: Recorded } {
  const log: Recorded = { started: 0, gains: [], closed: false, resumed: 0 };
  const param = () => ({
    setValueAtTime: (value: number) => log.gains.push(value),
    exponentialRampToValueAtTime: () => undefined,
  });
  const context = {
    currentTime: 0,
    destination: {},
    createOscillator: () => ({
      type: "sine",
      frequency: {
        setValueAtTime: () => undefined,
        exponentialRampToValueAtTime: () => undefined,
      },
      connect: (node: unknown) => node,
      start: () => {
        log.started += 1;
      },
      stop: () => undefined,
    }),
    createGain: () => ({
      gain: param(),
      connect: (node: unknown) => node,
    }),
    resume: () => {
      log.resumed += 1;
      return Promise.resolve();
    },
    close: () => {
      log.closed = true;
      return Promise.resolve();
    },
  };
  return { context: context as unknown as AudioContext, log };
}

describe("AudioBus", () => {
  it("stays silent until a gesture has opened the context", () => {
    const { context, log } = fakeContext();
    const bus = new AudioBus(() => context);
    bus.define("turn", { freq: 400, durationMs: 40 });
    bus.play("turn");
    expect(bus.unlocked()).toBe(false);
    expect(log.started).toBe(0);
  });

  it("opens on the first gesture and sounds from then on", () => {
    const { context, log } = fakeContext();
    const bus = new AudioBus(() => context);
    const target = new EventTarget();
    bus.armUnlock(target);
    bus.define("turn", { freq: 400, durationMs: 40 });
    target.dispatchEvent(new Event("pointerdown"));
    expect(bus.unlocked()).toBe(true);
    bus.play("turn");
    expect(log.started).toBe(1);
    expect(log.gains[0]).toBe(DEFAULT_CUE_GAIN);
  });

  it("emits nothing at all while muted, and sounds again when unmuted", () => {
    const { context, log } = fakeContext();
    const bus = new AudioBus(() => context);
    const target = new EventTarget();
    bus.armUnlock(target);
    target.dispatchEvent(new Event("keydown"));
    bus.define("turn", { freq: 400, durationMs: 40 });
    bus.setMuted(true);
    expect(bus.muted()).toBe(true);
    bus.play("turn");
    expect(log.started).toBe(0);
    bus.setMuted(false);
    bus.play("turn");
    expect(log.started).toBe(1);
  });

  it("throws on a cue that was never declared", () => {
    const bus = new AudioBus(() => null);
    expect(() => bus.play("nope")).toThrow(/never defined/);
  });

  it("degrades to silence where the platform has no audio", () => {
    const bus = new AudioBus(() => null);
    const target = new EventTarget();
    bus.armUnlock(target);
    target.dispatchEvent(new Event("touchstart"));
    bus.define("turn", { freq: 400, durationMs: 40 });
    expect(() => bus.play("turn")).not.toThrow();
    expect(bus.unlocked()).toBe(false);
  });

  it("swallows a context that dies mid-frame", () => {
    const bus = new AudioBus(() => {
      const { context } = fakeContext();
      return Object.assign(context, {
        createOscillator: () => {
          throw new Error("context is gone");
        },
      }) as AudioContext;
    });
    const target = new EventTarget();
    bus.armUnlock(target);
    target.dispatchEvent(new Event("pointerdown"));
    bus.define("turn", { freq: 400, durationMs: 40 });
    expect(() => bus.play("turn")).not.toThrow();
  });

  it("drops its listeners and closes the context when disposed", () => {
    const { context, log } = fakeContext();
    const bus = new AudioBus(() => context);
    const target = new EventTarget();
    const remove = vi.spyOn(target, "removeEventListener");
    bus.armUnlock(target);
    target.dispatchEvent(new Event("pointerdown"));
    bus.dispose();
    expect(log.closed).toBe(true);
    expect(remove).toHaveBeenCalled();
    expect(bus.unlocked()).toBe(false);
  });

  it("reports no context where the host has none", () => {
    const saved = Reflect.get(globalThis, "AudioContext");
    Reflect.deleteProperty(globalThis, "AudioContext");
    expect(platformAudioContext()).toBeNull();
    if (saved !== undefined) {
      Object.defineProperty(globalThis, "AudioContext", {
        value: saved,
        configurable: true,
      });
    }
  });
});
