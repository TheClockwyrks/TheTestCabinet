// The audio bus, over a stand-in Web Audio context.
//
// Node has no Web Audio, so the bus is handed a context of the test's own — which
// is exactly the seam a browser check uses when it patches `AudioContext` to hear
// what a build played. What is asserted is the shape of the sound (waveform,
// frequency, sweep, envelope) and the three rules the rest of the build leans on:
// nothing is audible before a gesture, muting is a gain of zero, and nothing about
// audio ever throws into a frame.

import { beforeEach, describe, expect, it } from "vitest";
import { AudioBus, DEFAULT_CUE_GAIN, type CueSpec } from "./audio-bus";
import { CUE_SPECS } from "./audio";
import { CUES } from "./constants";

/** One scheduled value on an `AudioParam`. */
interface Scheduled {
  kind: "set" | "ramp";
  value: number;
  at: number;
}

class FakeParam {
  readonly scheduled: Scheduled[] = [];
  setValueAtTime(value: number, at: number): void {
    this.scheduled.push({ kind: "set", value, at });
  }
  exponentialRampToValueAtTime(value: number, at: number): void {
    this.scheduled.push({ kind: "ramp", value, at });
  }
}

class FakeOscillator {
  type = "sine";
  readonly frequency = new FakeParam();
  startedAt: number | null = null;
  stoppedAt: number | null = null;
  connect<T>(node: T): T {
    return node;
  }
  start(at: number): void {
    this.startedAt = at;
  }
  stop(at: number): void {
    this.stoppedAt = at;
  }
}

class FakeGain {
  readonly gain = new FakeParam();
  connect<T>(node: T): T {
    return node;
  }
}

class FakeContext {
  currentTime = 0;
  readonly destination = {};
  readonly oscillators: FakeOscillator[] = [];
  readonly gains: FakeGain[] = [];
  resumes = 0;
  closes = 0;
  createOscillator(): FakeOscillator {
    const oscillator = new FakeOscillator();
    this.oscillators.push(oscillator);
    return oscillator;
  }
  createGain(): FakeGain {
    const gain = new FakeGain();
    this.gains.push(gain);
    return gain;
  }
  resume(): Promise<void> {
    this.resumes += 1;
    return Promise.resolve();
  }
  close(): Promise<void> {
    this.closes += 1;
    return Promise.resolve();
  }
}

const BEEP: CueSpec = { wave: "square", freq: 400, durationMs: 100 };

let context: FakeContext;
let target: EventTarget;
let bus: AudioBus;

/** Open the bus the way a player does: with a gesture. */
function gesture(): void {
  target.dispatchEvent(new Event("pointerdown"));
}

beforeEach(() => {
  context = new FakeContext();
  target = new EventTarget();
  bus = new AudioBus(() => context as unknown as AudioContext);
  bus.armUnlock(target);
});

describe("the first-gesture unlock", () => {
  it("creates no context until the player has done something", () => {
    expect(bus.unlocked()).toBe(false);
    bus.define("beep", BEEP);
    bus.play("beep");
    expect(context.oscillators).toHaveLength(0);
  });

  it("opens and resumes the context on the first gesture", () => {
    gesture();
    expect(bus.unlocked()).toBe(true);
    expect(context.resumes).toBe(1);
  });

  it("opens it once, however many gestures follow", () => {
    gesture();
    target.dispatchEvent(new Event("keydown"));
    target.dispatchEvent(new Event("touchstart"));
    expect(context.resumes).toBe(1);
  });

  it("stays silent, not broken, where the platform has no Web Audio", () => {
    const silent = new AudioBus(() => null);
    silent.armUnlock(target);
    silent.define("beep", BEEP);
    gesture();
    expect(silent.unlocked()).toBe(false);
    expect(() => silent.play("beep")).not.toThrow();
  });
});

describe("playing a cue", () => {
  beforeEach(() => {
    gesture();
  });

  it("sounds one oscillator through one envelope", () => {
    bus.define("beep", BEEP);
    bus.play("beep");
    expect(context.oscillators).toHaveLength(1);
    expect(context.gains).toHaveLength(1);
  });

  it("takes the waveform, pitch and length from the spec", () => {
    bus.define("beep", BEEP);
    context.currentTime = 5;
    bus.play("beep");
    const [oscillator] = context.oscillators;
    expect(oscillator.type).toBe("square");
    expect(oscillator.frequency.scheduled).toEqual([
      { kind: "set", value: 400, at: 5 },
    ]);
    expect(oscillator.startedAt).toBe(5);
    expect(oscillator.stoppedAt).toBeCloseTo(5.1, 9);
  });

  it("sweeps the pitch when the spec names a destination", () => {
    bus.define("rise", { freq: 200, freqTo: 800, durationMs: 200 });
    bus.play("rise");
    expect(context.oscillators[0].frequency.scheduled).toEqual([
      { kind: "set", value: 200, at: 0 },
      { kind: "ramp", value: 800, at: 0.2 },
    ]);
  });

  it("decays the envelope from the spec's gain, defaulting when it names none", () => {
    bus.define("loud", { ...BEEP, gain: 0.5 });
    bus.define("plain", BEEP);
    bus.play("loud");
    bus.play("plain");
    expect(context.gains[0].gain.scheduled[0].value).toBe(0.5);
    expect(context.gains[0].gain.scheduled[1].kind).toBe("ramp");
    expect(context.gains[1].gain.scheduled[0].value).toBe(DEFAULT_CUE_GAIN);
  });

  it("throws on a cue that was never declared, rather than going quiet", () => {
    expect(() => bus.play("typo")).toThrow(/typo/);
  });

  it("replaces a cue when it is declared again", () => {
    bus.define("beep", BEEP);
    bus.define("beep", { ...BEEP, freq: 900 });
    bus.play("beep");
    expect(context.oscillators[0].frequency.scheduled[0].value).toBe(900);
  });

  it("never throws into a frame when the context dies mid-cue", () => {
    bus.define("beep", BEEP);
    context.createOscillator = () => {
      throw new Error("context closed");
    };
    expect(() => bus.play("beep")).not.toThrow();
  });
});

describe("muting", () => {
  beforeEach(() => {
    gesture();
    bus.define("beep", BEEP);
  });

  it("makes a cue silent without making it a different event", () => {
    bus.setMuted(true);
    expect(bus.muted()).toBe(true);
    bus.play("beep");
    expect(context.oscillators).toHaveLength(0);
  });

  it("comes back on unmute", () => {
    bus.setMuted(true);
    bus.play("beep");
    bus.setMuted(false);
    bus.play("beep");
    expect(context.oscillators).toHaveLength(1);
  });
});

describe("disposal", () => {
  it("closes the context and stops listening for gestures", () => {
    gesture();
    bus.dispose();
    expect(context.closes).toBe(1);
    expect(bus.unlocked()).toBe(false);
  });

  it("is idempotent, because teardown races", () => {
    gesture();
    bus.dispose();
    bus.dispose();
    expect(context.closes).toBe(1);
  });
});

describe("the five cues this game declares", () => {
  it("are told apart by waveform and pitch, so each is its own sound", () => {
    gesture();
    for (const [cue, spec] of Object.entries(CUE_SPECS)) bus.define(cue, spec);
    for (const cue of Object.values(CUES)) bus.play(cue);

    expect(context.oscillators).toHaveLength(5);
    const voices = context.oscillators.map(
      (oscillator) =>
        `${oscillator.type}:${String(oscillator.frequency.scheduled[0].value)}`,
    );
    expect(new Set(voices).size).toBe(5);
  });
});
