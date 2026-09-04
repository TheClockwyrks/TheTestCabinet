import { describe, expect, it } from "vitest";

import { AudioBus, DEFAULT_CUE_GAIN } from "./audio-bus";

/** One source the bus opened, and what it was told to do. */
interface FakeSource {
  type: string;
  started: number;
  stopped: number | null;
}

/** A Web Audio context that records rather than sounds. */
function fakeContext(): {
  context: AudioContext;
  sources: FakeSource[];
  closed: () => boolean;
} {
  const sources: FakeSource[] = [];
  let closed = false;
  const param = (): AudioParam =>
    ({
      value: 1,
      setValueAtTime: () => param(),
      linearRampToValueAtTime: () => param(),
      exponentialRampToValueAtTime: () => param(),
      cancelScheduledValues: () => param(),
    }) as unknown as AudioParam;
  const context = {
    currentTime: 0,
    destination: {},
    createOscillator: () => {
      const record: FakeSource = { type: "sine", started: 0, stopped: null };
      sources.push(record);
      return {
        get type() {
          return record.type;
        },
        set type(value: string) {
          record.type = value;
        },
        frequency: param(),
        connect: (next: unknown) => next,
        start: (at: number) => {
          record.started = at;
        },
        stop: (at?: number) => {
          record.stopped = at ?? 0;
        },
      } as unknown as OscillatorNode;
    },
    createGain: () => ({
      gain: param(),
      connect: (next: unknown) => next,
    }),
    resume: () => Promise.resolve(),
    close: () => {
      closed = true;
      return Promise.resolve();
    },
  } as unknown as AudioContext;
  return { context, sources, closed: () => closed };
}

/** A bus already unlocked over a recording context. */
function unlockedBus(): ReturnType<typeof fakeContext> & { bus: AudioBus } {
  const fake = fakeContext();
  const bus = new AudioBus(() => fake.context);
  const page = new EventTarget();
  bus.armUnlock(page);
  page.dispatchEvent(new Event("keydown"));
  return { ...fake, bus };
}

describe("the audio bus", () => {
  it("makes no sound at all before a gesture opens the context", () => {
    const fake = fakeContext();
    const bus = new AudioBus(() => fake.context);
    bus.define("fire", { freq: 400, durationMs: 50 });
    expect(bus.unlocked()).toBe(false);
    bus.play("fire");
    expect(fake.sources).toHaveLength(0);
  });

  it("opens the context on the first gesture, once", () => {
    const fake = fakeContext();
    const bus = new AudioBus(() => fake.context);
    const page = new EventTarget();
    bus.armUnlock(page);
    page.dispatchEvent(new Event("keydown"));
    page.dispatchEvent(new Event("pointerdown"));
    expect(bus.unlocked()).toBe(true);
  });

  it("plays exactly one source for one cue", () => {
    const { bus, sources } = unlockedBus();
    bus.define("fire", { wave: "square", freq: 400, durationMs: 50 });
    bus.play("fire");
    expect(sources).toHaveLength(1);
    expect(sources[0].type).toBe("square");
    bus.play("fire");
    expect(sources).toHaveLength(2);
  });

  it("throws on a cue that was never declared", () => {
    const { bus } = unlockedBus();
    expect(() => bus.play("nope")).toThrow(/never defined/);
    expect(() => bus.setHeld("nope", true)).toThrow(/never defined/);
  });

  it("makes no sound while it is muted, and comes back after", () => {
    const { bus, sources } = unlockedBus();
    bus.define("fire", { freq: 400, durationMs: 50 });
    bus.setMuted(true);
    expect(bus.muted()).toBe(true);
    bus.play("fire");
    expect(sources).toHaveLength(0);
    bus.setMuted(false);
    bus.play("fire");
    expect(sources).toHaveLength(1);
  });

  it("holds one voice for as long as a held cue is asked for", () => {
    const { bus, sources } = unlockedBus();
    bus.define("thrust", { freq: 100, durationMs: 0, held: true });
    bus.setHeld("thrust", true);
    expect(sources).toHaveLength(1);
    expect(bus.holding("thrust")).toBe(true);
    // Asking again while it sounds changes nothing: no second voice.
    bus.setHeld("thrust", true);
    bus.setHeld("thrust", true);
    expect(sources).toHaveLength(1);
    expect(sources[0].stopped).toBeNull();
    bus.setHeld("thrust", false);
    expect(sources[0].stopped).not.toBeNull();
    expect(bus.holding("thrust")).toBe(false);
  });

  it("silences a held cue while muted, and reopens it on the next ask", () => {
    const { bus, sources } = unlockedBus();
    bus.define("thrust", { freq: 100, durationMs: 0, held: true });
    bus.setHeld("thrust", true);
    bus.setMuted(true);
    expect(sources[0].stopped).not.toBeNull();
    expect(bus.holding("thrust")).toBe(false);
    bus.setMuted(false);
    // The game asks every tick, so the voice comes back on the next one.
    bus.setHeld("thrust", true);
    expect(sources).toHaveLength(2);
    expect(sources[1].stopped).toBeNull();
  });

  it("opens a cue held across the unlock on the next ask", () => {
    const fake = fakeContext();
    const bus = new AudioBus(() => fake.context);
    bus.define("thrust", { freq: 100, durationMs: 0, held: true });
    bus.setHeld("thrust", true);
    expect(fake.sources).toHaveLength(0);
    const page = new EventTarget();
    bus.armUnlock(page);
    page.dispatchEvent(new Event("keydown"));
    bus.setHeld("thrust", true);
    expect(fake.sources).toHaveLength(1);
  });

  it("degrades to silence where the platform has no audio at all", () => {
    const bus = new AudioBus(() => null);
    bus.define("fire", { freq: 400, durationMs: 50 });
    bus.define("thrust", { freq: 100, durationMs: 0, held: true });
    const page = new EventTarget();
    bus.armUnlock(page);
    page.dispatchEvent(new Event("keydown"));
    expect(() => {
      bus.play("fire");
      bus.setHeld("thrust", true);
      bus.setHeld("thrust", false);
    }).not.toThrow();
  });

  it("releases every voice and closes the context on dispose", () => {
    const { bus, sources, closed } = unlockedBus();
    bus.define("thrust", { freq: 100, durationMs: 0, held: true });
    bus.setHeld("thrust", true);
    bus.dispose();
    expect(sources[0].stopped).not.toBeNull();
    expect(closed()).toBe(true);
  });

  it("has a default gain a cue can fall back on", () => {
    expect(DEFAULT_CUE_GAIN).toBeGreaterThan(0);
    expect(DEFAULT_CUE_GAIN).toBeLessThanOrEqual(1);
  });
});
