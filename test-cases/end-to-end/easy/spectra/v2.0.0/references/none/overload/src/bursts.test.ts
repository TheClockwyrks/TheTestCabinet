// Spectra — the drone-burst, played through the provided runtime.

import { afterEach, describe, expect, it } from "vitest";
import type { ParticleSystem } from "@clockwyrks/particle-runtime";
import { BURST_DURATION, BURST_FIELD, MAX_BURSTS } from "./constants";
import {
  burstParticles,
  burstScale,
  burstSystem,
  captureBurst,
  startBurst,
  stepBursts,
  useBurstSystem,
} from "./bursts";
import { freshState } from "./game";

/** A one-shot system of the same shape as the seeded one, at a tenth the count. */
const SYSTEM: ParticleSystem = {
  dimensions: 2,
  field: { width: BURST_FIELD, height: BURST_FIELD },
  durationMs: BURST_DURATION * 1000,
  fps: 60,
  loop: false,
  emitters: [
    {
      name: "sparks",
      shape: "point",
      position: [64, 64, 0],
      extent: { radius: 1, size: [1, 1, 0] },
      emission: { mode: "burst", count: 20, atMs: 0 },
      lifetimeMs: 500,
      speed: 60,
      direction: [0, 1, 0],
      coneAngle: 360,
      particle: {
        sizeCurve: { interp: "linear", from: 8, to: 1 },
        opacityCurve: { interp: "linear", from: 1, to: 0 },
        colorGradient: [{ color: "#34e2ff", at: 0 }],
      },
    },
  ],
};

afterEach(() => {
  useBurstSystem(null);
});

describe("the burst roster", () => {
  it("plays the provided system, carrying its own live particles", () => {
    useBurstSystem(SYSTEM);
    expect(burstSystem()).toBe(SYSTEM);
    const state = freshState();
    const burst = startBurst(state, 1, 400, 300, 28);
    expect(state.bursts).toHaveLength(1);
    expect(burstParticles(burst)).toBeGreaterThan(0);
    expect(captureBurst(burst).length).toBe(burstParticles(burst));
    expect(burstScale(burst)).toBeCloseTo(28 / BURST_FIELD, 9);
  });

  it("is a one-shot: it ends within its stated span", () => {
    useBurstSystem(SYSTEM);
    const state = freshState();
    startBurst(state, 1, 400, 300, 28);
    for (let step = 0; step < Math.round(BURST_DURATION * 120) - 1; step += 1) {
      stepBursts(state, 1 / 120);
    }
    expect(state.bursts).toHaveLength(1);
    stepBursts(state, 1 / 120);
    stepBursts(state, 1 / 120);
    expect(state.bursts).toHaveLength(0);
  });

  it("caps how many play at once", () => {
    useBurstSystem(SYSTEM);
    const state = freshState();
    for (let index = 0; index < MAX_BURSTS + 8; index += 1) {
      startBurst(state, index + 1, 100 + index, 300, 28);
    }
    expect(state.bursts).toHaveLength(MAX_BURSTS);
    // The oldest gave way, so the newest is still playing.
    expect(state.bursts[state.bursts.length - 1]?.id).toBe(MAX_BURSTS + 8);
  });

  it("scatters two bursts differently, from the game's own generator", () => {
    useBurstSystem(SYSTEM);
    const state = freshState();
    const first = startBurst(state, 1, 400, 300, 28);
    const second = startBurst(state, 2, 400, 300, 28);
    stepBursts(state, 0.1);
    const positions = (index: number): string =>
      JSON.stringify(
        captureBurst(index === 0 ? first : second).map((p) => p.position),
      );
    expect(positions(0)).not.toBe(positions(1));
  });

  it("reproduces the same scatter from the same seed", () => {
    useBurstSystem(SYSTEM);
    const shot = (): string => {
      const state = freshState(7);
      const burst = startBurst(state, 1, 400, 300, 28);
      stepBursts(state, 0.1);
      return JSON.stringify(captureBurst(burst).map((p) => p.position));
    };
    expect(shot()).toBe(shot());
  });

  it("costs the pops and nothing else where no system could be loaded", () => {
    useBurstSystem(null);
    const state = freshState();
    const burst = startBurst(state, 1, 400, 300, 28);
    expect(burstParticles(burst)).toBe(0);
    expect(captureBurst(burst)).toEqual([]);
    expect(() => stepBursts(state, 1 / 60)).not.toThrow();
  });
});
