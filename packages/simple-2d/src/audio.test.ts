import { describe, expect, it, vi } from "vitest";
import { AudioBus, type AudioBusOptions } from "./audio";
import type { EngineEventMap } from "./contract";

type Spy = ReturnType<typeof vi.fn>;
type CuePlayed = EngineEventMap["cue:played"];

interface FakeOscillator {
  type: string;
  frequency: { setValueAtTime: Spy; linearRampToValueAtTime: Spy };
  connect: Spy;
  start: Spy;
  stop: Spy;
}

interface FakeGain {
  gain: { setValueAtTime: Spy; exponentialRampToValueAtTime: Spy };
  connect: Spy;
}

interface FakeSource {
  buffer: AudioBuffer | null;
  connect: Spy;
  start: Spy;
}

/**
 * A stand-in for the browser's audio graph. jsdom has no Web Audio at all, so
 * every assertion about *when* nodes are created — never before the unlock, never
 * while muted — is made against this fake rather than against a real context.
 */
function fakeContext() {
  const oscillators: FakeOscillator[] = [];
  const gains: FakeGain[] = [];
  const sources: FakeSource[] = [];
  const resume = vi.fn(() => Promise.resolve());

  const ctx = {
    currentTime: 10,
    destination: {},
    resume,
    createOscillator: vi.fn(() => {
      const osc: FakeOscillator = {
        type: "sine",
        frequency: {
          setValueAtTime: vi.fn(),
          linearRampToValueAtTime: vi.fn(),
        },
        connect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
      };
      oscillators.push(osc);
      return osc;
    }),
    createGain: vi.fn(() => {
      const node: FakeGain = {
        gain: {
          setValueAtTime: vi.fn(),
          exponentialRampToValueAtTime: vi.fn(),
        },
        connect: vi.fn(),
      };
      gains.push(node);
      return node;
    }),
    createBufferSource: vi.fn(() => {
      const source: FakeSource = {
        buffer: null,
        connect: vi.fn(),
        start: vi.fn(),
      };
      sources.push(source);
      return source;
    }),
  };

  return {
    ctx,
    oscillators,
    gains,
    sources,
    resume,
    as: () => ctx as unknown as AudioContext,
  };
}

/** An event the bus published, kept exactly as it crossed the port. */
interface Recorded {
  event: string;
  payload: unknown;
}

/**
 * A bus whose collaborators are scripted, with its events collected.
 *
 * Everything the bus reaches — the broadcaster, the frame clock, the asset
 * loader, the context factory — arrives through its options, so a test decides
 * all four and the bus itself needs no browser.
 */
function busWith(options: Omit<AudioBusOptions, "emit"> = {}) {
  const events: Recorded[] = [];
  return {
    bus: new AudioBus({
      ...options,
      emit: (event, payload) => {
        events.push({ event, payload });
      },
    }),
    events,
  };
}

/** A bus over a fake graph, plus the factory spy and the fake's node registries. */
function busWithFake(
  options: Omit<AudioBusOptions, "emit" | "audioContext"> = {},
) {
  const fake = fakeContext();
  const factory = vi.fn(() => fake.as());
  return { ...busWith({ ...options, audioContext: factory }), factory, fake };
}

/** The `cue:played` payloads among the recorded events, in the order they arrived. */
function cues(events: Recorded[]): CuePlayed[] {
  return events
    .filter((e) => e.event === "cue:played")
    .map((e) => e.payload as CuePlayed);
}

/** How many `audio:unlocked` events were published. */
function unlocks(events: Recorded[]): number {
  return events.filter((e) => e.event === "audio:unlocked").length;
}

/**
 * The total size of every container the bus holds, without naming any of them.
 *
 * The bus is required to hold nothing that grows with the length of a run, and
 * the check has to survive a field being renamed or moved — so it walks whatever
 * the bus owns rather than asserting against one particular field.
 */
function retained(bus: AudioBus): number {
  return Object.values(
    bus as unknown as Record<string, unknown>,
  ).reduce<number>((total, value) => {
    if (Array.isArray(value)) return total + value.length;
    if (value instanceof Map || value instanceof Set) return total + value.size;
    return total;
  }, 0);
}

