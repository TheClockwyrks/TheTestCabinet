import { describe, expect, it, vi } from "vitest";
import { AudioBus } from "./audio";

type Spy = ReturnType<typeof vi.fn>;

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

/**
 * A stand-in for the browser's audio graph. jsdom has no Web Audio at all, so
 * every assertion about *when* nodes are created (never before the unlock, never
 * while muted) is made against this fake rather than against a real context.
 */
function fakeContext() {
  const oscillators: FakeOscillator[] = [];
  const gains: FakeGain[] = [];
  const resume = vi.fn(() => Promise.resolve());

  const ctx = {
    currentTime: 10,
    destination: {},
    resume,
    createOscillator: vi.fn(() => {
      const osc = {
        type: "sine",
        frequency: { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() },
        connect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
      };
      oscillators.push(osc);
      return osc;
    }),
    createGain: vi.fn(() => {
      const node = {
        gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
        connect: vi.fn(),
      };
      gains.push(node);
      return node;
    }),
  };

  return { ctx, oscillators, gains, resume, as: () => ctx as unknown as AudioContext };
}

/** A bus over a fake context, plus a factory spy and the fake's node registries. */
function busWithFake() {
  const fake = fakeContext();
  const factory = vi.fn(() => fake.as());
  return { bus: new AudioBus(factory), factory, fake };
}

const BEEP = { freq: 440, durationMs: 50 } as const;

describe("AudioBus cue log", () => {
  it("records a played cue with its gain and the bus clock's time", () => {
    const { bus } = busWithFake();
    bus.now = () => 1234;
    bus.define("bounce", { ...BEEP, gain: 0.5 });

    bus.play("bounce");

    expect(bus.log()).toEqual([{ cue: "bounce", t: 1234, gain: 0.5 }]);
  });

  it("falls back to the engine's default gain when the spec names none", () => {
    const { bus } = busWithFake();
    bus.define("bounce", BEEP);

    bus.play("bounce");

    expect(bus.log()[0]?.gain).toBe(0.2);
  });

  it("throws on an undefined cue rather than silently playing nothing", () => {
    const { bus } = busWithFake();
    bus.define("bounce", BEEP);

    expect(() => bus.play("bunce")).toThrow(/bunce/);
    expect(bus.log()).toEqual([]);
  });

  it("keeps cues in play order, newest last", () => {
    const { bus } = busWithFake();
    let t = 0;
    bus.now = () => (t += 5);
    bus.define("a", BEEP);
    bus.define("b", BEEP);

    bus.play("a");
    bus.play("b");
    bus.play("a");

    expect(bus.log().map((e) => [e.cue, e.t])).toEqual([
      ["a", 5],
      ["b", 10],
      ["a", 15],
    ]);
  });

  it("hands out a copy a caller cannot use to rewrite the record", () => {
    const { bus } = busWithFake();
    bus.define("bounce", BEEP);
    bus.play("bounce");

    const taken = bus.log();
    taken.push({ cue: "forged", t: 0, gain: 1 });
    taken.length = 0;

    expect(bus.log()).toHaveLength(1);
    expect(bus.log()[0]?.cue).toBe("bounce");
  });

  it("redefining a cue replaces its spec", () => {
    const { bus } = busWithFake();
    bus.define("bounce", { ...BEEP, gain: 0.5 });
    bus.define("bounce", { ...BEEP, gain: 0.1 });

    bus.play("bounce");

    expect(bus.log()[0]?.gain).toBe(0.1);
  });
});

