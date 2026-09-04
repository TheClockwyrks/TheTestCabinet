import { describe, expect, it, vi } from "vitest";

import { AudioBus, DEFAULT_CUE_GAIN, platformAudioContext } from "./audio-bus";
import { CUE_SPECS } from "./cues";

/** A recording stand-in for the Web Audio context. */
function fakeContext(): {
  context: AudioContext;
  started: number;
  scheduled: string[];
} {
  const log = { started: 0, scheduled: [] as string[] };
  const param = (): AudioParam =>
    ({
      setValueAtTime: () => {
        log.scheduled.push("set");
      },
      exponentialRampToValueAtTime: () => {
        log.scheduled.push("ramp");
      },
    }) as unknown as AudioParam;
  const context = {
    currentTime: 0,
    destination: {},
    createOscillator: () => {
      const node = {
        type: "sine",
        frequency: param(),
        connect: () => node,
        start: () => {
          log.started += 1;
        },
        stop: () => undefined,
      };
      return node as unknown as OscillatorNode;
    },
    createGain: () => {
      const node = { gain: param(), connect: () => ({}) };
      return node as unknown as GainNode;
    },
    resume: () => Promise.resolve(),
    close: () => Promise.resolve(),
  };
  return {
    context: context as unknown as AudioContext,
    get started() {
      return log.started;
    },
    get scheduled() {
      return log.scheduled;
    },
  };
}

/** A bus whose context is already unlocked. */
function unlocked(): { bus: AudioBus; fake: ReturnType<typeof fakeContext> } {
  const fake = fakeContext();
  const bus = new AudioBus(() => fake.context);
  const target = new EventTarget();
  bus.armUnlock(target);
  target.dispatchEvent(new Event("keydown"));
  return { bus, fake };
}

describe("the audio bus", () => {
  it("starts no sound before the first gesture", () => {
    const fake = fakeContext();
    const bus = new AudioBus(() => fake.context);
    bus.define("fire", CUE_SPECS.fire);
    bus.armUnlock(new EventTarget());
    bus.play("fire");
    expect(bus.unlocked()).toBe(false);
    expect(bus.startedSources()).toBe(0);
    expect(fake.started).toBe(0);
  });

  it("opens the context on the first gesture, then plays", () => {
    const { bus, fake } = unlocked();
    expect(bus.unlocked()).toBe(true);
    bus.define("fire", CUE_SPECS.fire);
    bus.play("fire");
    expect(bus.startedSources()).toBe(1);
    expect(fake.started).toBe(1);
  });

  it("starts nothing at all while it is muted", () => {
    const { bus, fake } = unlocked();
    bus.define("kill", CUE_SPECS.kill);
    bus.setMuted(true);
    for (let i = 0; i < 5; i += 1) bus.play("kill");
    expect(bus.startedSources()).toBe(0);
    expect(fake.started).toBe(0);
    expect(fake.scheduled).toEqual([]);
    // And it plays again the moment it is unmuted.
    bus.setMuted(false);
    bus.play("kill");
    expect(bus.startedSources()).toBe(1);
  });

  it("toggles its mute bit, which is what the mute action does", () => {
    const { bus } = unlocked();
    expect(bus.muted()).toBe(false);
    bus.toggleMuted();
    expect(bus.muted()).toBe(true);
    bus.toggleMuted();
    expect(bus.muted()).toBe(false);
  });

  it("throws on a cue that was never declared", () => {
    const { bus } = unlocked();
    expect(() => bus.play("nonesuch")).toThrow(/never defined/);
  });

  it("reports what has been declared, and replaces a redeclaration", () => {
    const bus = new AudioBus(() => null);
    expect(bus.defined("flip")).toBe(false);
    bus.define("flip", CUE_SPECS.flip);
    expect(bus.defined("flip")).toBe(true);
    bus.define("flip", { freq: 100, durationMs: 10 });
    expect(bus.defined("flip")).toBe(true);
  });

  it("degrades to silence where the platform has no audio", () => {
    const bus = new AudioBus(() => null);
    bus.define("hit", CUE_SPECS.hit);
    const target = new EventTarget();
    bus.armUnlock(target);
    target.dispatchEvent(new Event("pointerdown"));
    expect(() => bus.play("hit")).not.toThrow();
    expect(bus.startedSources()).toBe(0);
  });

  it("never lets a dead context throw into a frame", () => {
    const fake = fakeContext();
    const context = fake.context as unknown as Record<string, unknown>;
    context.createOscillator = () => {
      throw new Error("the context died");
    };
    const bus = new AudioBus(() => fake.context);
    const target = new EventTarget();
    bus.armUnlock(target);
    target.dispatchEvent(new Event("keydown"));
    bus.define("fire", CUE_SPECS.fire);
    expect(() => bus.play("fire")).not.toThrow();
    expect(bus.startedSources()).toBe(0);
  });

  it("sweeps a cue's frequency only when the spec asks for one", () => {
    const { bus, fake } = unlocked();
    bus.define("menu", CUE_SPECS.menu);
    bus.play("menu");
    // Two `set` and one `ramp`: the gain envelope, and no frequency sweep.
    expect(fake.scheduled.filter((entry) => entry === "ramp").length).toBe(1);
    bus.define("flip", CUE_SPECS.flip);
    bus.play("flip");
    expect(fake.scheduled.filter((entry) => entry === "ramp").length).toBe(3);
  });

  it("closes its context on dispose, idempotently", () => {
    const { bus } = unlocked();
    bus.dispose();
    bus.dispose();
    expect(bus.unlocked()).toBe(false);
  });

  it("answers null where the platform declares no AudioContext", () => {
    const globals = globalThis as unknown as Record<string, unknown>;
    const previous = globals.AudioContext;
    delete globals.AudioContext;
    try {
      expect(platformAudioContext()).toBeNull();
    } finally {
      if (previous !== undefined) globals.AudioContext = previous;
    }
  });

  it("answers null where constructing a context throws", () => {
    const globals = globalThis as unknown as Record<string, unknown>;
    const previous = globals.AudioContext;
    globals.AudioContext = vi.fn(() => {
      throw new Error("blocked");
    });
    try {
      expect(platformAudioContext()).toBeNull();
    } finally {
      if (previous === undefined) delete globals.AudioContext;
      else globals.AudioContext = previous;
    }
  });

  it("plays every cue at a sensible peak gain", () => {
    for (const spec of Object.values(CUE_SPECS)) {
      const gain = spec.gain ?? DEFAULT_CUE_GAIN;
      expect(gain).toBeGreaterThan(0);
      expect(gain).toBeLessThanOrEqual(0.3);
      expect(spec.durationMs).toBeGreaterThan(0);
    }
  });
});