const BEEP = { freq: 440, durationMs: 50 } as const;

/** A decoded buffer, identified by reference rather than by contents. */
function fakeBuffer(): AudioBuffer {
  return { duration: 1.5 } as unknown as AudioBuffer;
}

describe("AudioBus declaration", () => {
  it("plays a cue declared by a spec", () => {
    const { bus, events } = busWithFake();
    bus.define("bounce", { ...BEEP, gain: 0.5 });

    bus.play("bounce");

    expect(cues(events)).toEqual([{ cue: "bounce", t: 0, gain: 0.5 }]);
  });

  it("plays a cue backed by a produced file, decoded through the asset loader", async () => {
    const buffer = fakeBuffer();
    const loadAudio = vi.fn(() => Promise.resolve(buffer));
    const { bus, events, fake } = busWithFake({ loadAudio });

    await bus.load("impact", "audio/impact.wav");
    bus.unlock();
    bus.play("impact");

    expect(loadAudio).toHaveBeenCalledWith("audio/impact.wav");
    expect(fake.sources[0]?.buffer).toBe(buffer);
    expect(cues(events)).toEqual([{ cue: "impact", t: 0, gain: 1 }]);
  });

  it("declares the name only once the cue is playable", async () => {
    let release = (_buffer: AudioBuffer): void => undefined;
    const { bus } = busWithFake({
      loadAudio: () =>
        new Promise<AudioBuffer>((resolve) => {
          release = resolve;
        }),
    });

    const pending = bus.load("impact", "audio/impact.wav");
    expect(() => bus.play("impact")).toThrow(/impact/);

    release(fakeBuffer());
    await pending;
    expect(() => bus.play("impact")).not.toThrow();
  });

  it("lets either kind of declaration replace the other under one name", async () => {
    const { bus, events, fake } = busWithFake({
      loadAudio: () => Promise.resolve(fakeBuffer()),
    });

    bus.define("hit", { ...BEEP, gain: 0.5 });
    await bus.load("hit", "audio/hit.wav");
    bus.unlock();
    bus.play("hit");
    bus.define("hit", { ...BEEP, gain: 0.1 });
    bus.play("hit");

    expect(cues(events).map((c) => c.gain)).toEqual([1, 0.1]);
    expect(fake.sources).toHaveLength(1);
    expect(fake.oscillators).toHaveLength(1);
  });

  it("leaves a name undeclared when its load is refused", async () => {
    const { bus } = busWithFake({
      loadAudio: () =>
        Promise.reject(new Error('asset path "../theme.ogg" escapes the root')),
    });

    await expect(bus.load("theme", "../theme.ogg")).rejects.toThrow(/escapes/);

    expect(() => bus.play("theme")).toThrow(/theme/);
  });

  it("leaves a name's existing cue in place when a later load fails", async () => {
    const { bus, events } = busWithFake({
      loadAudio: () => Promise.reject(new Error("HTTP 404")),
    });
    bus.define("theme", { ...BEEP, gain: 0.3 });

    await expect(bus.load("theme", "audio/theme.ogg")).rejects.toThrow(/404/);
    bus.play("theme");

    expect(cues(events)).toEqual([{ cue: "theme", t: 0, gain: 0.3 }]);
  });
});

