// Spectra — the simulation, driven through the real frame.
//
// Every test here runs the game the way a player does: a posed field, real key
// input or the real elapsed-time path, and a read of what the rules left. Nothing
// below reaches into a private field to make an outcome happen.

import { describe, expect, it } from "vitest";
import {
  CHALLENGE_GROUPS,
  CHALLENGE_TOTAL,
  DIVE_FIRE_Y,
  DIVE_GAP_MAX,
  DIVE_GAP_MIN,
  DIVE_SPEED,
  ENEMY_BULLET_SPEED,
  ENTER_GROUP_GAP,
  ENTER_SPEED,
  EXTRA_LIFE_AT,
  FIELD_BOTTOM,
  FIELD_TOP,
  FIRE_INTERVAL,
  FLIP_LOCKOUT,
  INVERSION_TIME,
  MAX_PLAYER_BULLETS,
  OVERLOAD_AT,
  OVERLOAD_DIVE_SCALE,
  OVERLOAD_FLUX_SPREAD,
  OVERLOAD_FLUX_SPREAD_ANGLE,
  PLAYER_BULLET_SPEED,
  PRISM_INVERT_Y,
  READY_HOLD,
  RESONANCE_ABSORB,
  RESONANCE_KILL,
  RESONANCE_MAX,
  SCORE_FLUX_FORM,
  SCORE_PRISM_CORE,
  SCORE_PRISM_SHELL,
  SCORE_SHARD_DIVE,
  SCORE_SHARD_FORM,
  SCORE_STAGE_CLEAR,
  SHIP_SPEED,
  SHIP_X_MAX,
  SHIP_X_MIN,
  SHIP_Y,
  STAGE_CLEARED_HOLD,
  STAGE_INTRO_HOLD,
  START_LIVES,
  TITLE_ITEMS,
  fluxCycle,
  fluxHold,
  fluxWindow,
} from "./constants";
import { DIVE_TURN_Y } from "./swarm";
import { NOSE_Y } from "./ship";
import { driver, poseDrone, startPosed } from "./harness.test-support";

/** The one drone on a posed field. */
function only(driven: ReturnType<typeof driver>) {
  const drones = driven.debug.snapshot().drones;
  expect(drones).toHaveLength(1);
  return drones[0] as NonNullable<(typeof drones)[number]>;
}

describe("the frame", () => {
  it("reaches the identical state however a second is divided", () => {
    // Nothing on this field is drawn at random: a Flux runs its clock, and two
    // bullets fly clear of everything.
    const shapes = [1, 60, 120].map((frames) => {
      const driven = driver();
      startPosed(driven);
      const id = poseDrone(driven, "flux", 400, 200);
      driven.debug.setDroneBandClock(id, 1.5);
      driven.debug.setDroneOscillation(id, true);
      driven.debug.addPlayerBullet(900, 500, "cyan");
      driven.debug.addEnemyBullet(300, 100, "magenta");
      driven.advance(1, frames);
      return JSON.stringify(driven.debug.snapshot());
    });
    expect(shapes[1]).toBe(shapes[0]);
    expect(shapes[2]).toBe(shapes[0]);
  });

  it("accumulates simulation time whatever the screen", () => {
    const driven = driver();
    driven.advance(1, 60);
    expect(driven.state.screen).toBe("title");
    expect(driven.debug.snapshot().simTime).toBeCloseTo(1, 6);
  });
});

describe("the ship", () => {
  it("travels its speed while a direction is held, and stops on release", () => {
    const driven = driver();
    startPosed(driven);
    driven.hold("right", true);
    driven.advance(1, 60);
    expect(driven.debug.snapshot().ship.x).toBeCloseTo(640 + SHIP_SPEED, 1);
    driven.hold("right", false);
    const parked = driven.debug.snapshot().ship.x;
    driven.advance(0.1, 6);
    expect(driven.debug.snapshot().ship.x).toBeCloseTo(parked, 6);
  });

  it("clamps to its lane at both ends", () => {
    const driven = driver();
    startPosed(driven);
    driven.debug.setShipX(SHIP_X_MIN + 120);
    driven.hold("left", true);
    driven.advance(2, 120);
    expect(driven.debug.snapshot().ship.x).toBeCloseTo(SHIP_X_MIN, 6);
    driven.hold("left", false);
    driven.debug.setShipX(SHIP_X_MAX - 120);
    driven.hold("right", true);
    driven.advance(2, 120);
    expect(driven.debug.snapshot().ship.x).toBeCloseTo(SHIP_X_MAX, 6);
  });

  it("stands still while both directions are held", () => {
    const driven = driver();
    startPosed(driven);
    driven.hold("left", true);
    driven.hold("right", true);
    driven.advance(1, 60);
    expect(driven.debug.snapshot().ship.x).toBeCloseTo(640, 6);
  });

  it("puts one bullet at the nose on one press of fire", () => {
    const driven = driver();
    startPosed(driven);
    driven.hold("a", true);
    driven.frame(1 / 60);
    const bullets = driven.debug.snapshot().bullets;
    expect(bullets).toHaveLength(1);
    const shot = bullets[0] as NonNullable<(typeof bullets)[number]>;
    expect(shot.friendly).toBe(true);
    expect(shot.band).toBe("cyan");
    expect(Math.abs(shot.x - 640)).toBeLessThanOrEqual(4);
    expect(shot.y).toBeLessThan(SHIP_Y);
    // The shot leaves in the frame's first sub-step and then travels with the
    // rest of the frame, which at 1/60 is two sub-steps of a hundred-and-twentieth.
    expect(shot.y).toBeCloseTo(NOSE_Y - PLAYER_BULLET_SPEED / 60, 1);
  });

  it("caps the player's bullets and spaces held fire by the cadence", () => {
    const driven = driver();
    startPosed(driven);
    driven.hold("a", true);
    driven.advance(2, 120);
    expect(
      driven.debug.snapshot().bullets.filter((bullet) => bullet.friendly)
        .length,
    ).toBeLessThanOrEqual(MAX_PLAYER_BULLETS);
    // Fire held for a second, with the field cleared each time a shot leaves, gives
    // one shot every FIRE_INTERVAL.
    const counted = driver();
    startPosed(counted);
    counted.hold("a", true);
    let shots = 0;
    for (let index = 0; index < 120; index += 1) {
      counted.frame(1 / 120);
      shots += counted.debug.snapshot().bullets.length;
      counted.debug.clearPlayerBullets();
    }
    expect(shots).toBeCloseTo(1 / FIRE_INTERVAL, 0);
  });

  it("blocks fire while the lockout stands and allows it once it elapses", () => {
    const driven = driver();
    startPosed(driven);
    driven.debug.setFireLockout(FLIP_LOCKOUT);
    driven.hold("a", true);
    driven.frame(1 / 60);
    expect(driven.debug.snapshot().bullets).toHaveLength(0);
    driven.advance(FLIP_LOCKOUT, 30);
    driven.frame(1 / 60);
    expect(driven.debug.snapshot().bullets.length).toBeGreaterThan(0);
  });

  it("climbs a player bullet at its speed", () => {
    const driven = driver();
    startPosed(driven);
    driven.debug.addPlayerBullet(640, 600, "cyan");
    const before = (driven.debug.snapshot().bullets[0] as { y: number }).y;
    driven.advance(0.5, 30);
    const after = (driven.debug.snapshot().bullets[0] as { y: number }).y;
    expect(before - after).toBeCloseTo(PLAYER_BULLET_SPEED * 0.5, 3);
  });

  it("flips instantly, starts the lockout, and leaves a bullet's band alone", () => {
    const driven = driver();
    startPosed(driven);
    driven.debug.addPlayerBullet(640, 500, "cyan");
    driven.press("b");
    driven.frame(1 / 60);
    const shape = driven.debug.snapshot();
    expect(shape.ship.band).toBe("magenta");
    // The flip lands in the first sub-step, so one sub-step of the frame's two has
    // counted the lockout down by the time the frame ends.
    expect(shape.ship.lockout).toBeCloseTo(FLIP_LOCKOUT - 1 / 120, 4);
    expect((shape.bullets[0] as { band: string }).band).toBe("cyan");
  });

  it("acts on a held flip exactly once", () => {
    const driven = driver();
    startPosed(driven);
    driven.hold("b", true);
    driven.press("b");
    driven.advance(1, 60);
    expect(driven.debug.snapshot().ship.band).toBe("magenta");
  });
});

