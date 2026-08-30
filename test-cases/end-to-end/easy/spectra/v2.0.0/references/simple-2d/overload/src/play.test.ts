// The ship, the two bands, and the meter the discharge is paid from.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DISCHARGE_TIME,
  FIELD_TOP,
  FLIP_LOCKOUT,
  MAX_PLAYER_BULLETS,
  PLAYER_BULLET_SPEED,
  RESONANCE_ABSORB,
  RESONANCE_KILL,
  RESONANCE_MAX,
  SHIP_SPEED,
  SHIP_X_MAX,
  SHIP_X_MIN,
  SHIP_Y,
  START_LIVES,
  FIRE_INTERVAL,
  INVERSION_TIME,
} from "./constants";
import { LANE_CENTRE } from "./flow";
import {
  createHarness,
  droneOf,
  enemyBullets,
  fireAt,
  last,
  playerBullets,
  poseDrone,
  startPosed,
  type Harness,
} from "./harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
  startPosed(h);
});

afterEach(() => {
  h.dispose();
});

describe("the ship", () => {
  it("travels its speed while a direction is held", async () => {
    const from = h.snapshot().ship.x;
    h.hold("ArrowLeft");
    await h.advance(1);
    h.release("ArrowLeft");
    expect(from - h.snapshot().ship.x).toBeCloseTo(SHIP_SPEED, 0);

    const left = h.snapshot().ship.x;
    h.hold("ArrowRight");
    await h.advance(1);
    h.release("ArrowRight");
    expect(h.snapshot().ship.x - left).toBeCloseTo(SHIP_SPEED, 0);
  });

  it("stops in the frame the direction is released", async () => {
    h.hold("KeyD");
    await h.advance(0.5);
    h.release("KeyD");
    const at = h.snapshot().ship.x;
    await h.advance(0.1);
    expect(Math.abs(h.snapshot().ship.x - at)).toBeLessThan(1);
  });

  it("stands still while both directions are held", async () => {
    const at = h.snapshot().ship.x;
    h.hold("ArrowLeft");
    h.hold("ArrowRight");
    await h.advance(0.5);
    h.release("ArrowLeft");
    h.release("ArrowRight");
    expect(h.snapshot().ship.x).toBeCloseTo(at, 6);
  });

  it("rests at each bound rather than wrapping", async () => {
    h.pose((s, d) => d.setShipX(s, SHIP_X_MIN + 120));
    h.hold("ArrowLeft");
    await h.advance(2);
    h.release("ArrowLeft");
    expect(h.snapshot().ship.x).toBe(SHIP_X_MIN);

    h.pose((s, d) => d.setShipX(s, SHIP_X_MAX - 120));
    h.hold("ArrowRight");
    await h.advance(2);
    h.release("ArrowRight");
    expect(h.snapshot().ship.x).toBe(SHIP_X_MAX);
  });

  it("holds its lane through a second of movement", async () => {
    h.hold("ArrowLeft");
    await h.advance(1);
    h.release("ArrowLeft");
    h.pose((s, d) => d.addPlayerBullet(s, h.state.ship.x, SHIP_Y, "cyan"));
    expect(last(h.snapshot().bullets).y).toBe(SHIP_Y);
  });
});

describe("the cannon", () => {
  it("puts one bullet on the field per press, at the ship's nose", async () => {
    h.tap("Space");
    await h.frames(1);
    const shots = playerBullets(h);
    expect(shots).toHaveLength(1);
    expect(Math.abs((shots[0]?.x ?? 0) - h.state.ship.x)).toBeLessThan(4);
    expect(shots[0]?.y).toBeLessThan(SHIP_Y);
  });

  it("climbs at its own speed", async () => {
    h.pose((s, d) => d.addPlayerBullet(s, 640, 600, "cyan"));
    const id = last(h.snapshot().bullets).id;
    const from = h.snapshot().bullets[0]?.y ?? 0;
    await h.advance(0.5);
    const now = h.snapshot().bullets.find((bullet) => bullet.id === id);
    expect(from - (now?.y ?? 0)).toBeCloseTo(PLAYER_BULLET_SPEED * 0.5, 0);
  });

  it("spaces held fire by the cadence and caps what is in flight", async () => {
    h.hold("Space");
    await h.advance(0.05);
    expect(playerBullets(h)).toHaveLength(1);
    await h.advance(FIRE_INTERVAL);
    expect(playerBullets(h)).toHaveLength(2);
    await h.advance(2);
    h.release("Space");
    expect(playerBullets(h).length).toBeLessThanOrEqual(MAX_PLAYER_BULLETS);
  });

  it("leaves the field at the top", async () => {
    h.pose((s, d) => d.addPlayerBullet(s, 640, FIELD_TOP + 20, "cyan"));
    await h.advance(0.2);
    expect(playerBullets(h)).toHaveLength(0);
  });

  it("carries the ship's band, fixed for the bullet's life", async () => {
    h.tap("Space");
    await h.frames(1);
    expect(playerBullets(h)[0]?.band).toBe("cyan");
    h.tap("KeyF");
    await h.frames(1);
    expect(playerBullets(h)[0]?.band).toBe("cyan");
    expect(h.snapshot().ship.band).toBe("magenta");
  });
});