describe("AudioBus playback", () => {
  it("throws on a cue that was never declared, and announces nothing", () => {
    const { bus, events } = busWithFake();
    bus.define("bounce", BEEP);

    expect(() => bus.play("bunce")).toThrow(/bunce/);
    expect(events).toEqual([]);
  });

  it("falls back to the engine's default gain when the spec names none", () => {
    const { bus, events } = busWithFake();
    bus.define("bounce", BEEP);

    bus.play("bounce");

    expect(cues(events)[0]?.gain).toBe(0.2);
  });

  it("sweeps the frequency and decays the gain across the cue's duration", () => {
    const { bus, fake } = busWithFake();
    bus.unlock();
    bus.define("swoop", {
      wave: "square",
      freq: 200,
      freqTo: 800,
      gain: 0.4,
      durationMs: 250,
    });

    bus.play("swoop");

    const osc = fake.oscillators[0];
    const amp = fake.gains[0];
    const start = fake.ctx.currentTime;
    const end = start + 0.25;
    expect(osc?.type).toBe("square");
    expect(osc?.frequency.setValueAtTime).toHaveBeenCalledWith(200, start);
    expect(osc?.frequency.linearRampToValueAtTime).toHaveBeenCalledWith(
      800,
      end,
    );
    expect(amp?.gain.setValueAtTime).toHaveBeenCalledWith(0.4, start);
    expect(amp?.gain.exponentialRampToValueAtTime).toHaveBeenCalledWith(
      expect.any(Number),
      end,
    );
    expect(osc?.start).toHaveBeenCalledWith(start);
    expect(osc?.stop).toHaveBeenCalledWith(end);
    expect(osc?.connect).toHaveBeenCalledWith(amp);
    expect(amp?.connect).toHaveBeenCalledWith(fake.ctx.destination);
  });

  it("holds the frequency when the spec names no sweep, and defaults to a sine", () => {
    const { bus, fake } = busWithFake();
    bus.unlock();
    bus.define("blip", BEEP);

    bus.play("blip");

    expect(fake.oscillators[0]?.type).toBe("sine");
    expect(
      fake.oscillators[0]?.frequency.linearRampToValueAtTime,
    ).toHaveBeenCalledWith(440, fake.ctx.currentTime + 0.05);
  });

  it("treats a zero or negative duration as an instant cue rather than a rewind", () => {
    const { bus, fake } = busWithFake();
    bus.unlock();
    bus.define("instant", { freq: 440, durationMs: 0 });
    bus.define("backwards", { freq: 440, durationMs: -100 });

    bus.play("instant");
    bus.play("backwards");

    const start = fake.ctx.currentTime;
    expect(fake.oscillators[0]?.stop).toHaveBeenCalledWith(start);
    expect(fake.oscillators[1]?.stop).toHaveBeenCalledWith(start);
  });

  it("announces but does not synthesize a cue whose gain is zero", () => {
    const { bus, events, fake } = busWithFake();
    bus.unlock();
    bus.define("silent", { ...BEEP, gain: 0 });

    bus.play("silent");

    expect(cues(events)).toHaveLength(1);
    expect(fake.ctx.createOscillator).not.toHaveBeenCalled();
  });

  it("builds a fresh buffer source for every play of a file-backed cue", async () => {
    const { bus, fake } = busWithFake({
      loadAudio: () => Promise.resolve(fakeBuffer()),
    });
    await bus.load("impact", "audio/impact.wav");
    bus.unlock();

    bus.play("impact");
    bus.play("impact");

    expect(fake.sources).toHaveLength(2);
    expect(fake.sources[1]?.connect).toHaveBeenCalledWith(fake.ctx.destination);
    expect(fake.sources[1]?.start).toHaveBeenCalled();
  });
});

describe("AudioBus cue time", () => {
  it("stamps a cue with the frame clock rather than the wall clock", () => {
    let frameTime = 0;
    const { bus, events } = busWithFake({ now: () => frameTime });
    bus.define("bounce", BEEP);

    bus.play("bounce");
    frameTime = 16;
    bus.play("bounce");
    frameTime = 32;
    bus.play("bounce");

    expect(cues(events).map((c) => c.t)).toEqual([0, 16, 32]);
  });

  it("stamps every cue of one frame with that frame's simulated time", () => {
    const { bus, events } = busWithFake({ now: () => 500 });
    bus.define("a", BEEP);
    bus.define("b", BEEP);

    bus.play("a");
    bus.play("b");

    expect(cues(events)).toEqual([
      { cue: "a", t: 500, gain: 0.2 },
      { cue: "b", t: 500, gain: 0.2 },
    ]);
  });
});