describe("the two bands", () => {
  it("destroys a drone whose effective band the shot matches", () => {
    const driven = driver();
    startPosed(driven);
    poseDrone(driven, "shard", 640, 300);
    driven.debug.addPlayerBullet(640, 320, "cyan");
    driven.advance(0.1, 6);
    expect(driven.debug.snapshot().drones).toHaveLength(0);
  });

  it("spares the drone and consumes the bullet on a mismatch", () => {
    const driven = driver();
    startPosed(driven);
    poseDrone(driven, "shard", 640, 300);
    driven.debug.addPlayerBullet(640, 320, "magenta");
    driven.advance(0.1, 6);
    const shape = driven.debug.snapshot();
    expect(shape.drones).toHaveLength(1);
    expect(shape.bullets).toHaveLength(0);
  });

  it("absorbs a same-band enemy bullet and fills the meter", () => {
    const driven = driver();
    startPosed(driven);
    driven.debug.setShipContact(true);
    driven.debug.addEnemyBullet(640, SHIP_Y - 20, "cyan");
    driven.advance(0.2, 12);
    const shape = driven.debug.snapshot();
    expect(shape.lives).toBe(START_LIVES);
    expect(shape.bullets).toHaveLength(0);
    expect(shape.resonance).toBe(RESONANCE_ABSORB);
  });

  it("costs exactly one life for an opposite-band enemy bullet", () => {
    const driven = driver();
    startPosed(driven);
    driven.debug.setShipContact(true);
    driven.debug.addEnemyBullet(640, SHIP_Y - 20, "magenta");
    driven.advance(0.2, 12);
    const shape = driven.debug.snapshot();
    expect(shape.lives).toBe(START_LIVES - 1);
    expect(shape.phase).toBe("ready");
  });

  it("costs a life for a drone body of either band", () => {
    for (const band of ["cyan", "magenta"] as const) {
      const driven = driver();
      startPosed(driven);
      driven.debug.setShipContact(true);
      const id = poseDrone(driven, "shard", 640, SHIP_Y);
      driven.debug.setDroneBand(id, band);
      driven.frame(1 / 60);
      expect(driven.debug.snapshot().lives).toBe(START_LIVES - 1);
    }
  });

  it("swaps a drone and an enemy bullet under an inversion, but not the player's", () => {
    const driven = driver();
    startPosed(driven);
    poseDrone(driven, "shard", 400, 200);
    driven.debug.addEnemyBullet(500, 200, "cyan");
    driven.debug.addPlayerBullet(300, 500, "cyan");
    driven.debug.setInversion(INVERSION_TIME);
    const shape = driven.debug.snapshot();
    expect((shape.drones[0] as { effectiveBand: string }).effectiveBand).toBe(
      "magenta",
    );
    const enemy = shape.bullets.find((bullet) => !bullet.friendly);
    const friendly = shape.bullets.find((bullet) => bullet.friendly);
    expect(enemy?.effectiveBand).toBe("magenta");
    expect(friendly?.effectiveBand).toBe("cyan");
    expect(shape.inversionActive).toBe(true);
  });

  it("ends an inversion after its time", () => {
    const driven = driver();
    startPosed(driven);
    driven.debug.setInversion(INVERSION_TIME);
    driven.advance(INVERSION_TIME, 120);
    const shape = driven.debug.snapshot();
    expect(shape.inversion).toBe(0);
    expect(shape.inversionActive).toBe(false);
  });

  it("cancels two swaps: a broken cyan Prism under an inversion reads cyan", () => {
    const driven = driver();
    startPosed(driven);
    const id = poseDrone(driven, "prism", 640, 300);
    driven.debug.setDroneShell(id, false);
    driven.debug.setInversion(INVERSION_TIME);
    expect(only(driven).effectiveBand).toBe("cyan");
    driven.debug.addPlayerBullet(640, 320, "cyan");
    driven.advance(0.1, 6);
    expect(driven.debug.snapshot().drones).toHaveLength(0);
  });
});