describe("the flip and its lockout", () => {
  it("changes band in the frame the action is delivered", async () => {
    expect(h.snapshot().ship.band).toBe("cyan");
    h.tap("KeyF");
    await h.frames(1);
    expect(h.snapshot().ship.band).toBe("magenta");
  });

  it("acts once however long the key is held", async () => {
    h.hold("ShiftLeft");
    await h.advance(1);
    h.release("ShiftLeft");
    expect(h.snapshot().ship.band).toBe("magenta");
  });

  it("starts the fire lockout, which blocks firing until it elapses", async () => {
    h.tap("KeyF");
    await h.frames(1);
    expect(h.snapshot().ship.lockout).toBeGreaterThan(FLIP_LOCKOUT * 0.9);
    h.pose((s, d) => d.clearPlayerBullets(s));
    h.tap("Space");
    await h.frames(1);
    expect(playerBullets(h)).toHaveLength(0);

    h.pose((s, d) => d.setFireLockout(s, FLIP_LOCKOUT));
    await h.advance(FLIP_LOCKOUT);
    h.tap("Space");
    await h.frames(1);
    expect(playerBullets(h)).toHaveLength(1);
  });
});

describe("what a shot does", () => {
  it("destroys a drone of the matching band and spares the other", async () => {
    const id = poseDrone(h, "shard", 500, 300, { band: "cyan" });
    await fireAt(h, 500, 300, "magenta");
    expect(droneOf(h, id)).toBeDefined();
    expect(playerBullets(h)).toHaveLength(0);

    await fireAt(h, 500, 300, "cyan");
    expect(droneOf(h, id)).toBeUndefined();
  });

  it("fills the meter on a matching kill and on an absorbed bullet", async () => {
    poseDrone(h, "shard", 500, 300, { band: "cyan" });
    await fireAt(h, 500, 300, "cyan");
    expect(h.snapshot().resonance).toBe(RESONANCE_KILL);

    h.pose((s, d) => d.setResonance(s, 0));
    h.pose((s, d) => d.setShipContact(s, true));
    h.pose((s, d) => d.addEnemyBullet(s, LANE_CENTRE, 560, "cyan"));
    await h.advance(0.4);
    expect(h.snapshot().resonance).toBe(RESONANCE_ABSORB);
    expect(h.snapshot().lives).toBe(START_LIVES);
  });

  it("caps the meter and never decays it", async () => {
    h.pose((s, d) => d.setResonance(s, RESONANCE_MAX - 1));
    poseDrone(h, "shard", 500, 300, { band: "cyan" });
    await fireAt(h, 500, 300, "cyan");
    expect(h.snapshot().resonance).toBe(RESONANCE_MAX);

    h.pose((s, d) => d.setResonance(s, 50));
    await h.advance(10);
    expect(h.snapshot().resonance).toBe(50);
  });

  it("keeps the meter through a lost life", async () => {
    h.pose((s, d) => d.setResonance(s, 44));
    h.pose((s, d) => d.setShipContact(s, true));
    h.pose((s, d) => d.addEnemyBullet(s, LANE_CENTRE, 560, "magenta"));
    await h.advance(0.5);
    expect(h.snapshot().lives).toBe(START_LIVES - 1);
    expect(h.snapshot().resonance).toBe(44);
  });
});

describe("the shield and the hull", () => {
  it("absorbs a same-band bullet and takes a life from the other", async () => {
    h.pose((s, d) => d.setShipContact(s, true));
    h.pose((s, d) => d.addEnemyBullet(s, LANE_CENTRE, 560, "cyan"));
    await h.advance(0.4);
    expect(h.snapshot().lives).toBe(START_LIVES);
    expect(enemyBullets(h)).toHaveLength(0);

    h.pose((s, d) => d.addEnemyBullet(s, LANE_CENTRE, 560, "magenta"));
    await h.advance(0.4);
    expect(h.snapshot().lives).toBe(START_LIVES - 1);
  });

  it("takes a life from any drone body, of either band", async () => {
    for (const band of ["cyan", "magenta"] as const) {
      startPosed(h);
      h.pose((s, d) => d.setShipContact(s, true));
      poseDrone(h, "shard", LANE_CENTRE, SHIP_Y, { band });
      await h.advance(0.05);
      expect(h.snapshot().lives).toBe(START_LIVES - 1);
    }
  });
});

