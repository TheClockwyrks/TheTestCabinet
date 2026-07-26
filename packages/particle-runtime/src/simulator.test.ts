import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { ParticleSystem } from "./contract";
import { ParticleSimulator } from "./simulator";

function loadSystem(name: string): ParticleSystem {
  const raw = readFileSync(fileURLToPath(new URL(`./__fixtures__/${name}`, import.meta.url)), "utf8");
  return JSON.parse(raw) as ParticleSystem;
}

/** Step `sim` forward by `ms`, in `system.fps`-sized ticks, recording the live count. */
function play(sim: ParticleSimulator, ms: number, fps: number): number[] {
  const dt = 1000 / fps;
  const counts: number[] = [sim.liveCount];
  let elapsed = 0;
  while (elapsed < ms) {
    sim.step(dt);
    counts.push(sim.liveCount);
    elapsed += dt;
  }
  return counts;
}

describe("ParticleSimulator — a one-shot burst emits then decays", () => {
  const system = loadSystem("burst.json");

  it("reports the system as non-empty", () => {
    expect(new ParticleSimulator(system).isNonEmpty).toBe(true);
  });

  it("fires the zero-time burst at construction (frame 0 already carries it)", () => {
    const sim = new ParticleSimulator(system, { seed: 1 });
    expect(sim.liveCount).toBe(200);
    expect(sim.clockMs).toBe(0);
  });

  it("captures render-ready particles with evaluated appearance", () => {
    const sim = new ParticleSimulator(system, { seed: 1 });
    const particles = sim.capture();
    expect(particles).toHaveLength(200);
    const p = particles[0]!;
    // First color stop is white at life 0; opacity starts opaque.
    expect(p.color[0]).toBeCloseTo(1, 3);
    expect(p.opacity).toBeCloseTo(1, 3);
    expect(p.size).toBeGreaterThan(0);
  });

  it("only ever loses particles (no re-emission) and decays to empty", () => {
    const sim = new ParticleSimulator(system, { seed: 1 });
    const counts = play(sim, system.durationMs, system.fps);
    // Monotonic non-increasing: a one-shot burst never spawns again.
    for (let i = 1; i < counts.length; i++) {
      expect(counts[i]!).toBeLessThanOrEqual(counts[i - 1]!);
    }
    // Max particle lifetime is 400 + 80 spread; well before the 800ms duration ends,
    // every particle has died.
    expect(sim.liveCount).toBe(0);
  });

  it("stays empty past the duration because it does not loop", () => {
    const sim = new ParticleSimulator(system, { seed: 1 });
    play(sim, system.durationMs, system.fps);
    expect(sim.liveCount).toBe(0);
    // Two more whole cycles: a one-shot must remain empty.
    play(sim, system.durationMs * 2, system.fps);
    expect(sim.liveCount).toBe(0);
  });
});

describe("ParticleSimulator — loop vs one-shot", () => {
  const burst = loadSystem("burst.json");

  it("a looping burst re-fires after it has decayed, where a one-shot never does", () => {
    // Same effect, looping vs one-shot: both decay to empty; only the loop recovers.
    const looping = new ParticleSimulator({ ...burst, loop: true }, { seed: 1 });
    const oneShot = new ParticleSimulator({ ...burst, loop: false }, { seed: 1 });

    // Two full cycles, so a looping burst crosses the duration boundary and re-fires.
    const loopCounts = play(looping, burst.durationMs * 2, burst.fps);
    const shotCounts = play(oneShot, burst.durationMs * 2, burst.fps);

    // Both start populated and decay to empty at least once.
    const loopZero = loopCounts.findIndex((c) => c === 0);
    const shotZero = shotCounts.findIndex((c) => c === 0);
    expect(loopZero).toBeGreaterThan(0);
    expect(shotZero).toBeGreaterThan(0);

    // After first emptying, the loop re-emits; the one-shot stays empty forever.
    expect(loopCounts.slice(loopZero).some((c) => c > 0)).toBe(true);
    expect(shotCounts.slice(shotZero).every((c) => c === 0)).toBe(true);
  });

  it("a looping rate emitter sustains a non-zero population past its duration", () => {
    const fire = loadSystem("fire-loop.json");
    const sim = new ParticleSimulator(fire, { seed: 2 });
    // Warm up to a steady state, then keep going past the loop boundary.
    play(sim, fire.durationMs, fire.fps);
    const afterOne = sim.liveCount;
    expect(afterOne).toBeGreaterThan(0);
    play(sim, fire.durationMs, fire.fps);
    expect(sim.liveCount).toBeGreaterThan(0);
  });
});