describe("resonance and the discharge", () => {
  it("fills on a matching kill and caps at the ceiling", () => {
    const driven = driver();
    startPosed(driven);
    poseDrone(driven, "shard", 640, 300);
    driven.debug.addPlayerBullet(640, 320, "cyan");
    driven.advance(0.1, 6);
    expect(driven.debug.snapshot().resonance).toBe(RESONANCE_KILL);

    driven.debug.setResonance(RESONANCE_MAX - 1);
    poseDrone(driven, "shard", 400, 300);
    driven.debug.addPlayerBullet(400, 320, "cyan");
    driven.advance(0.1, 6);
    expect(driven.debug.snapshot().resonance).toBe(RESONANCE_MAX);
  });

  it("adds nothing for a shell and fills for a core", () => {
    const driven = driver();
    startPosed(driven);
    const id = poseDrone(driven, "prism", 640, 300);
    driven.debug.addPlayerBullet(640, 320, "cyan");
    driven.advance(0.1, 6);
    let shape = driven.debug.snapshot();
    expect(shape.resonance).toBe(0);
    expect((shape.drones[0] as { shellAlive: boolean }).shellAlive).toBe(false);
    expect((shape.drones[0] as { id: number }).id).toBe(id);
    expect(shape.score).toBe(SCORE_PRISM_SHELL);

    driven.debug.addPlayerBullet(640, 320, "magenta");
    driven.advance(0.1, 6);
    shape = driven.debug.snapshot();
    expect(shape.drones).toHaveLength(0);
    expect(shape.resonance).toBe(RESONANCE_KILL);
    expect(shape.score).toBe(SCORE_PRISM_SHELL + SCORE_PRISM_CORE);
  });

  it("spends the whole meter, and spends nothing one point short", () => {
    const driven = driver();
    startPosed(driven);
    driven.debug.setResonance(RESONANCE_MAX - 1);
    driven.press("discharge");
    driven.frame(1 / 60);
    let shape = driven.debug.snapshot();
    expect(shape.resonance).toBe(RESONANCE_MAX - 1);
    expect(shape.discharge.active).toBe(false);

    driven.debug.setResonance(RESONANCE_MAX);
    driven.press("discharge");
    driven.frame(1 / 60);
    shape = driven.debug.snapshot();
    expect(shape.resonance).toBe(0);
    expect(shape.discharge.active).toBe(true);
  });

  it("takes every diver and every enemy bullet, and spares the formation", () => {
    const driven = driver();
    startPosed(driven);
    const diver = poseDrone(driven, "shard", 300, 300);
    driven.debug.setDronePhase(diver, "diving");
    const resting = poseDrone(driven, "shard", 900, 200);
    driven.debug.setDronePhase(resting, "formation");
    const prism = poseDrone(driven, "prism", 500, 250);
    driven.debug.setDronePhase(prism, "diving");
    driven.debug.addEnemyBullet(700, 400, "magenta");
    driven.debug.addPlayerBullet(200, 500, "cyan");
    driven.debug.setResonance(RESONANCE_MAX);
    driven.press("discharge");
    driven.advance(0.6, 36);
    const shape = driven.debug.snapshot();
    expect(shape.drones.map((drone) => drone.id)).toEqual([resting]);
    expect(shape.bullets.every((bullet) => bullet.friendly)).toBe(true);
    expect(shape.discharge.active).toBe(false);
    expect(shape.score).toBe(
      SCORE_SHARD_DIVE + SCORE_PRISM_SHELL + SCORE_PRISM_CORE,
    );
  });

  it("runs the wave for its stated span", () => {
    const driven = driver();
    startPosed(driven);
    driven.debug.setResonance(RESONANCE_MAX);
    driven.press("discharge");
    driven.advance(0.45, 27);
    expect(driven.debug.snapshot().discharge.active).toBe(true);
    driven.advance(0.1, 6);
    expect(driven.debug.snapshot().discharge.active).toBe(false);
  });
});