describe("AudioBus mute", () => {
  it("still announces a muted cue, at gain zero", () => {
    const { bus, events } = busWithFake();
    bus.unlock();
    bus.define("bounce", { ...BEEP, gain: 0.5 });

    bus.setMuted(true);
    bus.play("bounce");

    expect(bus.muted()).toBe(true);
    expect(cues(events)).toEqual([{ cue: "bounce", t: 0, gain: 0 }]);
  });

  it("builds no audio graph while muted, and resumes doing so when unmuted", () => {
    const { bus, events, fake } = busWithFake();
    bus.unlock();
    bus.define("bounce", BEEP);

    bus.setMuted(true);
    bus.play("bounce");
    expect(fake.ctx.createOscillator).not.toHaveBeenCalled();

    bus.setMuted(false);
    bus.play("bounce");
    expect(fake.ctx.createOscillator).toHaveBeenCalledTimes(1);
    expect(cues(events)).toHaveLength(2);
  });

  it("mutes a file-backed cue to gain zero as well", async () => {
    const { bus, events, fake } = busWithFake({
      loadAudio: () => Promise.resolve(fakeBuffer()),
    });
    await bus.load("impact", "audio/impact.wav");
    bus.unlock();

    bus.setMuted(true);
    bus.play("impact");

    expect(cues(events)).toEqual([{ cue: "impact", t: 0, gain: 0 }]);
    expect(fake.sources).toHaveLength(0);
  });

  it("reports mute and unlock separately, so a silent build can be diagnosed", () => {
    const { bus } = busWithFake();
    expect(bus.state()).toEqual({ muted: false, unlocked: false });

    bus.setMuted(true);
    bus.unlock();
    expect(bus.state()).toEqual({ muted: true, unlocked: true });
  });
});

describe("AudioBus unlock", () => {
  it("creates no context and no nodes before a user gesture", () => {
    const { bus, events, factory, fake } = busWithFake();
    bus.define("bounce", BEEP);

    bus.play("bounce");

    expect(factory).not.toHaveBeenCalled();
    expect(fake.ctx.createOscillator).not.toHaveBeenCalled();
    expect(cues(events)).toHaveLength(1);
  });

  it("builds the graph once unlocked", () => {
    const { bus, events, fake } = busWithFake();
    bus.define("bounce", BEEP);
    bus.play("bounce");

    bus.unlock();
    bus.play("bounce");

    expect(fake.oscillators).toHaveLength(1);
    expect(fake.gains).toHaveLength(1);
    expect(cues(events)).toHaveLength(2);
  });

  it("announces the gesture", () => {
    const { bus, events } = busWithFake();

    bus.unlock();

    expect(events).toEqual([{ event: "audio:unlocked", payload: {} }]);
    expect(bus.state().unlocked).toBe(true);
  });

  it("is idempotent — repeated gestures neither recreate the context nor repeat the event", () => {
    const { bus, events, factory, fake } = busWithFake();

    bus.unlock();
    bus.unlock();
    bus.unlock();

    expect(factory).toHaveBeenCalledTimes(1);
    expect(fake.resume).toHaveBeenCalledTimes(1);
    expect(unlocks(events)).toBe(1);
  });

  it("announces the gesture even where the browser offers no context at all", () => {
    const { bus, events } = busWith({ audioContext: () => null });

    bus.unlock();
    bus.unlock();

    expect(unlocks(events)).toBe(1);
    expect(bus.state()).toEqual({ muted: false, unlocked: true });
  });
});

