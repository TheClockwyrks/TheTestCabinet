import { describe, expect, it, vi } from "vitest";
import { AudioBus, type AudioBusOptions } from "./audio";

/** One announced event, as a test reads it back. */
interface Announced {
  event: string;
  payload: Record<string, unknown>;
}

/** A fake oscillator recording what the bus scheduled on it. */
function fakeOscillator() {
  return {
    type: "sine",
    frequency: {
      setValueAtTime: vi.fn(),
      linearRampToValueAtTime: vi.fn(),
    },
    connect: vi.fn(),
    disconnect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
  };
}

/** A fake gain node whose envelope and mute moves are recorded. */
function fakeGainNode() {
  return {
    gain: {
      setValueAtTime: vi.fn(),
      exponentialRampToValueAtTime: vi.fn(),
    },
    connect: vi.fn(),
    disconnect: vi.fn(),
  };
}

/** A fake buffer source, for file-backed plays and loops. */
function fakeBufferSource() {
  return {
    buffer: null as AudioBuffer | null,
    loop: false,
    connect: vi.fn(),
    disconnect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
  };
}

type FakeOscillator = ReturnType<typeof fakeOscillator>;
type FakeGainNode = ReturnType<typeof fakeGainNode>;
type FakeBufferSource = ReturnType<typeof fakeBufferSource>;

/**
 * An `AudioContext` stand-in that records every node it hands out, so a test
 * reads back the graph the bus built without a browser behind it.
 */
function fakeContext(currentTime = 1.5): {
  context: AudioContext;
  oscillators: FakeOscillator[];
  gains: FakeGainNode[];
  sources: FakeBufferSource[];
  resume: ReturnType<typeof vi.fn>;
} {
  const oscillators: FakeOscillator[] = [];
  const gains: FakeGainNode[] = [];
  const sources: FakeBufferSource[] = [];
  const resume = vi.fn(() => Promise.resolve());
  const context = {
    currentTime,
    destination: {},
    resume,
    createOscillator: () => {
      const oscillator = fakeOscillator();
      oscillators.push(oscillator);
      return oscillator;
    },
    createGain: () => {
      const gain = fakeGainNode();
      gains.push(gain);
      return gain;
    },
    createBufferSource: () => {
      const source = fakeBufferSource();
      sources.push(source);
      return source;
    },
  } as unknown as AudioContext;
  return { context, oscillators, gains, sources, resume };
}

/**
 * A bus over a spy emitter and a settable clock, plus the list every
 * announcement lands in. The recorder is the test's, not the bus's: the bus
 * keeps nothing, so a test that wants a history keeps one itself — which is
 * exactly the position a subscriber is in.
 */
function busWith(options: Omit<AudioBusOptions, "emit"> = {}): {
  bus: AudioBus;
  announced: Announced[];
  clock: { now: number };
} {
  const announced: Announced[] = [];
  const clock = { now: 0 };
  const bus = new AudioBus({
    now: () => clock.now,
    ...options,
    emit: (event, payload) => {
      announced.push({ event, payload });
    },
  });
  return { bus, announced, clock };
}

/** A stand-in decoded buffer, compared by identity. */
function buffer(): AudioBuffer {
  return { duration: 1 } as unknown as AudioBuffer;
}