describe("the swarm", () => {
  it("opens a wave with an empty field and flies its drones in", () => {
    const driven = driver();
    startPosed(driven);
    driven.debug.setWaveEntry(true);
    driven.debug.setScreen("stageIntro");
    driven.debug.setPhaseTimer(0);
    driven.frame(1 / 60);
    let shape = driven.debug.snapshot();
    expect(shape.screen).toBe("inWave");
    expect(shape.drones.length).toBeGreaterThan(0);
    expect(shape.drones.every((drone) => drone.y < FIELD_TOP)).toBe(true);

    driven.advance(2, 120);
    shape = driven.debug.snapshot();
    const inField = shape.drones.filter(
      (drone) => drone.y >= FIELD_TOP && drone.y <= FIELD_BOTTOM,
    );
    expect(inField.length).toBeGreaterThan(0);
  });

  it("assembles the whole wave into its slots", () => {
    const driven = driver();
    startPosed(driven);
    driven.debug.setWaveEntry(true);
    driven.debug.setScreen("stageIntro");
    driven.debug.setPhaseTimer(0);
    driven.advance(12, 720);
    const shape = driven.debug.snapshot();
    expect(shape.drones.length).toBeGreaterThan(0);
    expect(shape.drones.every((drone) => drone.phase === "formation")).toBe(
      true,
    );
    for (const drone of shape.drones) {
      expect(Math.abs(drone.y - drone.slotY)).toBeLessThan(1);
      expect(Math.abs(drone.x - drone.slotX)).toBeLessThanOrEqual(21);
    }
  });

  it("releases its groups ENTER_GROUP_GAP apart", () => {
    const driven = driver();
    startPosed(driven);
    driven.debug.setWaveEntry(true);
    driven.debug.setScreen("stageIntro");
    driven.debug.setPhaseTimer(0);
    driven.frame(1 / 120);
    const startedAt = new Map<number, number>();
    const home = new Map<number, number>();
    for (const drone of driven.debug.snapshot().drones)
      home.set(drone.id, drone.x);
    for (let step = 0; step < 480; step += 1) {
      driven.frame(1 / 120);
      for (const drone of driven.debug.snapshot().drones) {
        const at = home.get(drone.id);
        if (at === undefined || startedAt.has(drone.id)) continue;
        if (Math.abs(drone.x - at) > 1) startedAt.set(drone.id, step / 120);
      }
    }
    const times = [...new Set([...startedAt.values()].map((t) => t.toFixed(1)))]
      .map(Number)
      .sort((a, b) => a - b);
    expect(times.length).toBeGreaterThanOrEqual(2);
    for (let index = 1; index < times.length; index += 1) {
      const gap = (times[index] as number) - (times[index - 1] as number);
      expect(gap).toBeGreaterThan(ENTER_GROUP_GAP * 0.8);
      expect(gap).toBeLessThan(ENTER_GROUP_GAP * 1.2);
    }
  });

  it("flies an entrance at ENTER_SPEED and never jumps", () => {
    const driven = driver();
    startPosed(driven);
    driven.debug.setWaveEntry(true);
    driven.debug.setScreen("stageIntro");
    driven.debug.setPhaseTimer(0);
    driven.frame(1 / 120);
    const first = (driven.debug.snapshot().drones[0] as { id: number }).id;
    const at = (): { x: number; y: number } => {
      const found = driven.debug
        .snapshot()
        .drones.find((drone) => drone.id === first);
      return { x: found?.x ?? 0, y: found?.y ?? 0 };
    };
    let previous = at();
    let travelled = 0;
    let biggest = 0;
    for (let step = 0; step < 120; step += 1) {
      driven.frame(1 / 120);
      const now = at();
      const moved = Math.hypot(now.x - previous.x, now.y - previous.y);
      travelled += moved;
      biggest = Math.max(biggest, moved);
      previous = now;
    }
    expect(travelled).toBeGreaterThan(ENTER_SPEED * 0.9);
    expect(travelled).toBeLessThan(ENTER_SPEED * 1.1);
    expect(biggest).toBeLessThan((ENTER_SPEED / 120) * 1.3);
  });

  it("holds a slotted drone on its slot plus the sway", () => {
    const driven = driver();
    startPosed(driven);
    const id = poseDrone(driven, "shard", 400, 200);
    driven.debug.setDroneSlot(id, 400, 200);
    driven.debug.setDroneTravel(id, true);
    let lowest = Number.POSITIVE_INFINITY;
    let highest = Number.NEGATIVE_INFINITY;
    for (let step = 0; step < 600; step += 1) {
      driven.frame(1 / 120);
      const drone = only(driven);
      expect(drone.y).toBeCloseTo(200, 6);
      lowest = Math.min(lowest, drone.x - 400);
      highest = Math.max(highest, drone.x - 400);
    }
    expect(highest).toBeCloseTo(20, 0);
    expect(lowest).toBeCloseTo(-20, 0);
  });

  it("launches its first dive after the stated delay, then keeps its cadence", () => {
    const driven = driver();
    startPosed(driven);
    for (let column = 0; column < 5; column += 1) {
      const id = poseDrone(driven, "shard", 400 + column * 64, 200);
      driven.debug.setDroneSlot(id, 400 + column * 64, 200);
    }
    driven.debug.setDiveClock(0);
    driven.debug.setDiveLaunching(true);
    const launches: number[] = [];
    let diving = 0;
    for (let step = 0; step < 1200; step += 1) {
      driven.frame(1 / 120);
      const now = driven.debug
        .snapshot()
        .drones.filter((drone) => drone.phase === "diving").length;
      if (now > diving) launches.push(step / 120);
      diving = now;
    }
    expect(launches[0]).toBeGreaterThan(2 * 0.8);
    expect(launches[0]).toBeLessThan(2 * 1.2);
    for (let index = 1; index < launches.length; index += 1) {
      const gap = (launches[index] as number) - (launches[index - 1] as number);
      expect(gap).toBeGreaterThan(DIVE_GAP_MIN * 0.8);
      expect(gap).toBeLessThan(DIVE_GAP_MAX * 1.2);
    }
  });

  it("flies a dive at DIVE_SPEED, continuously, and never into the bottom strip", () => {
    const driven = driver();
    startPosed(driven);
    const id = poseDrone(driven, "shard", 400, 200);
    driven.debug.setDroneSlot(id, 400, 200);
    driven.debug.setDronePhase(id, "diving");
    driven.debug.setDroneTravel(id, true);
    let previous = { x: 400, y: 200 };
    let travelled = 0;
    let biggest = 0;
    let deepest = 0;
    for (let step = 0; step < 120; step += 1) {
      driven.frame(1 / 120);
      const drone = only(driven);
      const moved = Math.hypot(drone.x - previous.x, drone.y - previous.y);
      travelled += moved;
      biggest = Math.max(biggest, moved);
      deepest = Math.max(deepest, drone.y);
      previous = { x: drone.x, y: drone.y };
    }
    expect(travelled).toBeGreaterThan(DIVE_SPEED * 0.9);
    expect(travelled).toBeLessThan(DIVE_SPEED * 1.1);
    expect(biggest).toBeLessThan((DIVE_SPEED / 120) * 1.3);
    expect(deepest).toBeLessThan(FIELD_BOTTOM);
  });

  it("bends a dive toward the ship, wherever the ship stands", () => {
    for (const shipX of [SHIP_X_MIN, SHIP_X_MAX]) {
      const driven = driver();
      startPosed(driven);
      driven.debug.setShipX(shipX);
      const id = poseDrone(driven, "shard", 640, 200);
      driven.debug.setDroneSlot(id, 640, 200);
      driven.debug.setDronePhase(id, "diving");
      driven.debug.setDroneTravel(id, true);
      const gap = Math.abs(640 - shipX);
      let closest = gap;
      for (let step = 0; step < 480; step += 1) {
        driven.frame(1 / 120);
        const drone = driven.debug.snapshot().drones[0];
        if (drone === undefined) break;
        closest = Math.min(closest, Math.abs(drone.x - shipX));
      }
      expect(closest).toBeLessThan(gap * (2 / 3));
    }
  });

  it("comes home to its slot after a dive", () => {
    const driven = driver();
    startPosed(driven);
    const id = poseDrone(driven, "shard", 400, 200);
    driven.debug.setDroneSlot(id, 400, 200);
    driven.debug.setDronePhase(id, "diving");
    driven.debug.setDroneTravel(id, true);
    driven.advance(14, 1680);
    const drone = only(driven);
    expect(drone.phase).toBe("formation");
    expect(Math.abs(drone.y - 200)).toBeLessThan(1);
  });

  it("fires only from a dive, on the frame it crosses the fire line", () => {
    const driven = driver();
    startPosed(driven);
    const resting = poseDrone(driven, "shard", 900, 200);
    driven.debug.setDroneTravel(resting, true);
    driven.debug.setDroneFire(resting, true);
    driven.advance(10, 600);
    expect(
      driven.debug.snapshot().bullets.filter((bullet) => !bullet.friendly),
    ).toHaveLength(0);

    const diving = driver();
    startPosed(diving);
    const id = poseDrone(diving, "shard", 400, DIVE_FIRE_Y - 30);
    diving.debug.setDroneSlot(id, 400, 200);
    diving.debug.setDronePhase(id, "diving");
    diving.debug.setDroneTravel(id, true);
    diving.debug.setDroneFire(id, true);
    let firedAbove = 0;
    for (let step = 0; step < 240; step += 1) {
      diving.frame(1 / 120);
      const shape = diving.debug.snapshot();
      const enemies = shape.bullets.filter((bullet) => !bullet.friendly);
      if (enemies.length > 0) {
        firedAbove = (enemies[0] as { y: number }).y;
        break;
      }
    }
    expect(firedAbove).toBeGreaterThan(DIVE_FIRE_Y - 10);
    expect(firedAbove).toBeLessThan(DIVE_FIRE_Y + 20);
  });

  it("falls an enemy bullet at its stated speed", () => {
    const driven = driver();
    startPosed(driven);
    driven.debug.addEnemyBullet(640, 200, "magenta");
    const before = (driven.debug.snapshot().bullets[0] as { y: number }).y;
    driven.advance(0.5, 60);
    const after = (driven.debug.snapshot().bullets[0] as { y: number }).y;
    expect(after - before).toBeCloseTo(ENEMY_BULLET_SPEED * 0.5, 3);
  });
});