describe("AudioBus mute", () => {
  it("still logs a muted cue, at gain zero", () => {
    const { bus } = busWithFake();
    bus.unlock();
    bus.define("bounce", { ...BEEP, gain: 0.5 });

    bus.setMuted(true);
    bus.play("bounce");

    expect(bus.muted()).toBe(true);
    expect(bus.log()).toEqual([{ cue: "bounce", t: expect.any(Number), gain: 0 }]);
  });

  it("builds no audio graph while muted, and resumes doing so when unmuted", () => {
    const { bus, fake } = busWithFake();
    bus.unlock();
    bus.define("bounce", BEEP);

    bus.setMuted(true);
    bus.play("bounce");
    expect(fake.ctx.createOscillator).not.toHaveBeenCalled();

    bus.setMuted(false);
    bus.play("bounce");
    expect(fake.ctx.createOscillator).toHaveBeenCalledTimes(1);
    expect(bus.log()).toHaveLength(2);
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
    const { bus, factory, fake } = busWithFake();
    bus.define("bounce", BEEP);

    bus.play("bounce");

    expect(factory).not.toHaveBeenCalled();
    expect(fake.ctx.createOscillator).not.toHaveBeenCalled();
    expect(bus.log()).toHaveLength(1);
  });

  it("builds the graph once unlocked", () => {
    const { bus, fake } = busWithFake();
    bus.define("bounce", BEEP);
    bus.play("bounce");

    bus.unlock();
    bus.play("bounce");

    expect(fake.oscillators).toHaveLength(1);
    expect(fake.gains).toHaveLength(1);
    expect(bus.log()).toHaveLength(2);
  });

  it("is idempotent — repeated gestures neither recreate nor re-resume the context", () => {
    const { bus, factory, fake } = busWithFake();

    bus.unlock();
    bus.unlock();
    bus.unlock();

    expect(factory).toHaveBeenCalledTimes(1);
    expect(fake.resume).toHaveBeenCalledTimes(1);
    expect(bus.state().unlocked).toBe(true);
  });
});

describe("AudioBus synthesis", () => {
  it("sweeps the frequency and decays the gain across the cue's duration", () => {
    const { bus, fake } = busWithFake();
    bus.unlock();
    bus.define("swoop", { wave: "square", freq: 200, freqTo: 800, gain: 0.4, durationMs: 250 });

    bus.play("swoop");

    const osc = fake.oscillators[0];
    const amp = fake.gains[0];
    const start = fake.ctx.currentTime;
    const end = start + 0.25;
    expect(osc?.type).toBe("square");
    expect(osc?.frequency.setValueAtTime).toHaveBeenCalledWith(200, start);
    expect(osc?.frequency.linearRampToValueAtTime).toHaveBeenCalledWith(800, end);
    expect(amp?.gain.setValueAtTime).toHaveBeenCalledWith(0.4, start);
    expect(amp?.gain.exponentialRampToValueAtTime).toHaveBeenCalledWith(expect.any(Number), end);
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
    expect(fake.oscillators[0]?.frequency.linearRampToValueAtTime).toHaveBeenCalledWith(
      440,
      fake.ctx.currentTime + 0.05,
    );
  });

  it("logs but does not synthesize a cue whose gain is zero", () => {
    const { bus, fake } = busWithFake();
    bus.unlock();
    bus.define("silent", { ...BEEP, gain: 0 });

    bus.play("silent");

    expect(bus.log()).toHaveLength(1);
    expect(fake.ctx.createOscillator).not.toHaveBeenCalled();
  });
});

describe("AudioBus without audio support", () => {
  it("stays a working log-only bus when the factory returns null", () => {
    const bus = new AudioBus(() => null);
    bus.define("bounce", BEEP);

    bus.unlock();
    bus.play("bounce");
    bus.play("bounce");

    expect(bus.state()).toEqual({ muted: false, unlocked: true });
    expect(bus.log()).toHaveLength(2);
  });

  it("stays a working log-only bus when the factory throws", () => {
    const factory = vi.fn(() => {
      throw new Error("AudioContext is not available");
    });
    const bus = new AudioBus(factory);
    bus.define("bounce", BEEP);

    expect(() => bus.unlock()).not.toThrow();
    bus.play("bounce");

    expect(factory).toHaveBeenCalledTimes(1);
    expect(bus.state().unlocked).toBe(true);
    expect(bus.log()).toHaveLength(1);
  });

  it("keeps playing after the context starts throwing mid-run", () => {
    const fake = fakeContext();
    fake.ctx.createOscillator.mockImplementation(() => {
      throw new Error("context is closed");
    });
    const bus = new AudioBus(() => fake.as());
    bus.define("bounce", BEEP);
    bus.unlock();

    expect(() => bus.play("bounce")).not.toThrow();
    expect(bus.log()).toHaveLength(1);
  });
});
