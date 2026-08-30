import { describe, expect, it } from "vitest";

import {
  FACE_UP,
  FIELD_H,
  FIELD_W,
  ROCK_RADIUS,
  ROCK_SIZES,
  ROCK_SPEED_MAX,
  ROCK_SPEED_MIN,
  SAFE_X,
  SAFE_Y,
  SAUCER_FIRE_INTERVAL,
  SAUCER_R,
  SAUCER_SPEED,
  SAUCER_WEAVE_INTERVAL,
} from "./constants";
import {
  NOSE_OFFSET,
  driftRock,
  enterSaucer,
  makeBullet,
  makeEnemyBullet,
  makeRock,
  makeShip,
  placeAtSafePoint,
  recycleRock,
  shipNose,
  takeId,
} from "./entities";

/** A home for entities: the two fields a factory reads off the state. */
function home(seedValue = 1): { rng: number; nextId: number } {
  return { rng: seedValue, nextId: 0 };
}

describe("identity", () => {
  it("hands out an id that only ever goes up", () => {
    const source = home();
    expect([takeId(source), takeId(source), takeId(source)]).toEqual([1, 2, 3]);
    expect(source.nextId).toBe(3);
  });

  it("gives every entity of every kind a distinct id", () => {
    const source = home();
    const ids = [
      makeRock(source, "large", 0, 0, 0, 0).id,
      makeBullet(source, 0, 0, 0, 0).id,
      makeEnemyBullet(source, 0, 0, 0, 0).id,
      enterSaucer(source).id,
      makeRock(source, "small", 0, 0, 0, 0).id,
    ];
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("the ship", () => {
  it("begins at the safe point, at rest, facing up", () => {
    expect(makeShip()).toMatchObject({
      x: SAFE_X,
      y: SAFE_Y,
      vx: 0,
      vy: 0,
      angle: FACE_UP,
      invuln: 0,
      collision: true,
      fireCooldown: 0,
      thrusting: false,
    });
  });

  it("returns there on a respawn, keeping its contact gate", () => {
    const ship = makeShip();
    ship.x = 10;
    ship.y = 20;
    ship.angle = 1;
    ship.vx = 300;
    ship.thrusting = true;
    ship.collision = false;
    placeAtSafePoint(ship);
    expect(ship).toMatchObject({
      x: SAFE_X,
      y: SAFE_Y,
      vx: 0,
      vy: 0,
      angle: FACE_UP,
      thrusting: false,
    });
    // The gate is the debug surface's, and a respawn is not a reason to move it.
    expect(ship.collision).toBe(false);
  });

  it("puts the muzzle ahead of the centre, inside the bound the specs fix", () => {
    const ship = makeShip();
    ship.angle = 0;
    const nose = shipNose(ship);
    expect(nose.x).toBeCloseTo(SAFE_X + NOSE_OFFSET, 9);
    expect(nose.y).toBeCloseTo(SAFE_Y, 9);
  });
});

describe("rocks", () => {
  it("collides as the circle its size fixes", () => {
    for (const size of ROCK_SIZES) {
      expect(makeRock(home(), size, 0, 0, 0, 0).radius).toBe(ROCK_RADIUS[size]);
    }
  });

  it("drifts at a speed inside its size's own range", () => {
    const source = home(4);
    for (let i = 0; i < 200; i += 1) {
      for (const size of ROCK_SIZES) {
        const rock = driftRock(source, size, 100, 100, 1);
        const speed = Math.hypot(rock.vx, rock.vy);
        expect(speed).toBeGreaterThanOrEqual(ROCK_SPEED_MIN[size] - 1e-9);
        expect(speed).toBeLessThanOrEqual(ROCK_SPEED_MAX[size] + 1e-9);
      }
    }
  });

  it("scales a wave's drift speed by the wave's multiplier", () => {
    const plain = driftRock(home(9), "large", 0, 0, 1);
    const faster = driftRock(home(9), "large", 0, 0, 1.2);
    expect(Math.hypot(faster.vx, faster.vy)).toBeCloseTo(
      Math.hypot(plain.vx, plain.vy) * 1.2,
      6,
    );
  });

  it("keeps one drawn outline for the life of a rock, and varies between rocks", () => {
    const source = home(7);
    const first = makeRock(source, "large", 0, 0, 0, 0);
    const second = makeRock(source, "large", 0, 0, 0, 0);
    expect(first.verts).not.toEqual(second.verts);
    expect(first.verts.length).toBeGreaterThanOrEqual(9);
    expect(first.verts.length).toBeLessThanOrEqual(12);
    for (const radius of first.verts) {
      expect(radius).toBeGreaterThan(ROCK_RADIUS.large * 0.7);
      expect(radius).toBeLessThan(ROCK_RADIUS.large * 1.2);
    }
  });

  it("comes back from an edge, at its size's plain speed, as the same rock", () => {
    const source = home(21);
    const rock = makeRock(source, "medium", 640, 360, 5, 5);
    const id = rock.id;
    const spin = rock.spin;
    const verts = [...rock.verts];
    for (let i = 0; i < 60; i += 1) {
      recycleRock(source, rock);
      expect(rock.id).toBe(id);
      expect(rock.size).toBe("medium");
      expect(rock.spin).toBe(spin);
      expect(rock.verts).toEqual(verts);
      // Placed on one of the field's four edges, heading into the field.
      const onEdge =
        rock.x === 0 ||
        rock.x === FIELD_W ||
        rock.y === 0 ||
        rock.y === FIELD_H;
      expect(onEdge).toBe(true);
      expect(rock.x).toBeGreaterThanOrEqual(0);
      expect(rock.x).toBeLessThanOrEqual(FIELD_W);
      expect(rock.y).toBeGreaterThanOrEqual(0);
      expect(rock.y).toBeLessThanOrEqual(FIELD_H);
      const speed = Math.hypot(rock.vx, rock.vy);
      expect(speed).toBeGreaterThanOrEqual(ROCK_SPEED_MIN.medium - 1e-9);
      expect(speed).toBeLessThanOrEqual(ROCK_SPEED_MAX.medium + 1e-9);
    }
  });
});

describe("the saucer", () => {
  it("arrives at a seam, crossing at cruise, with its clocks wound", () => {
    const source = home(33);
    const seen = new Set<number>();
    for (let i = 0; i < 60; i += 1) {
      const saucer = enterSaucer(source);
      seen.add(Math.sign(saucer.vx));
      expect(saucer.x === SAUCER_R || saucer.x === FIELD_W - SAUCER_R).toBe(
        true,
      );
      expect(Math.abs(saucer.vx)).toBe(SAUCER_SPEED);
      expect(saucer.vy).toBe(0);
      expect(saucer.y).toBeGreaterThanOrEqual(SAUCER_R);
      expect(saucer.y).toBeLessThanOrEqual(FIELD_H - SAUCER_R);
      expect(saucer.fireTimer).toBe(SAUCER_FIRE_INTERVAL);
      expect(saucer.weaveTimer).toBe(SAUCER_WEAVE_INTERVAL);
      expect(saucer.age).toBe(0);
      expect(saucer.mind && saucer.gun && saucer.travel).toBe(true);
    }
    // It comes from the left and from the right.
    expect([...seen].sort()).toEqual([-1, 1]);
  });
});