describe("the spectral inversion", () => {
  it("swaps every drone and every enemy bullet, and no player bullet", async () => {
    const id = poseDrone(h, "shard", 500, 300, { band: "cyan" });
    h.pose((s, d) => d.addEnemyBullet(s, 700, 200, "cyan"));
    h.pose((s, d) => d.addPlayerBullet(s, 800, 500, "cyan"));
    h.pose((s, d) => d.setInversion(s, INVERSION_TIME));
    const snap = h.snapshot();
    expect(droneOf(h, id)?.effectiveBand).toBe("magenta");
    expect(snap.bullets.find((b) => !b.friendly)?.effectiveBand).toBe(
      "magenta",
    );
    expect(snap.bullets.find((b) => b.friendly)?.effectiveBand).toBe("cyan");
    expect(snap.inversionActive).toBe(true);
  });

  it("changes what a shot destroys", async () => {
    const id = poseDrone(h, "shard", 500, 300, { band: "magenta" });
    h.pose((s, d) => d.setInversion(s, INVERSION_TIME));
    await fireAt(h, 500, 300, "magenta");
    expect(droneOf(h, id)).toBeDefined();
    await fireAt(h, 500, 300, "cyan");
    expect(droneOf(h, id)).toBeUndefined();
  });

  it("ends after its own time", async () => {
    const id = poseDrone(h, "shard", 500, 300, { band: "cyan" });
    h.pose((s, d) => d.setInversion(s, INVERSION_TIME));
    await h.advance(INVERSION_TIME + 0.1);
    expect(h.snapshot().inversionActive).toBe(false);
    expect(droneOf(h, id)?.effectiveBand).toBe("cyan");
  });

  it("cancels against a broken Prism shell", async () => {
    const id = poseDrone(h, "prism", 500, 300, {
      band: "cyan",
      shellAlive: false,
    });
    expect(droneOf(h, id)?.effectiveBand).toBe("magenta");
    h.pose((s, d) => d.setInversion(s, INVERSION_TIME));
    expect(droneOf(h, id)?.effectiveBand).toBe("cyan");
    await fireAt(h, 500, 300, "cyan");
    expect(droneOf(h, id)).toBeUndefined();
  });
});

describe("the discharge", () => {
  it("is ready exactly at a full meter and spends the whole of it", async () => {
    h.pose((s, d) => d.setResonance(s, RESONANCE_MAX - 1));
    expect(h.snapshot().dischargeReady).toBe(false);
    h.tap("KeyX");
    await h.frames(1);
    expect(h.snapshot().resonance).toBe(RESONANCE_MAX - 1);
    expect(h.snapshot().discharge.active).toBe(false);

    h.pose((s, d) => d.setResonance(s, RESONANCE_MAX));
    expect(h.snapshot().dischargeReady).toBe(true);
    h.tap("KeyX");
    await h.frames(1);
    expect(h.snapshot().resonance).toBe(0);
    expect(h.snapshot().discharge.active).toBe(true);
  });

  it("runs for its own span and then stops", async () => {
    h.pose((s, d) => d.setResonance(s, RESONANCE_MAX));
    h.tap("KeyX");
    await h.advance(DISCHARGE_TIME * 0.8);
    expect(h.snapshot().discharge.active).toBe(true);
    await h.advance(DISCHARGE_TIME * 0.4);
    expect(h.snapshot().discharge.active).toBe(false);
    expect(h.snapshot().discharge.radius).toBe(0);
  });

  it("takes every diver and spares the formation, band-blind", async () => {
    const diving = poseDrone(h, "shard", 300, 300, {
      phase: "diving",
      band: "magenta",
    });
    const entering = poseDrone(h, "shard", 900, 200, { phase: "entering" });
    const returning = poseDrone(h, "flux", 700, 400, { phase: "returning" });
    const resting = poseDrone(h, "shard", 500, 200, { phase: "formation" });
    h.pose((s, d) => d.addEnemyBullet(s, 640, 400, "cyan"));
    h.pose((s, d) => d.addPlayerBullet(s, 660, 600, "cyan"));
    h.pose((s, d) => d.setResonance(s, RESONANCE_MAX));
    h.tap("KeyX");
    await h.advance(DISCHARGE_TIME + 0.1);

    expect(droneOf(h, diving)).toBeUndefined();
    expect(droneOf(h, entering)).toBeUndefined();
    expect(droneOf(h, returning)).toBeUndefined();
    expect(droneOf(h, resting)).toBeDefined();
    expect(enemyBullets(h)).toHaveLength(0);
    expect(playerBullets(h)).toHaveLength(1);
  });

  it("takes a diving Prism whole rather than its shell alone", async () => {
    const id = poseDrone(h, "prism", 500, 400, { phase: "diving" });
    h.pose((s, d) => d.setResonance(s, RESONANCE_MAX));
    h.tap("KeyX");
    await h.advance(DISCHARGE_TIME + 0.1);
    expect(droneOf(h, id)).toBeUndefined();
  });
});