describe("the wave a stage builds", () => {
  it("keeps a Prism's two escorts alongside it, in motion, through the entrance", () => {
    const driven = driver();
    startPosed(driven);
    driven.debug.setWaveEntry(true);
    driven.debug.setScreen("stageIntro");
    driven.debug.setPhaseTimer(0);
    driven.frame(1 / 120);
    const prism = driven.debug
      .snapshot()
      .drones.find((drone) => drone.kind === "prism");
    expect(prism).toBeDefined();
    const previous = new Map<number, { x: number; y: number }>();
    for (const drone of driven.debug.snapshot().drones) {
      previous.set(drone.id, { x: drone.x, y: drone.y });
    }
    let escorted = false;
    for (let step = 0; step < 1200 && !escorted; step += 1) {
      driven.frame(1 / 120);
      const shape = driven.debug.snapshot();
      const anchor = shape.drones.find((drone) => drone.id === prism?.id);
      if (anchor === undefined) break;
      const moving = (id: number, x: number, y: number): boolean => {
        const was = previous.get(id);
        return was !== undefined && Math.hypot(x - was.x, y - was.y) > 1e-6;
      };
      const beside = shape.drones.filter(
        (drone) =>
          drone.kind === "shard" &&
          Math.hypot(drone.x - anchor.x, drone.y - anchor.y) <= 320 &&
          moving(drone.id, drone.x, drone.y),
      );
      escorted =
        moving(anchor.id, anchor.x, anchor.y) &&
        beside.some((drone) => drone.band === "cyan") &&
        beside.some((drone) => drone.band === "magenta");
      for (const drone of shape.drones) {
        previous.set(drone.id, { x: drone.x, y: drone.y });
      }
    }
    expect(escorted).toBe(true);
  });

  it("arrives a challenge stage in single-band groups that alternate", () => {
    const driven = driver();
    startPosed(driven);
    driven.debug.setStage(3);
    driven.debug.setWaveEntry(true);
    driven.debug.setScreen("stageIntro");
    driven.debug.setPhaseTimer(0);
    driven.frame(1 / 120);
    // Read each drone's band at the moment it is first inside the field on BOTH
    // axes, which is what a player sees arrive.
    const arrivals: { at: number; band: string }[] = [];
    const seen = new Set<number>();
    for (let step = 0; step < 3600; step += 1) {
      driven.frame(1 / 120);
      for (const drone of driven.debug.snapshot().drones) {
        if (seen.has(drone.id)) continue;
        if (drone.x < 0 || drone.x > 1280) continue;
        if (drone.y < FIELD_TOP || drone.y > FIELD_BOTTOM) continue;
        seen.add(drone.id);
        arrivals.push({ at: step / 120, band: drone.band });
      }
      if (seen.size >= CHALLENGE_TOTAL) break;
    }
    expect(arrivals).toHaveLength(CHALLENGE_TOTAL);
    // Merge adjacent same-band arrivals into waves, then compare.
    const waves: string[] = [];
    for (const arrival of arrivals) {
      if (waves[waves.length - 1] !== arrival.band) waves.push(arrival.band);
    }
    expect(waves).toHaveLength(CHALLENGE_GROUPS);
    for (let index = 1; index < waves.length; index += 1) {
      expect(waves[index]).not.toBe(waves[index - 1]);
    }
  });
});

describe("a challenge group's flyover", () => {
  it("leaves the field within eight seconds of its group's release", () => {
    const driven = driver();
    startPosed(driven);
    driven.debug.setStage(3);
    driven.debug.setWaveEntry(true);
    driven.debug.setScreen("stageIntro");
    driven.debug.setPhaseTimer(0);
    driven.frame(1 / 120);
    const group = new Map<number, number>();
    for (const drone of driven.state.drones) group.set(drone.id, drone.group);
    const alive = new Set(group.keys());
    let worst = 0;
    for (let step = 0; step < 2400 && alive.size > 0; step += 1) {
      driven.frame(1 / 120);
      const now = new Set(
        driven.debug.snapshot().drones.map((drone) => drone.id),
      );
      for (const id of [...alive]) {
        if (now.has(id)) continue;
        alive.delete(id);
        const released = (group.get(id) as number) * ENTER_GROUP_GAP;
        worst = Math.max(worst, step / 120 - released);
      }
    }
    expect(alive.size).toBe(0);
    expect(worst).toBeLessThan(8);
  });
});

describe("the three drones", () => {
  it("holds a Shard's band across a whole Flux cycle", () => {
    const driven = driver();
    startPosed(driven);
    const id = poseDrone(driven, "shard", 400, 200);
    driven.debug.setDroneOscillation(id, true);
    driven.advance(fluxCycle(1), 240);
    expect(only(driven).band).toBe("cyan");
  });

  it("holds a Flux's band for its hold, shimmers, then emerges opposite", () => {
    const driven = driver();
    startPosed(driven);
    const id = poseDrone(driven, "flux", 400, 200);
    driven.debug.setDroneOscillation(id, true);
    const hold = fluxHold(1);
    driven.advance(hold * 0.9, Math.round(hold * 0.9 * 120));
    let drone = only(driven);
    expect(drone.shimmer).toBe(false);
    expect(drone.band).toBe("cyan");

    driven.advance(hold * 0.2, 24);
    drone = only(driven);
    expect(drone.shimmer).toBe(true);
    expect(drone.effectiveBand).toBe("magenta");

    driven.advance(fluxWindow(1) - hold * 1.1 + 0.02, 60);
    drone = only(driven);
    expect(drone.shimmer).toBe(false);
    expect(drone.band).toBe("magenta");
    expect(drone.id).toBe(id);
  });

  it("destroys no shimmering Flux, of either band", () => {
    for (const band of ["cyan", "magenta"] as const) {
      const driven = driver();
      startPosed(driven);
      const id = poseDrone(driven, "flux", 640, 300);
      driven.debug.setDroneBandClock(id, fluxHold(1) + 0.1);
      expect(only(driven).shimmer).toBe(true);
      driven.debug.addPlayerBullet(640, 320, band);
      driven.advance(0.1, 6);
      expect(driven.debug.snapshot().drones).toHaveLength(1);
    }
  });

  it("holds a Prism's shell against the core's band and its core against the shell's", () => {
    const driven = driver();
    startPosed(driven);
    const id = poseDrone(driven, "prism", 640, 300);
    driven.debug.addPlayerBullet(640, 320, "magenta");
    driven.advance(0.1, 6);
    expect(only(driven).shellAlive).toBe(true);

    driven.debug.setDroneShell(id, false);
    driven.debug.addPlayerBullet(640, 320, "cyan");
    driven.advance(0.1, 6);
    expect(driven.debug.snapshot().drones).toHaveLength(1);
    driven.debug.addPlayerBullet(640, 320, "magenta");
    driven.advance(0.1, 6);
    expect(driven.debug.snapshot().drones).toHaveLength(0);
  });

  it("inverts the field when a diving Prism reaches the bottom, and survives", () => {
    const driven = driver();
    startPosed(driven);
    const id = poseDrone(driven, "prism", 640, PRISM_INVERT_Y - 40);
    driven.debug.setDroneSlot(id, 640, 200);
    driven.debug.setDronePhase(id, "diving");
    driven.debug.setDroneTravel(id, true);
    let inverted = false;
    for (let step = 0; step < 240 && !inverted; step += 1) {
      driven.frame(1 / 120);
      inverted = driven.debug.snapshot().inversionActive;
    }
    expect(inverted).toBe(true);
    const shape = driven.debug.snapshot();
    expect(shape.inversion).toBeCloseTo(INVERSION_TIME, 1);
    expect(shape.drones).toHaveLength(1);
    expect((shape.drones[0] as { phase: string }).phase).toBe("returning");
  });

  it("fires two bands from a diving Prism and one from a Shard", () => {
    const driven = driver();
    startPosed(driven);
    const prism = poseDrone(driven, "prism", 300, DIVE_FIRE_Y - 40);
    driven.debug.setDroneSlot(prism, 300, 200);
    driven.debug.setDronePhase(prism, "diving");
    driven.debug.setDroneTravel(prism, true);
    driven.debug.setDroneFire(prism, true);
    // Collected as they appear: an enemy bullet leaves the roster once it falls past
    // the bottom of the field, so a long advance would find nothing.
    let bands: string[] = [];
    for (let step = 0; step < 240 && bands.length === 0; step += 1) {
      driven.frame(1 / 120);
      bands = driven.debug
        .snapshot()
        .bullets.filter((bullet) => !bullet.friendly)
        .map((bullet) => bullet.band)
        .sort();
    }
    expect(bands).toEqual(["cyan", "magenta"]);
  });

  it("keeps the dive silent while a Flux shimmers", () => {
    const driven = driver();
    startPosed(driven);
    const id = poseDrone(driven, "flux", 400, DIVE_FIRE_Y - 20);
    driven.debug.setDroneSlot(id, 400, 200);
    driven.debug.setDronePhase(id, "diving");
    driven.debug.setDroneBandClock(id, fluxHold(1) + 0.05);
    driven.debug.setDroneTravel(id, true);
    driven.debug.setDroneFire(id, true);
    // Held still in the shimmer: the oscillation is off, so no shot ever leaves.
    driven.advance(1, 120);
    const shape = driven.debug.snapshot();
    expect((shape.drones[0] as { shimmer: boolean }).shimmer).toBe(true);
    expect(shape.bullets.filter((bullet) => !bullet.friendly)).toHaveLength(0);
  });
});

