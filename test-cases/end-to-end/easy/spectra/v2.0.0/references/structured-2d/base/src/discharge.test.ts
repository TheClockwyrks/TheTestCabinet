// The resonance meter and the wave it pays for.

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
import { liveWave } from "./fixtures";

describe("the meter", () => {
  it("caps at the ceiling and never passes it", () => {
    const state = liveWave();
    fillResonance(state, RESONANCE_MAX * 3);
    expect(state.resonance).toBe(RESONANCE_MAX);
  });

  it("is ready exactly at full, and not one point below", () => {
    expect(dischargeReady(RESONANCE_MAX - 1)).toBe(false);
    expect(dischargeReady(RESONANCE_MAX)).toBe(true);
  });
});

describe("the discharge", () => {
  it("spends the whole meter and starts a wave at full", () => {
    const state = liveWave();
    state.resonance = RESONANCE_MAX;
    expect(releaseDischarge(state)).toBe(true);
    expect(state.resonance).toBe(0);
    expect(state.discharge.active).toBe(true);
    expect(state.discharge.radius).toBe(0);
  });

  it("does nothing at all below full", () => {
    const state = liveWave();
    state.resonance = RESONANCE_MAX - 1;
    expect(releaseDischarge(state)).toBe(false);
    expect(state.resonance).toBe(RESONANCE_MAX - 1);
    expect(state.discharge.active).toBe(false);
  });

  it("grows its radius over its whole life and then stops", () => {
    const state = liveWave();
    state.resonance = RESONANCE_MAX;
    releaseDischarge(state);

    stepDischarge(state, DISCHARGE_TIME / 2);
    expect(state.discharge.radius).toBeCloseTo(DISCHARGE_MAX_R / 2, 6);
    expect(state.discharge.active).toBe(true);

    stepDischarge(state, DISCHARGE_TIME / 2);
    expect(state.discharge.active).toBe(false);
    expect(state.discharge.radius).toBe(0);
  });

  it("reaches a thing when its centre lies inside the current radius", () => {
    const state = liveWave();
    state.ship.x = 640;
    state.resonance = RESONANCE_MAX;
    releaseDischarge(state);
    stepDischarge(state, DISCHARGE_TIME / 10);
    const r = state.discharge.radius;

    expect(waveReaches(state, 640 + r - 1, SHIP_Y)).toBe(true);
    expect(waveReaches(state, 640 + r + 1, SHIP_Y)).toBe(false);
  });

  it("reaches nothing while no wave is live", () => {
    const state = liveWave();
    expect(waveReaches(state, 640, SHIP_Y)).toBe(false);
  });
});