describe("AudioBus declarations", () => {
  it("plays a defined cue and announces it with frame time and its gain", () => {
    const { bus, announced, clock } = busWith();
    bus.define("bounce", {
      wave: "square",
      freq: 440,
      durationMs: 60,
      gain: 0.5,
    });

    clock.now = 1234;
    bus.play("bounce");

    expect(announced).toEqual([
      { event: "cue:played", payload: { cue: "bounce", t: 1234, gain: 0.5 } },
    ]);
  });

  it("defaults a synthesized cue's gain to 0.2", () => {
    const { bus, announced } = busWith();
    bus.define("blip", { freq: 660, durationMs: 90 });

    bus.play("blip");

    expect(announced[0]?.payload["gain"]).toBe(0.2);
  });

  it("announces a file-backed cue at unity gain", async () => {
    const { bus, announced } = busWith({
      loadAudio: () => Promise.resolve(buffer()),
    });

    await bus.load("explosion", "audio/explosion.wav");
    bus.play("explosion");

    expect(announced).toEqual([
      { event: "cue:played", payload: { cue: "explosion", t: 0, gain: 1 } },
    ]);
  });

  it("fetches a file-backed cue through the injected asset loader", async () => {
    const decode = vi.fn(() => Promise.resolve(buffer()));
    const { bus } = busWith({ loadAudio: decode });

    await bus.load("explosion", "audio/explosion.wav");

    expect(decode).toHaveBeenCalledWith("audio/explosion.wav");
  });

  it("replaces what a name plays, whichever of the two declared it", async () => {
    const { bus, announced } = busWith({
      loadAudio: () => Promise.resolve(buffer()),
    });
    bus.define("hit", { freq: 220, durationMs: 50 });

    await bus.load("hit", "audio/hit.wav");
    bus.play("hit");
    expect(announced.at(-1)?.payload["gain"]).toBe(1);

    bus.define("hit", { freq: 220, durationMs: 50, gain: 0.3 });
    bus.play("hit");
    expect(announced.at(-1)?.payload["gain"]).toBe(0.3);
  });

  it("leaves the cue undeclared when the load rejects", async () => {
    const cause = new Error("HTTP 404");
    const { bus } = busWith({ loadAudio: () => Promise.reject(cause) });

    await expect(bus.load("explosion", "audio/explosion.wav")).rejects.toBe(
      cause,
    );

    expect(() => bus.play("explosion")).toThrow(/explosion/);
  });

  it("leaves a previous declaration standing when a reload rejects", async () => {
    const { bus, announced } = busWith({
      loadAudio: () => Promise.reject(new Error("offline")),
    });
    bus.define("theme", { freq: 110, durationMs: 500, gain: 0.4 });

    await bus.load("theme", "audio/theme.ogg").catch(() => undefined);
    bus.play("theme");

    expect(announced.at(-1)?.payload["gain"]).toBe(0.4);
  });

  it("rejects a load by name on a bus built with no asset loader", async () => {
    const bus = new AudioBus();
    await expect(bus.load("theme", "audio/theme.ogg")).rejects.toThrow(
      /audio\/theme\.ogg/,
    );
  });
});

describe("AudioBus undeclared names", () => {
  it("throws from play, loop, and stop, naming the cue", () => {
    const { bus } = busWith();
    expect(() => bus.play("typo")).toThrow(/"typo"/);
    expect(() => bus.loop("typo")).toThrow(/"typo"/);
    expect(() => bus.stop("typo")).toThrow(/"typo"/);
  });

  it("reports false from looping instead of throwing", () => {
    const { bus } = busWith();
    expect(bus.looping("typo")).toBe(false);
  });
});

