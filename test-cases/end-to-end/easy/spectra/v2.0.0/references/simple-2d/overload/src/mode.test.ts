// Overload: what a mismatched shot does, and how each kind reacts when it tips.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CUES,
  DIVE_SPEED,
  OVERLOAD_AT,
  OVERLOAD_DIVE_SCALE,
  OVERLOAD_FLUX_SPREAD,
  OVERLOAD_FLUX_SPREAD_ANGLE,
  OVERLOAD_PRISM_ESCORTS,
  fluxHold,
} from "./constants";
import {
  createHarness,
  droneOf,
  enemyBullets,
  fireAt,
  poseDrone,
  startPosed,
  type Harness,
} from "./harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
  h.pose((s, d) => d.reset(s, { seed: 2 }));
  startPosed(h);
});

afterEach(() => {
  h.dispose();
});

/** The heading a bullet leaves on, in degrees, straight down being zero. */
function heading(bullet: { vx: number; vy: number }): number {
  return (Math.atan2(bullet.vx, bullet.vy) * 180) / Math.PI;
}

describe("charge", () => {
  it("is fed by a mismatched shot and advances one at a time", async () => {
    const id = poseDrone(h, "shard", 500, 300, { band: "cyan" });
    expect(droneOf(h, id)?.charge).toBe(0);
    await fireAt(h, 500, 300, "magenta");
    expect(droneOf(h, id)?.charge).toBe(1);
    await fireAt(h, 500, 300, "magenta");
    expect(droneOf(h, id)?.charge).toBe(2);
  });

  it("returns to zero when the drone overloads, and takes charge again", async () => {
    const id = poseDrone(h, "shard", 500, 300, {
      band: "cyan",
      charge: OVERLOAD_AT - 1,
    });
    await fireAt(h, 500, 300, "magenta");
    expect(droneOf(h, id)?.charge).toBe(0);
    expect(droneOf(h, id)?.phase).toBe("diving");

    h.pose((s, d) => d.setDronePosition(s, id, 500, 300));
    await fireAt(h, 500, 300, "magenta");
    expect(droneOf(h, id)?.charge).toBe(1);
  });

  it("is not taken by a shimmering Flux, of either band", async () => {
    const id = poseDrone(h, "flux", 500, 300, {
      band: "cyan",
      bandClock: fluxHold(1),
    });
    await fireAt(h, 500, 300, "cyan");
    await fireAt(h, 500, 300, "magenta");
    expect(droneOf(h, id)).toBeDefined();
    expect(droneOf(h, id)?.charge).toBe(0);
  });

  it("never stops a matching shot destroying the drone", async () => {
    const id = poseDrone(h, "shard", 500, 300, {
      band: "cyan",
      charge: OVERLOAD_AT - 1,
    });
    await fireAt(h, 500, 300, "cyan");
    expect(droneOf(h, id)).toBeUndefined();
  });

  it("pays nothing to the score or to the meter", async () => {
    poseDrone(h, "shard", 500, 300, { band: "cyan", charge: 0 });
    await fireAt(h, 500, 300, "magenta");
    expect(h.snapshot().score).toBe(0);
    expect(h.snapshot().resonance).toBe(0);

    const id = poseDrone(h, "shard", 700, 300, {
      band: "cyan",
      charge: OVERLOAD_AT - 1,
    });
    await fireAt(h, 700, 300, "magenta");
    expect(droneOf(h, id)?.charge).toBe(0);
    expect(h.snapshot().score).toBe(0);
    expect(h.snapshot().resonance).toBe(0);
  });

  it("plays its own cue in the frame the drone overloads", async () => {
    poseDrone(h, "shard", 500, 300, {
      band: "cyan",
      charge: OVERLOAD_AT - 1,
    });
    const before = h.cues.filter((cue) => cue.cue === CUES.overload).length;
    await fireAt(h, 500, 300, "magenta");
    expect(
      h.cues.filter((cue) => cue.cue === CUES.overload).length,
    ).toBeGreaterThan(before);
  });
});