describe("stages", () => {
  it("clears when the last drone of the game's own wave dies", () => {
    const driven = driver();
    startPosed(driven);
    driven.debug.setWaveEntry(true);
    driven.debug.setScreen("stageIntro");
    driven.debug.setPhaseTimer(0);
    driven.frame(1 / 120);
    const built = driven.debug.snapshot().drones.length;
    expect(built).toBeGreaterThan(1);
    // Rake the wave to its last drone, then shoot that one.
    const ids = driven.debug.snapshot().drones.map((drone) => drone.id);
    for (const id of ids.slice(0, -1)) driven.debug.removeDrone(id);
    expect(driven.debug.snapshot().screen).toBe("inWave");
    const last = driven.debug.snapshot().drones[0] as { id: number; x: number };
    driven.debug.setDronePosition(last.id, 640, 300);
    driven.debug.setDroneTravel(last.id, false);
    driven.debug.setDroneBand(last.id, "cyan");
    driven.debug.setDroneShell(last.id, false);
    driven.debug.addPlayerBullet(640, 320, "cyan");
    driven.advance(0.1, 6);
    const shape = driven.debug.snapshot();
    expect(shape.drones).toHaveLength(0);
    expect(shape.screen).toBe("stageCleared");
  });

  it("leaves an empty wave playing rather than cleared", () => {
    const driven = driver();
    startPosed(driven);
    driven.advance(10, 600);
    expect(driven.debug.snapshot().screen).toBe("inWave");
  });

  it("advances the stage once the interstitial has given way", () => {
    const driven = driver();
    startPosed(driven);
    driven.debug.setScreen("stageCleared");
    driven.debug.setPhaseTimer(STAGE_CLEARED_HOLD);
    driven.advance(STAGE_CLEARED_HOLD + 0.05, 60);
    const shape = driven.debug.snapshot();
    expect(shape.stage).toBe(2);
    expect(shape.screen).toBe("stageIntro");
    driven.advance(STAGE_INTRO_HOLD + 0.05, 60);
    expect(driven.debug.snapshot().screen).toBe("inWave");
  });

  it("moves every derived figure with the stage and spawns nothing", () => {
    const driven = driver();
    startPosed(driven);
    poseDrone(driven, "shard", 400, 200);
    driven.debug.setStage(5);
    const shape = driven.debug.snapshot();
    expect(shape.drones).toHaveLength(1);
    expect(shape.droneSpeedScale).toBeCloseTo(1.24, 6);
    expect(shape.bulletSpeedScale).toBeCloseTo(1.16, 6);
    expect(shape.diveGapScale).toBeCloseTo(0.8, 6);
    expect(shape.fluxHold).toBeCloseTo(1.4, 6);
    expect(shape.isChallenge).toBe(false);
    driven.debug.setStage(9);
    expect(driven.debug.snapshot().isChallenge).toBe(true);
  });

  it("sends a challenge stage's groups, none of which fires or settles", () => {
    const driven = driver();
    startPosed(driven);
    driven.debug.setStage(3);
    driven.debug.setWaveEntry(true);
    driven.debug.setScreen("stageIntro");
    driven.debug.setPhaseTimer(0);
    driven.frame(1 / 120);
    expect(driven.debug.snapshot().drones).toHaveLength(CHALLENGE_TOTAL);
    let enemies = 0;
    let settled = 0;
    for (let step = 0; step < 2400; step += 1) {
      driven.frame(1 / 120);
      const shape = driven.debug.snapshot();
      enemies += shape.bullets.filter((bullet) => !bullet.friendly).length;
      settled += shape.drones.filter(
        (drone) => drone.phase === "formation",
      ).length;
      if (shape.screen !== "inWave") break;
    }
    expect(enemies).toBe(0);
    expect(settled).toBe(0);
    expect(driven.debug.snapshot().screen).toBe("stageCleared");
  });

  it("costs no life for a challenge drone's body", () => {
    const driven = driver();
    startPosed(driven);
    driven.debug.setStage(3);
    driven.debug.setShipContact(true);
    driven.debug.setWaveEntry(true);
    driven.debug.setScreen("stageIntro");
    driven.debug.setPhaseTimer(0);
    driven.frame(1 / 120);
    const first = driven.debug.snapshot().drones[0] as { id: number };
    driven.debug.setDronePosition(first.id, 640, SHIP_Y);
    driven.frame(1 / 120);
    expect(driven.debug.snapshot().lives).toBe(START_LIVES);
  });
});