describe("AudioBus mute", () => {
  it("still announces a muted play, at a gain of zero", () => {
    const { bus, announced } = busWith();
    bus.define("blip", { freq: 660, durationMs: 90, gain: 0.5 });

    bus.setMuted(true);
    bus.play("blip");

    expect(bus.muted()).toBe(true);
    expect(announced).toEqual([
      { event: "cue:played", payload: { cue: "blip", t: 0, gain: 0 } },
    ]);
  });

  it("announces a muted loop at a gain of zero too", () => {
    const { bus, announced } = busWith();
    bus.define("hum", { freq: 60, durationMs: 100 });

    bus.setMuted(true);
    bus.loop("hum");

    expect(announced).toEqual([
      { event: "cue:looped", payload: { cue: "hum", t: 0, gain: 0 } },
    ]);
  });

  it("keeps the mute bit apart from the unlock in state()", () => {
    const { bus } = busWith({ audioContext: () => null });
    expect(bus.state()).toEqual({ muted: false, unlocked: false });

    bus.setMuted(true);
    expect(bus.state()).toEqual({ muted: true, unlocked: false });

    bus.unlock();
    expect(bus.state()).toEqual({ muted: true, unlocked: true });

    bus.setMuted(false);
    expect(bus.state()).toEqual({ muted: false, unlocked: true });
  });

  it("silences and restores every running loop in place, without restarting", () => {
    const fake = fakeContext(2);
    const { bus } = busWith({ audioContext: () => fake.context });
    bus.define("hum", { freq: 60, durationMs: 100, gain: 0.3 });
    bus.unlock();
    bus.loop("hum");

    const amp = fake.gains[0];
    expect(amp?.gain.setValueAtTime).toHaveBeenLastCalledWith(0.3, 2);

    bus.setMuted(true);
    expect(amp?.gain.setValueAtTime).toHaveBeenLastCalledWith(0, 2);
    expect(bus.looping("hum")).toBe(true);
    expect(fake.oscillators[0]?.stop).not.toHaveBeenCalled();

    bus.setMuted(false);
    expect(amp?.gain.setValueAtTime).toHaveBeenLastCalledWith(0.3, 2);
  });
});

describe("AudioBus unlock", () => {
  it("opens the context once, resumes it, and announces the gesture once", () => {
    const fake = fakeContext();
    const factory = vi.fn(() => fake.context);
    const { bus, announced } = busWith({ audioContext: factory });

    bus.unlock();
    bus.unlock();

    expect(factory).toHaveBeenCalledTimes(1);
    expect(fake.resume).toHaveBeenCalledTimes(1);
    expect(announced).toEqual([{ event: "audio:unlocked", payload: {} }]);
    expect(bus.state().unlocked).toBe(true);
  });

  it("records the gesture even where the host has no Web Audio", () => {
    const { bus, announced } = busWith({ audioContext: () => null });
    bus.define("blip", { freq: 660, durationMs: 90 });

    bus.unlock();

    expect(bus.state().unlocked).toBe(true);
    expect(announced).toEqual([{ event: "audio:unlocked", payload: {} }]);
    // The bus degrades to announcing alone; playing must not throw.
    expect(() => bus.play("blip")).not.toThrow();
  });

  it("survives a factory that throws, running silently from then on", () => {
    const { bus, announced } = busWith({
      audioContext: () => {
        throw new Error("blocked");
      },
    });

    expect(() => bus.unlock()).not.toThrow();
    expect(bus.state().unlocked).toBe(true);
    expect(announced).toEqual([{ event: "audio:unlocked", payload: {} }]);
  });

  it("starts every loop requested before the unlock, announcing nothing again", () => {
    const fake = fakeContext();
    const { bus, announced } = busWith({ audioContext: () => fake.context });
    bus.define("hum", { freq: 60, durationMs: 100 });

    bus.loop("hum");
    expect(bus.looping("hum")).toBe(true);
    expect(fake.oscillators).toHaveLength(0);

    bus.unlock();

    expect(fake.oscillators).toHaveLength(1);
    expect(fake.oscillators[0]?.start).toHaveBeenCalled();
    expect(announced.map((a) => a.event)).toEqual([
      "cue:looped",
      "audio:unlocked",
    ]);
  });
});

