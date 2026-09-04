import { describe, expect, it } from "vitest";
import {
  OVERLOAD_AT,
  OVERLOAD_FLUX_SPREAD,
  OVERLOAD_FLUX_SPREAD_ANGLE,
  OVERLOAD_PRISM_ESCORTS,
  fluxHold,
} from "./constants";
import { addPlayerBulletTo } from "./bullets";
import { resolveContacts } from "./contacts";
import { noCues, type FrameCues } from "./audio";
import { liveState, poseDrone } from "./fixtures";
import { applyMismatch, clampCharge } from "./overload";
import type { DroneKind, SpectraState } from "./game";

/** Land one wrong-band shot on `drone` through the real contact path. */
function mismatchedShot(state: SpectraState, x: number, y: number): FrameCues {
  addPlayerBulletTo(state, x, y, "magenta");
  const cues = noCues();
  resolveContacts(state, cues);
  return cues;
}

function posed(kind: DroneKind, charge = 0) {
  const state = liveState();
  const drone = poseDrone(state, kind, 400, 200, { charge });
  return { state, drone };
}

describe("a mismatched shot", () => {
  it("charges the drone it hits rather than going to waste", () => {
    const { state, drone } = posed("shard");
    mismatchedShot(state, 400, 200);
    expect(state.drones).toContain(drone);
    expect(drone.charge).toBe(1);
  });

  it("advances the charge with each further shot", () => {
    const { state, drone } = posed("shard");
    mismatchedShot(state, 400, 200);
    mismatchedShot(state, 400, 200);
    expect(drone.charge).toBe(2);
  });

  it("scores nothing and fills nothing", () => {
    const { state, drone } = posed("shard");
    mismatchedShot(state, 400, 200);
    expect(state.score).toBe(0);
    expect(state.resonance).toBe(0);
    expect(drone.charge).toBe(1);
  });

  it("leaves a shimmering Flux uncharged", () => {
    const state = liveState();
    const flux = poseDrone(state, "flux", 400, 200, {
      bandClock: fluxHold(1) + 0.1,
    });
    mismatchedShot(state, 400, 200);
    expect(flux.charge).toBe(0);
    expect(state.drones).toContain(flux);
  });

  it("clamps a posed charge to the whole numbers it is defined over", () => {
    expect(clampCharge(-2)).toBe(0);
    expect(clampCharge(1.4)).toBe(1);
    expect(clampCharge(9)).toBe(OVERLOAD_AT);
  });
});

describe("the overload", () => {
  it("fires at the third charge, returns it to zero, and plays its cue", () => {
    const { state, drone } = posed("shard", OVERLOAD_AT - 1);
    const cues = mismatchedShot(state, 400, 200);
    expect(drone.charge).toBe(0);
    expect(cues.overload).toBe(true);
    expect(state.drones).toContain(drone);
  });

  it("scores nothing and fills nothing", () => {
    const { state } = posed("shard", OVERLOAD_AT - 1);
    mismatchedShot(state, 400, 200);
    expect(state.score).toBe(0);
    expect(state.resonance).toBe(0);
  });

  it("lets a drone take charge again afterwards", () => {
    const { state, drone } = posed("shard", OVERLOAD_AT - 1);
    mismatchedShot(state, 400, 200);
    mismatchedShot(state, 400, 200);
    expect(drone.charge).toBe(1);
  });

  it("still lets a matching shot destroy a charged drone", () => {
    const { state } = posed("shard", 2);
    addPlayerBulletTo(state, 400, 200, "cyan");
    resolveContacts(state, noCues());
    expect(state.drones).toHaveLength(0);
  });

  it("plunges a Shard into a dive in the frame it overloads", () => {
    const { state, drone } = posed("shard", OVERLOAD_AT - 1);
    mismatchedShot(state, 400, 200);
    expect(drone.phase).toBe("diving");
    expect(drone.plunge).toBe(true);
  });

  it("flips a Flux's band and rewinds its window", () => {
    const state = liveState();
    const flux = poseDrone(state, "flux", 400, 200, {
      charge: OVERLOAD_AT - 1,
      bandClock: 0.9,
    });
    mismatchedShot(state, 400, 200);
    expect(flux.band).toBe("magenta");
    expect(flux.bandClock).toBe(0);
  });

  it("sprays a Flux's new band on fanned headings", () => {
    const state = liveState();
    const flux = poseDrone(state, "flux", 400, 200, {
      charge: OVERLOAD_AT - 1,
    });
    mismatchedShot(state, 400, 200);
    const spray = state.bullets.filter((bullet) => !bullet.friendly);
    expect(spray).toHaveLength(OVERLOAD_FLUX_SPREAD);
    expect(spray.every((bullet) => bullet.band === flux.band)).toBe(true);
    const headings = spray.map(
      (bullet) => (Math.atan2(bullet.vx, bullet.vy) * 180) / Math.PI,
    );
    for (let index = 1; index < headings.length; index += 1) {
      expect(headings[index] - headings[index - 1]).toBeCloseTo(
        OVERLOAD_FLUX_SPREAD_ANGLE,
        4,
      );
    }
  });

  it("bursts a Prism's shell into both bands and one escort", () => {
    const { state, drone } = posed("prism", OVERLOAD_AT - 1);
    mismatchedShot(state, 400, 200);
    const fired = state.bullets.filter((bullet) => !bullet.friendly);
    expect(fired).toHaveLength(2);
    expect(new Set(fired.map((bullet) => bullet.band))).toEqual(
      new Set(["cyan", "magenta"]),
    );
    const escorts = state.drones.filter((entry) => entry !== drone);
    expect(escorts).toHaveLength(OVERLOAD_PRISM_ESCORTS);
    expect(escorts[0].kind).toBe("shard");
    expect(escorts[0].phase).toBe("entering");
    expect(Math.abs(escorts[0].x - drone.x)).toBeLessThan(80);
    expect(drone.shellAlive).toBe(true);
  });

  it("bursts a Prism's exposed core and grows nothing", () => {
    const state = liveState();
    const prism = poseDrone(state, "prism", 400, 200, {
      charge: OVERLOAD_AT - 1,
      shellAlive: false,
      band: "magenta",
    });
    // With the shell gone the core reads cyan, so a magenta shot is the mismatch.
    mismatchedShot(state, 400, 200);
    expect(state.bullets.filter((bullet) => !bullet.friendly)).toHaveLength(2);
    expect(state.drones).toEqual([prism]);
    expect(prism.shellAlive).toBe(false);
  });

  it("takes no layer off the drone it fires on", () => {
    const { state, drone } = posed("prism", OVERLOAD_AT - 1);
    applyMismatch(state, drone, noCues());
    expect(drone.shellAlive).toBe(true);
    expect(state.drones).toContain(drone);
  });
});
