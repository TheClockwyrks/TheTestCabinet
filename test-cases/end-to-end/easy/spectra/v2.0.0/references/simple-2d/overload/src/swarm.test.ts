// The swarm: the entrance, the formation, the dive, and what each kind asks of
// the band system.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DIVE_FIRE_Y,
  DIVE_FIRST_DELAY,
  DIVE_GAP_MAX,
  DIVE_GAP_MIN,
  DIVE_SPEED,
  ENEMY_BULLET_SPEED,
  ENTER_GROUP_GAP,
  ENTER_SPEED,
  FIELD_BOTTOM,
  FIELD_TOP,
  FLUX_SHIMMER,
  HUD_BOTTOM_TOP,
  INVERSION_TIME,
  PRISM_INVERT_Y,
  SHIP_X_MAX,
  SHIP_X_MIN,
  bulletSpeedScale,
  diveGapScale,
  droneSpeedScale,
  fluxHold,
  fluxWindow,
  slotX,
  slotY,
} from "./constants";
import {
  createHarness,
  droneOf,
  enemyBullets,
  fireAt,
  poseDrone,
  startPosed,
  startStage,
  type Harness,
} from "./harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
  h.pose((s, d) => d.reset(s));
});

afterEach(() => {
  h.dispose();
});

/** A complete row of formation drones, posed at their own slots, free to move. */
function poseRow(count = 5, row = 0): number[] {
  return Array.from({ length: count }, (_, i) =>
    poseDrone(h, "shard", slotX(i + 2), slotY(row), {
      phase: "formation",
      slotX: slotX(i + 2),
      slotY: slotY(row),
      travel: true,
    }),
  );
}

/** The stage's own wave, with its entry running and nothing else. */
async function openWave(stage = 1): Promise<void> {
  startPosed(h, stage);
  h.pose((s, d) => d.setWaveEntry(s, true));
  await startStage(h, stage);
}

describe("the wave and its entrance", () => {
  it("opens with no drone standing on the play field", async () => {
    await openWave();
    const drones = h.snapshot().drones;
    expect(drones.length).toBeGreaterThan(0);
    for (const drone of drones) {
      expect(drone.phase).toBe("entering");
      expect(drone.y).toBeLessThan(FIELD_TOP);
    }
  });

  it("brings drones across the field's top within two seconds", async () => {
    await openWave();
    await h.advance(2);
    const inside = h
      .snapshot()
      .drones.filter(
        (drone) => drone.y > FIELD_TOP && drone.phase !== "formation",
      );
    expect(inside.length).toBeGreaterThan(0);
  });

  it("staggers its groups by the gap the schedule states", async () => {
    await openWave();
    const started = new Map<number, number>();
    const at = new Map<number, { x: number; y: number }>();
    for (const drone of h.snapshot().drones) {
      at.set(drone.id, { x: drone.x, y: drone.y });
    }
    for (let frame = 0; frame < 240; frame++) {
      await h.frames(1);
      const now = h.state.simTime;
      for (const drone of h.snapshot().drones) {
        const from = at.get(drone.id);
        if (from === undefined || started.has(drone.id)) continue;
        if (Math.hypot(drone.x - from.x, drone.y - from.y) > 0.5) {
          started.set(drone.id, now);
        }
      }
    }
    const byGroup = new Map<number, number>();
    for (const drone of h.state.drones) {
      const when = started.get(drone.id);
      if (when === undefined) continue;
      const group = drone.entryGroup;
      byGroup.set(group, Math.min(byGroup.get(group) ?? Infinity, when));
    }
    const groups = [...byGroup.entries()].sort((a, b) => a[0] - b[0]);
    expect(groups.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < groups.length; i++) {
      const gap = (groups[i]?.[1] ?? 0) - (groups[i - 1]?.[1] ?? 0);
      expect(gap).toBeGreaterThan(ENTER_GROUP_GAP * 0.8);
      expect(gap).toBeLessThan(ENTER_GROUP_GAP * 1.2);
    }
  });

  it("flies an entrance at its own speed, continuously", async () => {
    await openWave();
    await h.advance(0.7);
    const target = h
      .snapshot()
      .drones.find(
        (drone) => drone.phase === "entering" && drone.y > FIELD_TOP,
      );
    expect(target).toBeDefined();
    const id = target?.id as number;

    let travelled = 0;
    let biggest = 0;
    let previous = droneOf(h, id);
    for (let frame = 0; frame < 60; frame++) {
      await h.frames(1);
      const now = droneOf(h, id);
      if (now === undefined || previous === undefined) break;
      if (now.phase !== "entering") break;
      const step = Math.hypot(now.x - previous.x, now.y - previous.y);
      travelled += step;
      biggest = Math.max(biggest, step);
      previous = now;
    }
    const perFrame = (ENTER_SPEED * droneSpeedScale(1)) / 60;
    expect(biggest).toBeLessThan(perFrame * 1.2);
    expect(travelled).toBeGreaterThan(perFrame * 20);
  });

  it("settles every drone into its slot, holding both bands", async () => {
    await openWave();
    await h.advance(12);
    const drones = h.snapshot().drones;
    expect(drones.length).toBeGreaterThan(0);
    for (const drone of drones) {
      expect(drone.phase).toBe("formation");
      expect(Math.abs(drone.x - drone.slotX)).toBeLessThan(22);
      expect(drone.y).toBeCloseTo(drone.slotY, 3);
    }
    const bands = new Set(drones.map((drone) => drone.effectiveBand));
    expect(bands.has("cyan")).toBe(true);
    expect(bands.has("magenta")).toBe(true);
  });
});