describe("the run", () => {
  it("holds the ready beat, then centres the ship, wave intact", () => {
    const driven = driver();
    startPosed(driven);
    driven.debug.setShipContact(true);
    driven.debug.setShipX(300);
    const id = poseDrone(driven, "shard", 900, 200);
    driven.debug.addEnemyBullet(300, SHIP_Y - 10, "magenta");
    driven.advance(0.1, 6);
    expect(driven.debug.snapshot().phase).toBe("ready");
    expect(driven.debug.snapshot().ship.alive).toBe(false);
    driven.advance(READY_HOLD, 120);
    const shape = driven.debug.snapshot();
    expect(shape.phase).toBe("live");
    expect(shape.ship.x).toBeCloseTo((SHIP_X_MIN + SHIP_X_MAX) / 2, 6);
    expect(shape.drones.map((drone) => drone.id)).toEqual([id]);
  });

  it("pays exactly one extra life at the threshold, and only once", () => {
    const driven = driver();
    startPosed(driven);
    driven.debug.setExtraLifeAwarded(false);
    driven.debug.setScore(EXTRA_LIFE_AT - SCORE_SHARD_FORM);
    poseDrone(driven, "shard", 640, 300);
    driven.debug.addPlayerBullet(640, 320, "cyan");
    driven.advance(0.1, 6);
    let shape = driven.debug.snapshot();
    expect(shape.lives).toBe(START_LIVES + 1);
    expect(shape.extraLifeAwarded).toBe(true);

    driven.debug.setScore(EXTRA_LIFE_AT - SCORE_SHARD_FORM);
    poseDrone(driven, "shard", 640, 300);
    driven.debug.addPlayerBullet(640, 320, "cyan");
    driven.advance(0.1, 6);
    shape = driven.debug.snapshot();
    expect(shape.lives).toBe(START_LIVES + 1);
  });

  it("grants no life for a posed score", () => {
    const driven = driver();
    startPosed(driven);
    driven.debug.setScore(EXTRA_LIFE_AT * 2);
    const shape = driven.debug.snapshot();
    expect(shape.lives).toBe(START_LIVES);
    expect(shape.extraLifeAwarded).toBe(false);
  });

  it("ends the run when the last life goes", () => {
    const driven = driver();
    startPosed(driven);
    driven.debug.setShipContact(true);
    driven.debug.setLives(1);
    driven.debug.addEnemyBullet(640, SHIP_Y - 10, "magenta");
    driven.advance(0.1, 6);
    expect(driven.debug.snapshot().screen).toBe("gameOver");
  });

  it("pays the stage-clear bonus for a standard stage", () => {
    const driven = driver();
    startPosed(driven);
    driven.debug.setWaveEntry(true);
    driven.debug.setScreen("stageIntro");
    driven.debug.setPhaseTimer(0);
    driven.frame(1 / 120);
    const ids = driven.debug.snapshot().drones.map((drone) => drone.id);
    for (const id of ids.slice(0, -1)) driven.debug.removeDrone(id);
    const last = driven.debug.snapshot().drones[0] as { id: number };
    driven.debug.setScore(0);
    driven.debug.setDronePosition(last.id, 640, 300);
    driven.debug.setDroneTravel(last.id, false);
    driven.debug.setDroneBand(last.id, "cyan");
    driven.debug.setDroneShell(last.id, false);
    driven.debug.addPlayerBullet(640, 320, "cyan");
    driven.advance(0.1, 6);
    expect(driven.debug.snapshot().score).toBeGreaterThanOrEqual(
      SCORE_STAGE_CLEAR,
    );
  });

  it("pays a formation Flux its own figure", () => {
    const driven = driver();
    startPosed(driven);
    poseDrone(driven, "flux", 640, 300);
    driven.debug.addPlayerBullet(640, 320, "cyan");
    driven.advance(0.1, 6);
    expect(driven.debug.snapshot().score).toBe(SCORE_FLUX_FORM);
  });
});

describe("the screens", () => {
  it("opens a run from the title and reaches the live wave", () => {
    const driven = driver();
    expect(driven.debug.snapshot().screen).toBe("title");
    driven.press("confirm");
    driven.frame(1 / 60);
    let shape = driven.debug.snapshot();
    expect(shape.screen).toBe("stageIntro");
    expect(shape.stage).toBe(1);
    expect(shape.lives).toBe(START_LIVES);
    expect(shape.score).toBe(0);
    driven.advance(STAGE_INTRO_HOLD + 0.05, 60);
    shape = driven.debug.snapshot();
    expect(shape.screen).toBe("inWave");
  });

  it("wraps a menu at both ends and opens how-to", () => {
    const driven = driver();
    driven.press("up");
    driven.frame(1 / 60);
    expect(driven.debug.snapshot().menuIndex).toBe(1);
    driven.press("down");
    driven.frame(1 / 60);
    expect(driven.debug.snapshot().menuIndex).toBe(0);
    driven.press("down");
    driven.frame(1 / 60);
    driven.press("confirm");
    driven.frame(1 / 60);
    expect(driven.debug.snapshot().screen).toBe("howto");
    driven.press("back");
    driven.frame(1 / 60);
    const shape = driven.debug.snapshot();
    expect(shape.screen).toBe("title");
    // specs/ui.md: an arrival back at the title highlights the entry that led
    // away from it, which for the how-to-play screen is `HOW TO PLAY`.
    expect(shape.menuIndex).toBe(TITLE_ITEMS.indexOf("HOW TO PLAY"));
  });

  it("pauses, freezes the field, and resumes", () => {
    const driven = driver();
    startPosed(driven);
    const id = poseDrone(driven, "shard", 400, 200);
    driven.debug.setDroneTravel(id, true);
    driven.debug.setDronePhase(id, "diving");
    driven.press("pause");
    driven.frame(1 / 60);
    expect(driven.debug.snapshot().screen).toBe("paused");
    const frozen = JSON.stringify(driven.debug.snapshot().drones);
    driven.advance(10, 600);
    expect(JSON.stringify(driven.debug.snapshot().drones)).toBe(frozen);
    driven.press("pause");
    driven.frame(1 / 60);
    expect(driven.debug.snapshot().screen).toBe("inWave");
    driven.advance(0.5, 30);
    expect(JSON.stringify(driven.debug.snapshot().drones)).not.toBe(frozen);
  });

  it("restarts and quits from the pause menu", () => {
    const driven = driver();
    startPosed(driven);
    driven.debug.setScore(500);
    driven.debug.setStage(4);
    driven.debug.setScreen("paused");
    driven.debug.setMenuIndex(1);
    driven.press("confirm");
    driven.frame(1 / 60);
    let shape = driven.debug.snapshot();
    expect(shape.score).toBe(0);
    expect(shape.stage).toBe(1);
    expect(shape.lives).toBe(START_LIVES);
    expect(shape.screen).toBe("stageIntro");

    driven.debug.setScreen("paused");
    driven.debug.setMenuIndex(2);
    driven.press("confirm");
    driven.frame(1 / 60);
    shape = driven.debug.snapshot();
    expect(shape.screen).toBe("title");
  });

  it("plays again from the game-over screen", () => {
    const driven = driver();
    startPosed(driven);
    driven.debug.setScreen("gameOver");
    driven.debug.setScore(900);
    driven.debug.setStage(7);
    driven.debug.setMenuIndex(0);
    driven.press("confirm");
    driven.frame(1 / 60);
    const shape = driven.debug.snapshot();
    expect(shape.score).toBe(0);
    expect(shape.stage).toBe(1);
    expect(shape.screen).toBe("stageIntro");
  });
});