describe("an overloaded Shard", () => {
  it("plunges toward the ship, faster than a dive", async () => {
    h.pose((s, d) => d.setShipX(s, 300));
    const id = poseDrone(h, "shard", 800, 200, {
      band: "cyan",
      charge: OVERLOAD_AT - 1,
      travel: true,
    });
    await fireAt(h, 800, 200, "magenta");
    expect(droneOf(h, id)?.phase).toBe("diving");

    const from = droneOf(h, id);
    await h.advance(0.5);
    const now = droneOf(h, id);
    const travelled = Math.hypot(
      (now?.x ?? 0) - (from?.x ?? 0),
      (now?.y ?? 0) - (from?.y ?? 0),
    );
    const expected = DIVE_SPEED * OVERLOAD_DIVE_SCALE * 0.5;
    expect(travelled).toBeGreaterThan(expected * 0.85);
    expect(travelled).toBeLessThan(expected * 1.15);
    expect(now?.x).toBeLessThan(from?.x ?? 0);
    expect(now?.y).toBeGreaterThan(from?.y ?? 0);
  });
});

describe("an overloaded Flux", () => {
  it("flips its band, opens a fresh window, and sprays its new band", async () => {
    const id = poseDrone(h, "flux", 500, 300, {
      band: "cyan",
      bandClock: 0.3,
      charge: OVERLOAD_AT - 1,
    });
    await fireAt(h, 500, 300, "magenta");
    const drone = droneOf(h, id);
    expect(drone?.band).toBe("magenta");
    expect(drone?.bandClock).toBe(0);

    const shots = enemyBullets(h);
    expect(shots).toHaveLength(OVERLOAD_FLUX_SPREAD);
    for (const shot of shots) expect(shot.band).toBe("magenta");
  });

  it("fans the spray by the angle the mode states", async () => {
    poseDrone(h, "flux", 500, 300, {
      band: "cyan",
      bandClock: 0,
      charge: OVERLOAD_AT - 1,
    });
    await fireAt(h, 500, 300, "magenta");
    const headings = enemyBullets(h).map(heading);
    expect(headings).toHaveLength(OVERLOAD_FLUX_SPREAD);
    for (let i = 1; i < headings.length; i++) {
      const gap = Math.abs((headings[i] ?? 0) - (headings[i - 1] ?? 0));
      expect(gap).toBeGreaterThan(OVERLOAD_FLUX_SPREAD_ANGLE * 0.85);
      expect(gap).toBeLessThan(OVERLOAD_FLUX_SPREAD_ANGLE * 1.15);
    }
  });
});

describe("an overloaded Prism", () => {
  it("bursts both bands and grows the swarm while its shell stands", async () => {
    const id = poseDrone(h, "prism", 500, 300, {
      band: "cyan",
      charge: OVERLOAD_AT - 1,
    });
    const before = h.snapshot().drones.length;
    await fireAt(h, 500, 300, "magenta");

    const shots = enemyBullets(h);
    expect(shots).toHaveLength(2);
    expect(new Set(shots.map((shot) => shot.band))).toEqual(
      new Set(["cyan", "magenta"]),
    );
    expect(h.snapshot().drones).toHaveLength(before + OVERLOAD_PRISM_ESCORTS);
    expect(droneOf(h, id)?.shellAlive).toBe(true);
    const escort = h.snapshot().drones[h.snapshot().drones.length - 1];
    expect(escort?.kind).toBe("shard");
    expect(Math.abs((escort?.x ?? 0) - 500)).toBeLessThan(80);
  });

  it("bursts but grows nothing once only its core is left", async () => {
    poseDrone(h, "prism", 500, 300, {
      band: "cyan",
      shellAlive: false,
      charge: OVERLOAD_AT - 1,
    });
    const before = h.snapshot().drones.length;
    await fireAt(h, 500, 300, "cyan");
    expect(enemyBullets(h)).toHaveLength(2);
    expect(h.snapshot().drones).toHaveLength(before);
  });
});