describe("AudioBus synthesis", () => {
  it("sweeps one oscillator through one decaying gain node for the duration", () => {
    const fake = fakeContext(2);
    const { bus } = busWith({ audioContext: () => fake.context });
    bus.define("victory", {
      wave: "triangle",
      freq: 520,
      freqTo: 880,
      gain: 0.25,
      durationMs: 220,
    });
    bus.unlock();

    bus.play("victory");

    const oscillator = fake.oscillators[0];
    const amp = fake.gains[0];
    expect(oscillator?.type).toBe("triangle");
    expect(oscillator?.frequency.setValueAtTime).toHaveBeenCalledWith(520, 2);
    expect(oscillator?.frequency.linearRampToValueAtTime).toHaveBeenCalledWith(
      880,
      2.22,
    );
    expect(amp?.gain.setValueAtTime).toHaveBeenCalledWith(0.25, 2);
    expect(amp?.gain.exponentialRampToValueAtTime).toHaveBeenCalledWith(
      0.0001,
      2.22,
    );
    expect(oscillator?.start).toHaveBeenCalledWith(2);
    expect(oscillator?.stop).toHaveBeenCalledWith(2.22);
  });

  it("defaults the wave to sine and holds freq with no freqTo", () => {
    const fake = fakeContext(0);
    const { bus } = busWith({ audioContext: () => fake.context });
    bus.define("blip", { freq: 660, durationMs: 100 });
    bus.unlock();

    bus.play("blip");

    const oscillator = fake.oscillators[0];
    expect(oscillator?.type).toBe("sine");
    expect(oscillator?.frequency.linearRampToValueAtTime).toHaveBeenCalledWith(
      660,
      0.1,
    );
  });

  it("plays a file-backed cue as its buffer, unscaled", async () => {
    const clip = buffer();
    const fake = fakeContext();
    const { bus } = busWith({
      audioContext: () => fake.context,
      loadAudio: () => Promise.resolve(clip),
    });
    await bus.load("explosion", "audio/explosion.wav");
    bus.unlock();

    bus.play("explosion");

    expect(fake.sources[0]?.buffer).toBe(clip);
    expect(fake.sources[0]?.start).toHaveBeenCalled();
    // No gain node: the produced file carries its own level.
    expect(fake.gains).toHaveLength(0);
  });

  it("sounds nothing for a muted play, beyond the event", () => {
    const fake = fakeContext();
    const { bus } = busWith({ audioContext: () => fake.context });
    bus.define("blip", { freq: 660, durationMs: 90 });
    bus.unlock();

    bus.setMuted(true);
    bus.play("blip");

    expect(fake.oscillators).toHaveLength(0);
  });
});