describe("overload", () => {
  it("charges a drone a mismatched shot finds, and advances the charge", () => {
    const driven = driver();
    startPosed(driven);
    const id = poseDrone(driven, "shard", 640, 300);
    driven.debug.addPlayerBullet(640, 320, "magenta");
    driven.advance(0.1, 6);
    expect(only(driven).charge).toBe(1);
    driven.debug.addPlayerBullet(640, 320, "magenta");
    driven.advance(0.1, 6);
    expect(only(driven).charge).toBe(2);
    expect(only(driven).id).toBe(id);
  });

  it("overloads at the third charge, resets, and can be charged again", () => {
    const driven = driver();
    startPosed(driven);
    const id = poseDrone(driven, "shard", 640, 300);
    driven.debug.setDroneSlot(id, 640, 300);
    driven.debug.setDroneCharge(id, OVERLOAD_AT - 1);
    driven.clearPlayed();
    driven.debug.addPlayerBullet(640, 320, "magenta");
    driven.advance(0.05, 3);
    let drone = only(driven);
    expect(drone.charge).toBe(0);
    expect(drone.phase).toBe("diving");
    expect(driven.played).toContain("overload");
    expect(driven.debug.snapshot().score).toBe(0);
    expect(driven.debug.snapshot().resonance).toBe(0);

    driven.debug.setDronePosition(drone.id, 640, 300);
    driven.debug.addPlayerBullet(640, 320, "magenta");
    driven.advance(0.05, 3);
    drone = only(driven);
    expect(drone.charge).toBe(1);
  });

  it("plunges an overloaded Shard faster than a dive", () => {
    const measure = (charge: number): number => {
      const driven = driver();
      startPosed(driven);
      const id = poseDrone(driven, "shard", 640, 160);
      driven.debug.setDroneSlot(id, 640, 160);
      driven.debug.setDroneTravel(id, true);
      if (charge > 0) {
        driven.debug.setDroneCharge(id, charge);
        driven.debug.addPlayerBullet(640, 180, "magenta");
        driven.advance(0.02, 2);
      } else {
        driven.debug.setDronePhase(id, "diving");
      }
      const start = only(driven);
      let previous = { x: start.x, y: start.y };
      let travelled = 0;
      for (let step = 0; step < 120; step += 1) {
        driven.frame(1 / 120);
        const drone = only(driven);
        travelled += Math.hypot(drone.x - previous.x, drone.y - previous.y);
        previous = { x: drone.x, y: drone.y };
      }
      return travelled;
    };
    const plain = measure(0);
    const plunging = measure(OVERLOAD_AT - 1);
    expect(plunging / plain).toBeGreaterThan(OVERLOAD_DIVE_SCALE * 0.85);
    expect(plunging / plain).toBeLessThan(OVERLOAD_DIVE_SCALE * 1.15);
  });

  it("flips an overloaded Flux and sprays a fan of its new band", () => {
    const driven = driver();
    startPosed(driven);
    const id = poseDrone(driven, "flux", 640, 300);
    driven.debug.setDroneCharge(id, OVERLOAD_AT - 1);
    driven.debug.addPlayerBullet(640, 320, "magenta");
    driven.advance(0.02, 2);
    const shape = driven.debug.snapshot();
    const drone = shape.drones[0] as { band: string; bandClock: number };
    expect(drone.band).toBe("magenta");
    expect(drone.bandClock).toBe(0);
    const sprayed = shape.bullets.filter((bullet) => !bullet.friendly);
    expect(sprayed).toHaveLength(OVERLOAD_FLUX_SPREAD);
    expect(sprayed.every((bullet) => bullet.band === "magenta")).toBe(true);
    const headings = sprayed
      .map((bullet) => (Math.atan2(bullet.vx, bullet.vy) * 180) / Math.PI)
      .sort((a, b) => a - b);
    for (let index = 1; index < headings.length; index += 1) {
      const gap = (headings[index] as number) - (headings[index - 1] as number);
      expect(gap).toBeGreaterThan(OVERLOAD_FLUX_SPREAD_ANGLE * 0.85);
      expect(gap).toBeLessThan(OVERLOAD_FLUX_SPREAD_ANGLE * 1.15);
    }
  });

  it("bursts both bands from an overloaded Prism and grows the swarm once", () => {
    const withShell = driver();
    startPosed(withShell);
    const shell = poseDrone(withShell, "prism", 640, 300);
    withShell.debug.setDroneCharge(shell, OVERLOAD_AT - 1);
    withShell.debug.addPlayerBullet(640, 320, "magenta");
    withShell.advance(0.02, 2);
    let shape = withShell.debug.snapshot();
    expect(
      shape.bullets
        .filter((bullet) => !bullet.friendly)
        .map((bullet) => bullet.band)
        .sort(),
    ).toEqual(["cyan", "magenta"]);
    expect(shape.drones).toHaveLength(2);
    expect(shape.drones.filter((drone) => drone.kind === "shard")).toHaveLength(
      1,
    );

    const coreOnly = driver();
    startPosed(coreOnly);
    const core = poseDrone(coreOnly, "prism", 640, 300);
    coreOnly.debug.setDroneShell(core, false);
    coreOnly.debug.setDroneCharge(core, OVERLOAD_AT - 1);
    coreOnly.debug.addPlayerBullet(640, 320, "cyan");
    coreOnly.advance(0.02, 2);
    shape = coreOnly.debug.snapshot();
    expect(shape.drones).toHaveLength(1);
    expect(
      shape.bullets
        .filter((bullet) => !bullet.friendly)
        .map((bullet) => bullet.band)
        .sort(),
    ).toEqual(["cyan", "magenta"]);
  });

  it("takes no charge on a shimmering Flux, and a match still destroys", () => {
    const driven = driver();
    startPosed(driven);
    const id = poseDrone(driven, "flux", 640, 300);
    driven.debug.setDroneBandClock(id, fluxHold(1) + 0.1);
    driven.debug.setDroneCharge(id, 1);
    driven.debug.addPlayerBullet(640, 320, "magenta");
    driven.advance(0.05, 3);
    const drone = only(driven);
    expect(drone.charge).toBe(1);

    driven.debug.setDroneBandClock(id, 0);
    driven.debug.setDroneCharge(id, 2);
    driven.debug.addPlayerBullet(640, 320, "cyan");
    driven.advance(0.05, 3);
    expect(driven.debug.snapshot().drones).toHaveLength(0);
  });
});

describe("the dive's own geometry", () => {
  it("turns back above the bottom of the play field on every posed dive", () => {
    for (const y of [140, 300, 500, DIVE_TURN_Y - 10]) {
      const driven = driver();
      startPosed(driven);
      const id = poseDrone(driven, "shard", 640, y);
      driven.debug.setDroneSlot(id, 640, 140);
      driven.debug.setDronePhase(id, "diving");
      driven.debug.setDroneTravel(id, true);
      let deepest = 0;
      for (let step = 0; step < 960; step += 1) {
        driven.frame(1 / 120);
        const drone = driven.debug.snapshot().drones[0];
        if (drone === undefined) break;
        deepest = Math.max(deepest, drone.y);
        if (drone.phase === "formation") break;
      }
      expect(deepest).toBeLessThan(FIELD_BOTTOM);
      expect(deepest).toBeGreaterThan(PRISM_INVERT_Y - 12);
    }
  });
});