describe("the dive", () => {
  it("waits its first delay and then keeps its cadence", async () => {
    startPosed(h);
    poseRow(9 - 4);
    for (let col = 0; col < 9; col++) {
      poseDrone(h, "shard", slotX(col), slotY(1), {
        phase: "formation",
        slotX: slotX(col),
        slotY: slotY(1),
      });
    }
    h.pose((s, d) => d.setDiveClock(s, 0));
    h.pose((s, d) => d.setDiveLaunching(s, true));

    const launches: number[] = [];
    let diving = 0;
    for (let frame = 0; frame < 60 * 12; frame++) {
      await h.frames(1);
      const now = h
        .snapshot()
        .drones.filter((d) => d.phase === "diving").length;
      if (now > diving) launches.push(h.state.simTime);
      diving = now;
    }
    expect(launches.length).toBeGreaterThan(2);
    expect(launches[0] ?? 0).toBeGreaterThan(DIVE_FIRST_DELAY * 0.8);
    expect(launches[0] ?? 0).toBeLessThan(DIVE_FIRST_DELAY * 1.2);
    for (let i = 1; i < launches.length; i++) {
      const gap = (launches[i] ?? 0) - (launches[i - 1] ?? 0);
      expect(gap).toBeGreaterThan(DIVE_GAP_MIN * diveGapScale(1) * 0.8);
      expect(gap).toBeLessThan(DIVE_GAP_MAX * diveGapScale(1) * 1.2);
    }
  });

  it("takes a resting drone out of the formation", async () => {
    startPosed(h);
    const ids = poseRow();
    h.pose((s, d) => d.setDiveClock(s, 0));
    h.pose((s, d) => d.setDiveLaunching(s, true));
    await h.advance(DIVE_FIRST_DELAY + 1);
    const diver = h.snapshot().drones.find((d) => d.phase === "diving");
    expect(diver).toBeDefined();
    expect(ids).toContain(diver?.id);
    expect(diver?.y).toBeGreaterThan(slotY(0) + 40);
  });

  it("runs at the dive speed, continuously, with at most one wrap", async () => {
    startPosed(h);
    const id = poseDrone(h, "shard", 640, slotY(0), {
      phase: "diving",
      travel: true,
      slotX: 640,
      slotY: slotY(0),
    });
    let previous = droneOf(h, id);
    let travelled = 0;
    let frames = 0;
    let wraps = 0;
    const perFrame = (DIVE_SPEED * droneSpeedScale(1)) / 60;
    for (let frame = 0; frame < 60 * 3; frame++) {
      await h.frames(1);
      const now = droneOf(h, id);
      if (now === undefined || previous === undefined) break;
      if (now.phase !== "diving") break;
      const step = Math.hypot(now.x - previous.x, now.y - previous.y);
      if (step > perFrame * 1.5) {
        wraps++;
        expect(previous.y).toBeGreaterThan(FIELD_BOTTOM - 40);
        expect(now.y).toBeLessThan(FIELD_TOP + 40);
      } else {
        travelled += step;
        frames++;
      }
      previous = now;
    }
    expect(wraps).toBeLessThanOrEqual(1);
    expect((travelled / frames) * 60).toBeCloseTo(DIVE_SPEED, -1);
  });

  it("bends toward the ship, wherever the ship stands", async () => {
    for (const x of [SHIP_X_MIN + 20, SHIP_X_MAX - 20]) {
      startPosed(h);
      h.pose((s, d) => d.setShipX(s, x));
      const id = poseDrone(h, "shard", 640, slotY(0), {
        phase: "diving",
        travel: true,
      });
      const gap = Math.abs(640 - x);
      await h.advance(1.2);
      const now = droneOf(h, id);
      const closed = gap - Math.abs((now?.x ?? 640) - x);
      expect(closed).toBeGreaterThan(gap / 3);
    }
  });

  it("turns for home above the bottom strip, or wraps, and comes back", async () => {
    for (const seedShift of [0, 1]) {
      startPosed(h);
      // Two drones, so both the wrapping and the looping path are exercised.
      const id = poseDrone(h, "shard", 500 + seedShift * 40, slotY(0), {
        phase: "diving",
        travel: true,
        slotX: slotX(3),
        slotY: slotY(0),
      });
      let deepest = 0;
      for (let frame = 0; frame < 60 * 8; frame++) {
        await h.frames(1);
        const now = droneOf(h, id);
        if (now === undefined) break;
        if (now.phase === "diving") deepest = Math.max(deepest, now.y);
        if (now.phase === "formation") break;
      }
      const finished = droneOf(h, id);
      expect(finished?.phase).toBe("formation");
      expect(Math.abs((finished?.x ?? 0) - slotX(3))).toBeLessThan(25);
      expect(deepest).toBeLessThan(HUD_BOTTOM_TOP);
    }
  });
});

