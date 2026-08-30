// The band derivations: one definition of effective band, applied as toggles.

import { describe, expect, it } from "vitest";
import {
  FLUX_HALF,
  FLUX_SIZE,
  PRISM_CORE_HALF,
  PRISM_CORE_SIZE,
  PRISM_HALF,
  PRISM_SIZE,
  RESONANCE_MAX,
  SHARD_HALF,
  SHARD_SIZE,
  fluxHold,
  fluxWindow,
} from "./constants";
import {
  dischargeReady,
  droneFootprint,
  droneHalf,
  effectiveBulletBand,
  effectiveDroneBand,
  inversionActive,
  opposite,
  shimmering,
  shipAlive,
  shotDestroys,
  type BandedDrone,
} from "./bands";

function drone(patch: Partial<BandedDrone> = {}): BandedDrone {
  return {
    kind: "shard",
    band: "cyan",
    shellAlive: true,
    bandClock: 0,
    ...patch,
  };
}

describe("effective band", () => {
  it("is the stored band with no swap standing", () => {
    expect(effectiveDroneBand(drone(), 1, 0)).toBe("cyan");
    expect(effectiveDroneBand(drone({ band: "magenta" }), 1, 0)).toBe("magenta");
  });

  it("is the opposite for a Prism whose shell has broken", () => {
    const prism = drone({ kind: "prism", shellAlive: false });
    expect(effectiveDroneBand(prism, 1, 0)).toBe("magenta");
  });

  it("is the opposite for every drone under an inversion", () => {
    expect(effectiveDroneBand(drone(), 1, 3)).toBe("magenta");
  });

  it("cancels two swaps rather than adding them", () => {
    const prism = drone({ kind: "prism", shellAlive: false });
    expect(effectiveDroneBand(prism, 1, 3)).toBe("cyan");
  });

  it("reports the band a shimmering Flux is moving toward", () => {
    const flux = drone({ kind: "flux", bandClock: fluxHold(1) });
    expect(shimmering(flux, 1)).toBe(true);
    expect(effectiveDroneBand(flux, 1, 0)).toBe("magenta");
  });

  it("holds the stored band while a Flux is settled", () => {
    const flux = drone({ kind: "flux", bandClock: fluxHold(1) - 0.01 });
    expect(shimmering(flux, 1)).toBe(false);
    expect(effectiveDroneBand(flux, 1, 0)).toBe("cyan");
  });

  it("never swaps one of the player's bullets", () => {
    const bullet = { band: "cyan", friendly: true } as const;
    expect(effectiveBulletBand(bullet, 4)).toBe("cyan");
  });

  it("swaps an enemy bullet under an inversion", () => {
    const bullet = { band: "cyan", friendly: false } as const;
    expect(effectiveBulletBand(bullet, 4)).toBe("magenta");
    expect(effectiveBulletBand(bullet, 0)).toBe("cyan");
  });
});

describe("what a shot destroys", () => {
  it("destroys a drone of the matching effective band", () => {
    expect(shotDestroys("cyan", drone(), 1, 0)).toBe(true);
    expect(shotDestroys("magenta", drone(), 1, 0)).toBe(false);
  });

  it("destroys no shimmering Flux, of either band", () => {
    const flux = drone({ kind: "flux", bandClock: fluxWindow(1) - 0.01 });
    expect(shotDestroys("cyan", flux, 1, 0)).toBe(false);
    expect(shotDestroys("magenta", flux, 1, 0)).toBe(false);
  });
});

describe("the figures each kind carries", () => {
  it("draws and collides at its own footprint", () => {
    expect(droneFootprint(drone())).toBe(SHARD_SIZE);
    expect(droneHalf(drone())).toBe(SHARD_HALF);
    expect(droneFootprint(drone({ kind: "flux" }))).toBe(FLUX_SIZE);
    expect(droneHalf(drone({ kind: "flux" }))).toBe(FLUX_HALF);
    expect(droneFootprint(drone({ kind: "prism" }))).toBe(PRISM_SIZE);
    expect(droneHalf(drone({ kind: "prism" }))).toBe(PRISM_HALF);
    const core = drone({ kind: "prism", shellAlive: false });
    expect(droneFootprint(core)).toBe(PRISM_CORE_SIZE);
    expect(droneHalf(core)).toBe(PRISM_CORE_HALF);
  });
});

describe("the other derived facts", () => {
  it("reads a discharge as ready exactly at a full meter", () => {
    expect(dischargeReady(RESONANCE_MAX - 1)).toBe(false);
    expect(dischargeReady(RESONANCE_MAX)).toBe(true);
  });

  it("reads an inversion as active only while time is left", () => {
    expect(inversionActive(0)).toBe(false);
    expect(inversionActive(0.1)).toBe(true);
  });

  it("reads the ship as gone exactly while the phase is ready", () => {
    expect(shipAlive("live")).toBe(true);
    expect(shipAlive("ready")).toBe(false);
  });

  it("has exactly two bands", () => {
    expect(opposite("cyan")).toBe("magenta");
    expect(opposite("magenta")).toBe("cyan");
  });
});