describe("ParticleSimulator — determinism", () => {
  const system = loadSystem("burst.json");

  it("a seeded play is reproducible across reset", () => {
    const sim = new ParticleSimulator(system, { seed: 42 });
    const first = play(sim, system.durationMs, system.fps);
    const sampleAfter = sim.capture();
    sim.reset();
    const second = play(sim, system.durationMs, system.fps);
    expect(second).toEqual(first);
    // The captured positions replay identically too.
    const sampleAgain = new ParticleSimulator(system, { seed: 42 });
    play(sampleAgain, system.durationMs, system.fps);
    expect(sampleAgain.capture().length).toBe(sampleAfter.length);
  });

  it("two simulators with the same seed match step for step", () => {
    const a = new ParticleSimulator(system, { seed: 7 });
    const b = new ParticleSimulator(system, { seed: 7 });
    const dt = 1000 / system.fps;
    for (let i = 0; i < 10; i++) {
      a.step(dt);
      b.step(dt);
      expect(a.liveCount).toBe(b.liveCount);
      const pa = a.capture();
      const pb = b.capture();
      if (pa.length > 0) {
        expect(pa[0]!.position).toEqual(pb[0]!.position);
      }
    }
  });
});

describe("ParticleSimulator — sub-emitters", () => {
  it("a death sub-emitter bursts children when the parents expire", () => {
    const system: ParticleSystem = {
      dimensions: 3,
      field: { width: 8, height: 8, depth: 8 },
      durationMs: 800,
      fps: 30,
      loop: false,
      emitters: [
        {
          name: "shell",
          shape: "point",
          position: [4, 4, 4],
          extent: { radius: 0.1, size: [1, 1, 1] },
          emission: { mode: "burst", count: 10, atMs: 0 },
          lifetimeMs: 100,
          speed: 2,
          direction: [0, 1, 0],
          coneAngle: 360,
          seed: 5,
        },
        {
          name: "embers",
          shape: "point",
          position: [0, 0, 0],
          extent: { radius: 0.1, size: [1, 1, 1] },
          emission: { mode: "burst", count: 5, atMs: 0 },
          lifetimeMs: 500,
          speed: 3,
          direction: [0, 1, 0],
          coneAngle: 360,
          seed: 6,
        },
      ],
      forces: {},
      subEmitters: [{ parent: "shell", on: "death", emitter: "embers" }],
    };

    const sim = new ParticleSimulator(system, { seed: 1 });
    // Only the 10 shells at first — `embers` is a child, so it does not emit on its own.
    expect(sim.liveCount).toBe(10);
    // Past the shells' 100ms lifetime: each of the 10 shells burst 5 embers = 50.
    play(sim, 200, system.fps);
    expect(sim.liveCount).toBe(50);
  });
});

describe("ParticleSimulator — the live-particle cap", () => {
  /** A rate emitter that would settle far past the cap: 400k/s alive for a second. */
  function runaway(): ParticleSystem {
    return {
      dimensions: 3,
      field: { width: 16, height: 16, depth: 16 },
      durationMs: 1000,
      fps: 60,
      loop: true,
      emitters: [
        {
          name: "flood",
          shape: "point",
          position: [8, 8, 8],
          extent: { radius: 1, size: [1, 1, 1] },
          emission: { mode: "rate", rate: 400_000 },
          lifetimeMs: 1000,
          speed: 1,
          direction: [0, 1, 0],
          coneAngle: 360,
        },
      ],
    };
  }

  it("holds a runaway rate emitter at the 10,000-particle ceiling", () => {
    const sim = new ParticleSimulator(runaway(), { seed: 1 });
    play(sim, 2000, 60);
    expect(sim.liveCount).toBe(10_000);
  });

  it("honours a lower `maxParticles` for a constrained client", () => {
    const sim = new ParticleSimulator(runaway(), { seed: 1, maxParticles: 250 });
    play(sim, 2000, 60);
    expect(sim.liveCount).toBe(250);
  });

  it("caps the children a death sub-emitter cascade spawns", () => {
    const system: ParticleSystem = {
      ...runaway(),
      emitters: [
        {
          ...runaway().emitters[0]!,
          name: "shell",
          emission: { mode: "rate", rate: 20_000 },
          lifetimeMs: 100,
        },
        {
          name: "embers",
          shape: "point",
          position: [8, 8, 8],
          extent: { radius: 1, size: [1, 1, 1] },
          emission: { mode: "burst", count: 40, atMs: 0 },
          lifetimeMs: 900,
          speed: 2,
          direction: [0, 1, 0],
          coneAngle: 360,
        },
      ],
      subEmitters: [{ parent: "shell", on: "death", emitter: "embers" }],
    };
    const sim = new ParticleSimulator(system, { seed: 1 });
    play(sim, 2000, 60);
    expect(sim.liveCount).toBeLessThanOrEqual(10_000);
  });
});

describe("ParticleSimulator — an empty system", () => {
  it("reports empty when no emitter emits", () => {
    const system: ParticleSystem = {
      dimensions: 2,
      field: { width: 16, height: 16 },
      durationMs: 500,
      fps: 30,
      loop: false,
      emitters: [
        {
          name: "silent",
          shape: "point",
          position: [8, 8, 0],
          extent: { radius: 1, size: [1, 1, 1] },
          emission: { mode: "burst", count: 0, atMs: 0 },
          lifetimeMs: 200,
          speed: 1,
          direction: [0, 1, 0],
        },
      ],
    };
    const sim = new ParticleSimulator(system);
    expect(sim.isNonEmpty).toBe(false);
    expect(sim.liveCount).toBe(0);
  });
});