describe("AudioBus without audio support", () => {
  it("degrades to events only under a browser with no AudioContext", () => {
    // No context factory is scripted, so the bus reaches for the platform's — and
    // jsdom, like a browser that has stripped Web Audio, has none.
    expect("AudioContext" in globalThis).toBe(false);
    const { bus, events } = busWith();
    bus.define("bounce", BEEP);

    expect(() => bus.unlock()).not.toThrow();
    bus.play("bounce");
    bus.play("bounce");

    expect(bus.state()).toEqual({ muted: false, unlocked: true });
    expect(cues(events)).toHaveLength(2);
    expect(unlocks(events)).toBe(1);
  });

  it("stays a working bus when the factory throws", () => {
    const factory = vi.fn((): AudioContext | null => {
      throw new Error("AudioContext is not available");
    });
    const { bus, events } = busWith({ audioContext: factory });
    bus.define("bounce", BEEP);

    expect(() => bus.unlock()).not.toThrow();
    bus.play("bounce");

    expect(factory).toHaveBeenCalledTimes(1);
    expect(bus.state().unlocked).toBe(true);
    expect(cues(events)).toHaveLength(1);
    expect(unlocks(events)).toBe(1);
  });

  it("keeps a context that objects to being resumed", () => {
    const fake = fakeContext();
    fake.resume.mockImplementation(() => {
      throw new Error("not allowed");
    });
    const { bus, events } = busWith({ audioContext: () => fake.as() });
    bus.define("bounce", BEEP);

    expect(() => bus.unlock()).not.toThrow();
    bus.play("bounce");

    expect(fake.oscillators).toHaveLength(1);
    expect(unlocks(events)).toBe(1);
  });

  it("keeps playing a synthesized cue after the context starts throwing mid-run", () => {
    const fake = fakeContext();
    const { bus, events } = busWith({ audioContext: () => fake.as() });
    bus.define("bounce", BEEP);
    bus.unlock();
    fake.ctx.createOscillator.mockImplementation(() => {
      throw new Error("context is closed");
    });

    expect(() => bus.play("bounce")).not.toThrow();
    expect(cues(events)).toHaveLength(1);
  });

  it("keeps playing a file-backed cue after the context starts throwing mid-run", async () => {
    const fake = fakeContext();
    const { bus, events } = busWith({
      audioContext: () => fake.as(),
      loadAudio: () => Promise.resolve(fakeBuffer()),
    });
    await bus.load("impact", "audio/impact.wav");
    bus.unlock();
    fake.ctx.createBufferSource.mockImplementation(() => {
      throw new Error("context is closed");
    });

    expect(() => bus.play("impact")).not.toThrow();
    expect(cues(events)).toHaveLength(1);
  });

  it("rejects a load the asset loader could not satisfy, without a context", async () => {
    const { bus } = busWith({
      loadAudio: () => Promise.reject(new Error("decode failed")),
    });

    await expect(bus.load("impact", "audio/impact.wav")).rejects.toThrow(
      /decode failed/,
    );
  });
});

describe("AudioBus defaults", () => {
  it("plays without an emitter, so a bus nobody subscribed to is still a bus", () => {
    const bus = new AudioBus();
    bus.define("bounce", BEEP);

    expect(() => bus.unlock()).not.toThrow();
    expect(() => bus.play("bounce")).not.toThrow();
    expect(() => bus.play("missing")).toThrow(/missing/);
  });

  it("rejects a file-backed declaration by name when no asset loader was supplied", async () => {
    const bus = new AudioBus();

    await expect(bus.load("impact", "audio/impact.wav")).rejects.toThrow(
      /audio\/impact\.wav/,
    );
    expect(() => bus.play("impact")).toThrow(/impact/);
  });

  it("stamps cues at zero when no frame clock was supplied", () => {
    const { bus, events } = busWith();
    bus.define("bounce", BEEP);

    bus.play("bounce");

    expect(cues(events)[0]?.t).toBe(0);
  });
});

describe("AudioBus memory", () => {
  it("retains one entry per declared cue and nothing per play", async () => {
    const fake = fakeContext();
    const { bus } = busWith({
      audioContext: () => fake.as(),
      loadAudio: () => Promise.resolve(fakeBuffer()),
    });
    bus.define("bounce", BEEP);
    await bus.load("impact", "audio/impact.wav");
    bus.unlock();

    bus.play("bounce");
    const afterOnePlay = retained(bus);

    for (let i = 0; i < 1000; i += 1) {
      bus.play("bounce");
      bus.play("impact");
    }

    expect(afterOnePlay).toBe(2);
    expect(retained(bus)).toBe(2);
  });

  it("retains nothing for a cue it refused to play", () => {
    const { bus } = busWith();

    for (let i = 0; i < 100; i += 1) {
      expect(() => bus.play(`missing-${i}`)).toThrow();
    }

    expect(retained(bus)).toBe(0);
  });
});