describe("enemy fire", () => {
  it("comes from a diver alone, as it crosses the fire line", async () => {
    startPosed(h);
    poseRow();
    await h.advance(10);
    expect(enemyBullets(h)).toHaveLength(0);

    const id = poseDrone(h, "shard", 640, DIVE_FIRE_Y - 60, {
      phase: "diving",
      travel: true,
      fire: true,
    });
    let firedAt: number | null = null;
    for (let frame = 0; frame < 120; frame++) {
      await h.frames(1);
      if (firedAt === null && enemyBullets(h).length > 0) {
        firedAt = droneOf(h, id)?.y ?? null;
      }
    }
    expect(firedAt).not.toBeNull();
    expect(firedAt as number).toBeGreaterThanOrEqual(DIVE_FIRE_Y);
    expect(firedAt as number).toBeLessThan(DIVE_FIRE_Y + 12);
  });

  it("falls at the stage's own speed and carries its firer's band", async () => {
    startPosed(h, 5);
    h.pose((s, d) => d.addEnemyBullet(s, 400, 120, "magenta"));
    const first = h.snapshot().bullets[0];
    await h.advance(0.5);
    const now = h.snapshot().bullets[0];
    expect((now?.y ?? 0) - (first?.y ?? 0)).toBeCloseTo(
      ENEMY_BULLET_SPEED * bulletSpeedScale(5) * 0.5,
      0,
    );
    expect(now?.band).toBe("magenta");

    startPosed(h);
    poseDrone(h, "shard", 640, DIVE_FIRE_Y - 20, {
      phase: "diving",
      band: "magenta",
      travel: true,
      fire: true,
    });
    await h.advance(0.3);
    expect(enemyBullets(h)[0]?.band).toBe("magenta");
  });

  it("leaves the field at the bottom", async () => {
    startPosed(h);
    h.pose((s, d) => d.addEnemyBullet(s, 400, FIELD_BOTTOM - 20, "cyan"));
    await h.advance(0.4);
    expect(enemyBullets(h)).toHaveLength(0);
  });
});

describe("the Shard", () => {
  it("keeps one band and takes one shot over a dive", async () => {
    startPosed(h);
    const id = poseDrone(h, "shard", 640, DIVE_FIRE_Y - 40, {
      band: "magenta",
      phase: "diving",
      travel: true,
      oscillation: true,
      fire: true,
    });
    let shots = 0;
    let seen = 0;
    for (let frame = 0; frame < 60 * 6; frame++) {
      await h.frames(1);
      const now = enemyBullets(h).length;
      if (now > seen) shots += now - seen;
      seen = now;
      if (droneOf(h, id)?.phase === "formation") break;
    }
    expect(shots).toBe(1);
    expect(droneOf(h, id)?.band).toBe("magenta");
  });
});

