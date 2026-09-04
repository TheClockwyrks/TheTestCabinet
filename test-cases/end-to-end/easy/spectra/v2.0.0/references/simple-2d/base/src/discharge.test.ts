// The meter's ceiling, what a discharge costs, and the wave's reach.

import { describe, expect, it } from "vitest";
import {
  DISCHARGE_MAX_R,
  DISCHARGE_TIME,
  RESONANCE_MAX,
  SHIP_Y,
} from "./constants";
import {
  dischargeReady,
  fillResonance,
  releaseDischarge,
  stepDischarge,
  waveReaches,
} from "./discharge";
import { bareOpeningState } from "./flow";
import { toSim } from "./sim";

describe("resonance and the discharge", () => {
  it("caps the meter and never passes the ceiling", () => {
    const sim = toSim(bareOpeningState());
    fillResonance(sim, RESONANCE_MAX - 1);
    fillResonance(sim, 50);
    expect(sim.resonance).toBe(RESONANCE_MAX);
  });

  it("is ready exactly at full", () => {
    expect(dischargeReady(RESONANCE_MAX - 1)).toBe(false);
    expect(dischargeReady(RESONANCE_MAX)).toBe(true);
  });

  it("spends the whole meter, or does nothing at all", () => {
    const sim = toSim(bareOpeningState());
    sim.resonance = RESONANCE_MAX - 1;
    expect(releaseDischarge(sim)).toBe(false);
    expect(sim.resonance).toBe(RESONANCE_MAX - 1);
    expect(sim.discharge.active).toBe(false);

    sim.resonance = RESONANCE_MAX;
    expect(releaseDischarge(sim)).toBe(true);
    expect(sim.resonance).toBe(0);
    expect(sim.discharge.active).toBe(true);
    expect(sim.discharge.radius).toBe(0);
  });

  it("grows the wave over its own time and then stops", () => {
    const sim = toSim(bareOpeningState());
    sim.resonance = RESONANCE_MAX;
    releaseDischarge(sim);
    const h = 1 / 120;
    let steps = 0;
    while (sim.discharge.active && steps < 10_000) {
      stepDischarge(sim, h);
      steps += 1;
    }
    expect(steps * h).toBeCloseTo(DISCHARGE_TIME, 2);
    expect(sim.discharge.radius).toBe(0);
  });

  it("reaches a centre inside its radius, from the ship, and nothing while it is over", () => {
    const sim = toSim(bareOpeningState());
    sim.resonance = RESONANCE_MAX;
    releaseDischarge(sim);
    stepDischarge(sim, DISCHARGE_TIME / 2);
    const radius = sim.discharge.radius;
    expect(radius).toBeCloseTo(DISCHARGE_MAX_R / 2, 6);
    expect(waveReaches(sim, sim.ship.x, SHIP_Y - radius * 0.5)).toBe(true);
    expect(waveReaches(sim, sim.ship.x + radius * 2, SHIP_Y)).toBe(false);

    sim.discharge.active = false;
    expect(waveReaches(sim, sim.ship.x, SHIP_Y)).toBe(false);
  });
});