describe("AudioBus loops", () => {
  it("acts and announces once per transition, whatever a tick repeats", () => {
    const { bus, announced, clock } = busWith();
    bus.define("thrust", { wave: "sawtooth", freq: 120, durationMs: 90 });

    clock.now = 100;
    bus.loop("thrust");
    bus.loop("thrust");
    expect(bus.looping("thrust")).toBe(true);

    clock.now = 250;
    bus.stop("thrust");
    bus.stop("thrust");
    expect(bus.looping("thrust")).toBe(false);

    expect(announced).toEqual([
      { event: "cue:looped", payload: { cue: "thrust", t: 100, gain: 0.2 } },
      { event: "cue:stopped", payload: { cue: "thrust", t: 250 } },
    ]);
  });

  it("reads as looping from inside its own cue:looped handler", () => {
    const seen: boolean[] = [];
    const bus = new AudioBus({
      emit: (event) => {
        if (event === "cue:looped") seen.push(bus.looping("hum"));
      },
    });
    bus.define("hum", { freq: 60, durationMs: 100 });

    bus.loop("hum");

    expect(seen).toEqual([true]);
  });

  it("holds a synthesized loop at freq and gain, with no sweep and no decay", () => {
    const fake = fakeContext(3);
    const { bus } = busWith({ audioContext: () => fake.context });
    bus.define("hum", { freq: 60, freqTo: 120, gain: 0.3, durationMs: 100 });
    bus.unlock();

    bus.loop("hum");

    const oscillator = fake.oscillators[0];
    const amp = fake.gains[0];
    expect(oscillator?.frequency.setValueAtTime).toHaveBeenCalledWith(60, 3);
    expect(
      oscillator?.frequency.linearRampToValueAtTime,
    ).not.toHaveBeenCalled();
    expect(amp?.gain.setValueAtTime).toHaveBeenCalledWith(0.3, 3);
    expect(amp?.gain.exponentialRampToValueAtTime).not.toHaveBeenCalled();
    expect(oscillator?.start).toHaveBeenCalled();
    expect(oscillator?.stop).not.toHaveBeenCalled();
  });

  it("loops a file-backed cue's decoded buffer seamlessly", async () => {
    const clip = buffer();
    const fake = fakeContext();
    const { bus } = busWith({
      audioContext: () => fake.context,
      loadAudio: () => Promise.resolve(clip),
    });
    await bus.load("bed", "audio/bed.ogg");
    bus.unlock();

    bus.loop("bed");

    expect(fake.sources[0]?.buffer).toBe(clip);
    expect(fake.sources[0]?.loop).toBe(true);
  });

  it("stops the loop's nodes when a tick stops it", () => {
    const fake = fakeContext();
    const { bus } = busWith({ audioContext: () => fake.context });
    bus.define("hum", { freq: 60, durationMs: 100 });
    bus.unlock();
    bus.loop("hum");

    bus.stop("hum");

    expect(fake.oscillators[0]?.stop).toHaveBeenCalled();
    expect(fake.oscillators[0]?.disconnect).toHaveBeenCalled();
    expect(fake.gains[0]?.disconnect).toHaveBeenCalled();
  });

  it("stops a looping cue that is redeclared, under either declaration", async () => {
    const { bus, announced, clock } = busWith({
      loadAudio: () => Promise.resolve(buffer()),
    });
    bus.define("hum", { freq: 60, durationMs: 100 });

    bus.loop("hum");
    clock.now = 50;
    bus.define("hum", { freq: 90, durationMs: 100 });
    expect(bus.looping("hum")).toBe(false);
    expect(announced.at(-1)).toEqual({
      event: "cue:stopped",
      payload: { cue: "hum", t: 50 },
    });

    bus.loop("hum");
    await bus.load("hum", "audio/hum.ogg");
    expect(bus.looping("hum")).toBe(false);
    expect(announced.at(-1)?.event).toBe("cue:stopped");
  });

  it("leaves a loop running when a redeclaring load fails", async () => {
    const { bus, announced } = busWith({
      loadAudio: () => Promise.reject(new Error("offline")),
    });
    bus.define("hum", { freq: 60, durationMs: 100 });
    bus.loop("hum");

    await bus.load("hum", "audio/hum.ogg").catch(() => undefined);

    expect(bus.looping("hum")).toBe(true);
    expect(announced.map((a) => a.event)).toEqual(["cue:looped"]);
  });

  it("re-announces a loop started again after a stop", () => {
    const { bus, announced } = busWith();
    bus.define("hum", { freq: 60, durationMs: 100 });

    bus.loop("hum");
    bus.stop("hum");
    bus.loop("hum");

    expect(announced.map((a) => a.event)).toEqual([
      "cue:looped",
      "cue:stopped",
      "cue:looped",
    ]);
  });

  it("silences every loop without announcing, for engine teardown", () => {
    const fake = fakeContext();
    const { bus, announced } = busWith({ audioContext: () => fake.context });
    bus.define("hum", { freq: 60, durationMs: 100 });
    bus.define("bed", { freq: 120, durationMs: 100 });
    bus.unlock();
    bus.loop("hum");
    bus.loop("bed");
    const before = announced.length;

    bus.silence();

    expect(bus.looping("hum")).toBe(false);
    expect(bus.looping("bed")).toBe(false);
    expect(fake.oscillators[0]?.stop).toHaveBeenCalled();
    expect(fake.oscillators[1]?.stop).toHaveBeenCalled();
    expect(announced).toHaveLength(before);
  });

  it("builds a still-muted loop's graph at gain zero, ready to be restored", () => {
    const fake = fakeContext(1);
    const { bus } = busWith({ audioContext: () => fake.context });
    bus.define("hum", { freq: 60, durationMs: 100, gain: 0.3 });
    bus.unlock();
    bus.setMuted(true);

    bus.loop("hum");

    expect(fake.gains[0]?.gain.setValueAtTime).toHaveBeenLastCalledWith(0, 1);
    bus.setMuted(false);
    expect(fake.gains[0]?.gain.setValueAtTime).toHaveBeenLastCalledWith(0.3, 1);
  });
});