describe("the Flux", () => {
  it("holds its band for the hold, shimmers, then emerges on the other", async () => {
    startPosed(h);
    const id = poseDrone(h, "flux", 500, 300, {
      band: "cyan",
      bandClock: 0,
      oscillation: true,
    });
    await h.advance(fluxHold(1) * 0.9);
    expect(droneOf(h, id)?.shimmer).toBe(false);
    expect(droneOf(h, id)?.band).toBe("cyan");

    await h.advance(fluxHold(1) * 0.2);
    expect(droneOf(h, id)?.shimmer).toBe(true);
    expect(droneOf(h, id)?.effectiveBand).toBe("magenta");

    await h.advance(FLUX_SHIMMER);
    expect(droneOf(h, id)?.shimmer).toBe(false);
    expect(droneOf(h, id)?.band).toBe("magenta");
    await h.advance(fluxWindow(1));
    expect(droneOf(h, id)?.band).toBe("cyan");
  });

  it("takes no shot while it shimmers, and falls on its held band", async () => {
    startPosed(h);
    const id = poseDrone(h, "flux", 500, 300, {
      band: "cyan",
      bandClock: fluxHold(1),
    });
    expect(droneOf(h, id)?.shimmer).toBe(true);
    await fireAt(h, 500, 300, "cyan");
    expect(droneOf(h, id)).toBeDefined();
    await fireAt(h, 500, 300, "magenta");
    expect(droneOf(h, id)).toBeDefined();

    h.pose((s, d) => d.setDroneBandClock(s, id, 0));
    await fireAt(h, 500, 300, "cyan");
    expect(droneOf(h, id)).toBeUndefined();
  });

  it("fires nothing while it shimmers", async () => {
    startPosed(h);
    poseDrone(h, "flux", 640, DIVE_FIRE_Y + 40, {
      band: "cyan",
      bandClock: fluxHold(1),
      phase: "diving",
      fire: true,
    });
    await h.advance(FLUX_SHIMMER * 0.8);
    expect(enemyBullets(h)).toHaveLength(0);
  });

  it("fires the band it holds", async () => {
    startPosed(h);
    poseDrone(h, "flux", 640, DIVE_FIRE_Y + 40, {
      band: "magenta",
      bandClock: 0,
      phase: "diving",
      fire: true,
    });
    await h.frames(2);
    expect(enemyBullets(h)[0]?.band).toBe("magenta");
  });
});

describe("the Prism", () => {
  it("loses its shell to the shell's band and its core to the core's", async () => {
    startPosed(h);
    const id = poseDrone(h, "prism", 500, 300, { band: "cyan" });
    await fireAt(h, 500, 300, "magenta");
    expect(droneOf(h, id)?.shellAlive).toBe(true);

    await fireAt(h, 500, 300, "cyan");
    expect(droneOf(h, id)?.shellAlive).toBe(false);
    expect(droneOf(h, id)?.effectiveBand).toBe("magenta");

    await fireAt(h, 500, 300, "cyan");
    expect(droneOf(h, id)).toBeDefined();
    await fireAt(h, 500, 300, "magenta");
    expect(droneOf(h, id)).toBeUndefined();
  });

  it("can lose its shell while it rests in the formation", async () => {
    startPosed(h);
    const id = poseDrone(h, "prism", 500, 300, {
      band: "magenta",
      phase: "formation",
    });
    await fireAt(h, 500, 300, "magenta");
    expect(droneOf(h, id)?.shellAlive).toBe(false);
  });

  it("fires one bullet of each band over its dive", async () => {
    startPosed(h);
    poseDrone(h, "prism", 640, DIVE_FIRE_Y + 20, {
      band: "cyan",
      phase: "diving",
      fire: true,
    });
    await h.frames(2);
    const shots = enemyBullets(h);
    expect(shots).toHaveLength(2);
    expect(new Set(shots.map((bullet) => bullet.band))).toEqual(
      new Set(["cyan", "magenta"]),
    );
  });

  it("inverts the field at the bottom and heads home unharmed", async () => {
    startPosed(h);
    const id = poseDrone(h, "prism", 640, PRISM_INVERT_Y - 60, {
      phase: "diving",
      travel: true,
      slotX: slotX(4),
      slotY: slotY(0),
    });
    await h.advance(0.6);
    expect(h.snapshot().inversionActive).toBe(true);
    expect(h.snapshot().inversion).toBeCloseTo(INVERSION_TIME, 0);
    const now = droneOf(h, id);
    expect(now).toBeDefined();
    expect(now?.phase).toBe("returning");
  });

  it("refreshes a running inversion rather than adding to it", async () => {
    startPosed(h);
    h.pose((s, d) => d.setInversion(s, INVERSION_TIME * 0.4));
    poseDrone(h, "prism", 640, PRISM_INVERT_Y - 40, {
      phase: "diving",
      travel: true,
    });
    await h.advance(0.4);
    expect(h.snapshot().inversion).toBeLessThan(INVERSION_TIME + 0.1);
    expect(h.snapshot().inversion).toBeGreaterThan(INVERSION_TIME * 0.8);
  });

  it("enters with two Shards of opposite bands alongside it", async () => {
    await openWave();
    let best = Infinity;
    let escorts = 0;
    for (let frame = 0; frame < 60 * 6; frame++) {
      await h.frames(1);
      const drones = h.snapshot().drones;
      const prism = drones.find((drone) => drone.kind === "prism");
      if (prism === undefined) continue;
      const near = drones.filter(
        (drone) =>
          drone.kind === "shard" &&
          drone.phase === "entering" &&
          Math.hypot(drone.x - prism.x, drone.y - prism.y) < 320,
      );
      const bands = new Set(near.map((drone) => drone.band));
      if (near.length >= 2 && bands.size === 2) {
        escorts = near.length;
        best = 0;
        break;
      }
    }
    expect(best).toBe(0);
    expect(escorts).toBeGreaterThanOrEqual(2);
  });
});
