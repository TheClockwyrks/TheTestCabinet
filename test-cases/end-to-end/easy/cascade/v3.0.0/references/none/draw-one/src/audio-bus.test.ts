import { describe, expect, it } from "vitest";
import { AudioBus, DEFAULT_CUE_GAIN, platformAudioContext } from "./audio-bus";
import { CUE_SPECS } from "./audio";
import { CUES } from "./constants";

/** A stand-in for the Web Audio graph, recording what a cue asked it to build. */
function fakeContext() {
  const started: { gain: number; freq: number }[] = [];
  let gain = 0;
  let freq = 0;
  const context = {
    currentTime: 0,
    createOscillator: () => ({
      type: "sine",
      frequency: {
        setValueAtTime: (value: number) => {
          freq = value;
        },
        exponentialRampToValueAtTime: () => undefined,
      },
      connect: (node: unknown) => node,
      start: () => started.push({ gain, freq }),
      stop: () => undefined,
    }),
    createGain: () => ({
      gain: {
        setValueAtTime: (value: number) => {
          gain = value;
        },
        exponentialRampToValueAtTime: () => undefined,
      },
      connect: () => undefined,
    }),
    destination: {},
    resume: () => Promise.resolve(),
    close: () => Promise.resolve(),
  };
  return { context: context as unknown as AudioContext, started };
}

class Target implements EventTarget {
  private readonly listeners = new Map<string, Set<EventListener>>();

  addEventListener(type: string, listener: EventListener | null): void {
    if (listener === null) return;
    const set = this.listeners.get(type) ?? new Set<EventListener>();
    set.add(listener);
    this.listeners.set(type, set);
  }

  removeEventListener(type: string, listener: EventListener | null): void {
    if (listener === null) return;
    this.listeners.get(type)?.delete(listener);
  }

  dispatchEvent(event: Event): boolean {
    for (const listener of [...(this.listeners.get(event.type) ?? [])]) {
      listener(event);
    }
    return true;
  }
}

describe("the audio bus", () => {
  it("stays silent until a gesture has opened its context", () => {
    const { context, started } = fakeContext();
    const bus = new AudioBus(() => context);
    bus.define("ping", { freq: 400, durationMs: 20 });
    expect(bus.unlocked()).toBe(false);
    bus.play("ping");
    expect(started).toEqual([]);

    const target = new Target();
    bus.armUnlock(target);
    target.dispatchEvent(new Event("pointerdown"));
    expect(bus.unlocked()).toBe(true);
    bus.play("ping");
    expect(started).toHaveLength(1);
    expect(started[0].gain).toBe(DEFAULT_CUE_GAIN);
    expect(started[0].freq).toBe(400);
  });

  it("makes no sound at all while it is muted, and sounds again after", () => {
    const { context, started } = fakeContext();
    const bus = new AudioBus(() => context);
    bus.define("ping", { freq: 400, durationMs: 20 });
    const target = new Target();
    bus.armUnlock(target);
    target.dispatchEvent(new Event("keydown"));

    bus.setMuted(true);
    expect(bus.muted()).toBe(true);
    bus.play("ping");
    expect(started).toEqual([]);
    bus.setMuted(false);
    bus.play("ping");
    expect(started).toHaveLength(1);
  });

  it("throws on a cue that was never declared", () => {
    const bus = new AudioBus(() => null);
    expect(() => bus.play("nope")).toThrow(/never defined/);
  });

  it("degrades to silence where the platform has no context", () => {
    const bus = new AudioBus(() => null);
    bus.define("ping", { freq: 400, durationMs: 20 });
    const target = new Target();
    bus.armUnlock(target);
    target.dispatchEvent(new Event("pointerdown"));
    expect(bus.unlocked()).toBe(false);
    expect(() => bus.play("ping")).not.toThrow();
    bus.dispose();
  });

  it("offers no context where the platform defines none", () => {
    // Node has no Web Audio, which is the case this build has to survive.
    expect(platformAudioContext()).toBeNull();
  });

  it("declares one distinct spec for each of the ten cues", () => {
    const names = Object.values(CUES);
    expect(names).toHaveLength(10);
    for (const name of names) expect(CUE_SPECS[name]).toBeDefined();
    const shapes = names.map((name) => JSON.stringify(CUE_SPECS[name]));
    expect(new Set(shapes).size).toBe(10);
  });

  it("never lets a refused context throw into a frame", () => {
    const bus = new AudioBus(() => {
      throw new Error("no audio here");
    });
    bus.define("ping", { freq: 400, durationMs: 20 });
    const target = new Target();
    bus.armUnlock(target);
    expect(() => target.dispatchEvent(new Event("pointerdown"))).not.toThrow();
    expect(bus.unlocked()).toBe(false);
    expect(() => bus.play("ping")).not.toThrow();
  });
});
