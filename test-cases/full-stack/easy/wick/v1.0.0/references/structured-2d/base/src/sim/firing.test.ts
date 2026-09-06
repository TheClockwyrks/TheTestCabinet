import { describe, expect, it } from "vitest";
import {
  BASE_WEAPON_IDS,
  INFINITE_PIERCE,
  MIN_COOLDOWN,
  TICK_HZ,
  WEAPON_LEVELS,
  type BaseWeaponId,
  type CueName,
  type PassiveId,
  type WeaponId,
} from "../constants";
import { Rng } from "../rng";
import {
  freshRun,
  initialState,
  type RunState,
  type WickState,
} from "../state";
import { NOTHING_HELD } from "../state";
import { spawnEnemy } from "./enemies";
import { tick } from "./tick";
import { aimAt, makeProjectile } from "./weapons";

interface World {
  state: WickState;
  rng: Rng;
  cues: Set<CueName>;
}

/** A `playing` run holding `weapons` alone, every other faculty held. */
function playing(...weapons: [WeaponId, number][]): World {
  const state = initialState();
  state.run = freshRun();
  state.run.weapons = weapons.map(([id, level]) => ({
    id,
    level,
    cooldown: 0,
    cooldownSet: 0,
  }));
  state.screen = "playing";
  state.spawning = false;
  state.events = false;
  state.despawning = false;
  state.enemyMotion = false;
  state.enemyContact = false;
  return { state, rng: new Rng(), cues: new Set() };
}

function hold(world: World, id: PassiveId, level: number): void {
  world.state.run.passives.push({ id, level });
}

function step(world: World, ticks = 1): void {
  for (let i = 0; i < ticks; i += 1) {
    world.cues.clear();
    tick(world.state, world.rng, NOTHING_HELD, world.cues);
  }
}

/** The ticks, up to `upTo`, on which `signature` changed. */
function fireTicks(
  world: World,
  upTo: number,
  signature: (run: RunState) => number = (run) => run.nextId,
): number[] {
  const out: number[] = [];
  let last = signature(world.state.run);
  for (let i = 0; i < upTo; i += 1) {
    step(world);
    const now = signature(world.state.run);
    if (now !== last) out.push(world.state.run.tick);
    last = now;
  }
  return out;
}

const ticksOf = (seconds: number): number => Math.round(seconds * TICK_HZ);

describe("the cooldown timer", () => {
  it("fires every base weapon on the first tick and again each period", () => {
    for (const id of BASE_WEAPON_IDS) {
      const world = playing([id, 1]);
      // An owl: within every weapon's reach, and far from dying.
      const owl = spawnEnemy(world.state.run, "owl", 100, 0);
      const cooldown = WEAPON_LEVELS[id][0].cooldown ?? 0;
      const period =
        id === "lantern"
          ? ticksOf(cooldown + (WEAPON_LEVELS[id][0].duration ?? 0))
          : ticksOf(cooldown);
      const signature =
        id === "halo"
          ? (): number => owl.hp
          : (run: RunState): number => run.nextId;
      const fired = fireTicks(world, 2 * period + 1, signature);
      expect(fired, id).toEqual([1, 1 + period, 1 + 2 * period]);
      expect(world.state.run.weapons[0].cooldown, id).toBeCloseTo(
        id === "lantern"
          ? cooldown + (WEAPON_LEVELS[id][0].duration ?? 0)
          : cooldown,
        9,
      );
    }
  });

  it("holds every timer and fires nothing while weaponFire is off", () => {
    const world = playing(["taper", 1], ["pin", 1], ["halo", 1]);
    world.state.run.weapons[1].cooldown = 0.25;
    world.state.weaponFire = false;
    spawnEnemy(world.state.run, "owl", 30, 0);
    step(world, 30);
    expect(world.state.run.weapons.map((weapon) => weapon.cooldown)).toEqual([
      0, 0.25, 0,
    ]);
    expect(world.state.run.projectiles).toHaveLength(0);
    expect(world.state.run.zones.map((zone) => zone.kind)).toEqual(["aura"]);
    expect(world.state.run.enemies[0].hp).toBe(2000);
    world.state.weaponFire = true;
    step(world);
    expect(world.state.run.zones.map((zone) => zone.kind)).toEqual([
      "aura",
      "slash",
    ]);
    expect(world.state.run.projectiles).toHaveLength(0);
    expect(world.state.run.enemies[0].hp).toBe(1997 - 10);
    step(world, 15);
    expect(world.state.run.projectiles).toHaveLength(1);
  });

  it("scales by Oil and floors at MIN_COOLDOWN, read on the tick it fires", () => {
    const world = playing(["ember", 1], ["beacon", 1]);
    hold(world, "oil", 5);
    spawnEnemy(world.state.run, "owl", 300, 0);
    step(world);
    expect(world.state.run.weapons[0].cooldown).toBeCloseTo(0.72, 9);
    expect(world.state.run.weapons[1].cooldown).toBe(MIN_COOLDOWN);
    world.state.run.passives = [];
    step(world, ticksOf(0.72));
    expect(world.state.run.weapons[0].cooldown).toBeCloseTo(1.2, 9);
  });

  it("sets the timer of a weapon that found no target as though it had fired", () => {
    for (const id of ["ember", "sconce", "spark"] as const) {
      const world = playing([id, 1]);
      if (id === "spark") spawnEnemy(world.state.run, "owl", 601, 0);
      step(world);
      expect(world.state.run.projectiles, id).toHaveLength(0);
      expect(world.state.run.zones, id).toHaveLength(0);
      expect(world.state.run.weapons[0].cooldown, id).toBe(
        WEAPON_LEVELS[id][0].cooldown,
      );
    }
  });
});

describe("Taper", () => {
  it("slashes from the player's x in the facing direction at level 1", () => {
    const world = playing(["taper", 1]);
    world.state.run.player.x = 40;
    world.state.run.player.y = -25;
    world.state.run.player.facing = "left";
    step(world);
    expect(world.state.run.zones).toEqual([
      expect.objectContaining({
        weapon: "taper",
        kind: "slash",
        x: 40 - 60,
        y: -25,
        width: 120,
        height: 40,
        radius: 0,
        damage: 10,
        ttl: 0.1,
      }),
    ]);
    step(world, 5);
    expect(world.state.run.zones).toHaveLength(1);
    step(world);
    expect(world.state.run.zones).toHaveLength(0);
  });

  it("mirrors a second slash at level 8, and caps the amount at two", () => {
    const world = playing(["taper", 8]);
    hold(world, "mirror", 2);
    step(world);
    expect(
      world.state.run.zones.map((zone) => [
        zone.x,
        zone.width,
        zone.height,
        zone.damage,
      ]),
    ).toEqual([
      [80, 160, 56, 30],
      [-80, 160, 56, 30],
    ]);
    expect(world.state.run.weapons[0].cooldown).toBe(1.2);
  });

  it("scales its lengths by Glass and its damage by Wick when it fires", () => {
    const world = playing(["taper", 3]);
    hold(world, "glass", 2);
    hold(world, "wick", 5);
    step(world);
    expect(world.state.run.zones.map((zone) => zone.x)).toEqual([72, -72]);
    expect(world.state.run.zones[0]).toMatchObject({
      width: 144,
      height: 48,
      damage: 22.5,
    });
  });
});

describe("Ember", () => {
  it("fires one bolt at the nearest enemy at level 1", () => {
    const world = playing(["ember", 1]);
    spawnEnemy(world.state.run, "moth", 100, 0);
    spawnEnemy(world.state.run, "moth", 0, -50);
    step(world);
    expect(world.state.run.projectiles).toEqual([
      expect.objectContaining({
        weapon: "ember",
        x: 0,
        y: 0,
        vx: 0,
        vy: -400,
        ax: 0,
        ay: 0,
        radius: 8,
        damage: 10,
        ttl: 2,
        pierce: 0,
        hits: [],
      }),
    ]);
    expect(world.state.run.weapons[0].cooldown).toBe(1.2);
  });

  it("fires three bolts at the three nearest distinct enemies at level 8", () => {
    const world = playing(["ember", 8]);
    world.state.run.player.x = 10;
    spawnEnemy(world.state.run, "owl", 10, 300);
    spawnEnemy(world.state.run, "owl", 10, -200);
    spawnEnemy(world.state.run, "owl", 910, 0);
    spawnEnemy(world.state.run, "owl", 110, 0);
    step(world);
    expect(
      world.state.run.projectiles.map((bolt) => [bolt.vx, bolt.vy]),
    ).toEqual([
      [450, 0],
      [0, -450],
      [0, 450],
    ]);
    expect(world.state.run.projectiles[0]).toMatchObject({
      radius: 10,
      damage: 25,
      pierce: 2,
      ttl: 2,
    });
    expect(world.state.run.weapons[0].cooldown).toBe(0.8);
  });

  it("breaks a distance tie by the lowest id and fires fewer bolts than amount", () => {
    const world = playing(["ember", 2]);
    spawnEnemy(world.state.run, "moth", 0, 60);
    step(world);
    expect(world.state.run.projectiles).toHaveLength(1);
    world.state.run.projectiles = [];
    spawnEnemy(world.state.run, "moth", 60, 0);
    spawnEnemy(world.state.run, "moth", -60, 0);
    step(world, ticksOf(1.2));
    expect(
      world.state.run.projectiles.map((bolt) => [bolt.vx, bolt.vy]),
    ).toEqual([
      [0, 400],
      [400, 0],
    ]);
  });

  it("fires along the facing direction at an enemy on the player's center", () => {
    const world = playing(["ember", 1]);
    world.state.run.player.facing = "left";
    expect(aimAt(world.state.run, { x: 0, y: 0 })).toEqual({ x: -1, y: 0 });
    const target = spawnEnemy(world.state.run, "owl", 0, 0);
    step(world);
    // The bolt was fired, hit the owl it stood on, and was spent.
    expect(world.state.run.nextId).toBe(2);
    expect(target.hp).toBe(1990);
    expect(world.state.run.projectiles).toEqual([]);
  });
});

describe("Pin", () => {
  it("fires one dart in the facing direction at level 1 without a target", () => {
    const world = playing(["pin", 1]);
    step(world);
    expect(world.state.run.projectiles).toEqual([
      expect.objectContaining({
        weapon: "pin",
        x: 0,
        y: 0,
        vx: 600,
        vy: 0,
        radius: 6,
        damage: 6,
        ttl: 1.5,
        pierce: 1,
      }),
    ]);
    expect(world.state.run.weapons[0].cooldown).toBe(0.5);
  });

  it("spreads five darts vertically at level 8, facing left", () => {
    const world = playing(["pin", 8]);
    world.state.run.player.y = 100;
    world.state.run.player.facing = "left";
    step(world);
    expect(
      world.state.run.projectiles.map((dart) => [dart.x, dart.y, dart.vx]),
    ).toEqual([
      [0, 80, -700],
      [0, 90, -700],
      [0, 100, -700],
      [0, 110, -700],
      [0, 120, -700],
    ]);
    expect(world.state.run.projectiles[0]).toMatchObject({
      radius: 7,
      damage: 15,
      pierce: 3,
      ttl: 1.5,
    });
    expect(world.state.run.weapons[0].cooldown).toBe(0.35);
  });

  it("adds Mirror to its amount", () => {
    const world = playing(["pin", 1]);
    hold(world, "mirror", 1);
    step(world);
    expect(world.state.run.projectiles.map((dart) => dart.y)).toEqual([-5, 5]);
  });
});

describe("Lantern", () => {
  it("places one lantern at angle 0 at level 1 and times its set", () => {
    const world = playing(["lantern", 1]);
    world.state.run.player.x = 5;
    step(world);
    expect(world.state.run.zones).toEqual([
      expect.objectContaining({
        weapon: "lantern",
        kind: "lantern",
        x: 95,
        y: 0,
        radius: 14,
        damage: 10,
        ttl: 3,
        angle: 0,
        orbit: 90,
      }),
    ]);
    expect(world.state.run.weapons[0].cooldown).toBe(6);
    step(world, ticksOf(3) - 1);
    expect(world.state.run.zones).toHaveLength(1);
    step(world);
    expect(world.state.run.zones).toHaveLength(0);
    step(world, ticksOf(3) - 1);
    expect(world.state.run.zones).toHaveLength(0);
    step(world);
    expect(world.state.run.zones).toHaveLength(1);
  });

  it("spaces four lanterns evenly at level 8", () => {
    const world = playing(["lantern", 8]);
    step(world);
    const set = world.state.run.zones;
    expect(set.map((lantern) => lantern.angle)).toEqual([0, 90, 180, 270]);
    expect(set.map((lantern) => Math.round(lantern.x) + 0)).toEqual([
      120, 0, -120, 0,
    ]);
    expect(set.map((lantern) => Math.round(lantern.y) + 0)).toEqual([
      0, 120, 0, -120,
    ]);
    expect(set[0]).toMatchObject({ radius: 20, damage: 25, ttl: 4 });
    expect(world.state.run.weapons[0].cooldown).toBe(6.5);
  });

  it("revolves clockwise from the next tick about the player", () => {
    const world = playing(["lantern", 1]);
    step(world);
    step(world);
    const [lantern] = world.state.run.zones;
    expect(lantern.angle).toBeCloseTo(3, 9);
    expect(lantern.x).toBeCloseTo(90 * Math.cos(Math.PI / 60), 9);
    expect(lantern.y).toBeCloseTo(90 * Math.sin(Math.PI / 60), 9);
    world.state.run.player.x = 500;
    world.state.effectMotion = false;
    step(world);
    expect(lantern.angle).toBeCloseTo(3, 9);
    expect(lantern.x).toBeCloseTo(500 + 90 * Math.cos(Math.PI / 60), 9);
  });

  it("fixes a set when it is created and reads a Mirror level at the next", () => {
    const world = playing(["lantern", 1]);
    hold(world, "glass", 1);
    step(world);
    expect(world.state.run.zones[0].orbit).toBeCloseTo(99, 9);
    expect(world.state.run.zones[0].radius).toBeCloseTo(15.4, 9);
    world.state.run.passives = [{ id: "mirror", level: 1 }];
    step(world);
    expect(world.state.run.zones).toHaveLength(1);
    expect(world.state.run.zones[0].orbit).toBeCloseTo(99, 9);
    expect(world.state.run.zones[0].radius).toBeCloseTo(15.4, 9);
    step(world, ticksOf(6) - 1);
    expect(world.state.run.zones.map((lantern) => lantern.angle)).toEqual([
      0, 180,
    ]);
    expect(world.state.run.zones[0]).toMatchObject({ orbit: 90, radius: 14 });
  });
});

describe("Halo", () => {
  it("pulses on the first tick and every cooldown, with the level 1 row", () => {
    const world = playing(["halo", 1]);
    const moth = spawnEnemy(world.state.run, "moth", 85, 0);
    moth.hp = 1000;
    moth.maxHp = 1000;
    step(world);
    expect(world.state.run.zones).toEqual([
      expect.objectContaining({
        weapon: "halo",
        kind: "aura",
        x: 0,
        y: 0,
        radius: 80,
        damage: 3,
        ttl: null,
        hits: [],
      }),
    ]);
    expect(moth.hp).toBe(997);
    expect(world.state.run.weapons[0].cooldown).toBe(1);
    step(world, 59);
    expect(moth.hp).toBe(997);
    step(world);
    expect(moth.hp).toBe(994);
  });

  it("reads the level 8 row and ignores amount", () => {
    const world = playing(["halo", 8]);
    hold(world, "mirror", 2);
    const owl = spawnEnemy(world.state.run, "owl", 150, 0);
    step(world);
    expect(world.state.run.zones).toHaveLength(1);
    expect(world.state.run.zones[0]).toMatchObject({ radius: 120, damage: 8 });
    expect(owl.hp).toBe(1992);
    expect(world.state.run.weapons[0].cooldown).toBe(0.6);
  });
});

describe("Oil Splash", () => {
  it("lands one puddle within OIL_SCATTER at level 1, pulsing at once", () => {
    const world = playing(["oil-splash", 1]);
    world.state.run.player.x = 1000;
    step(world);
    const [puddle] = world.state.run.zones;
    expect(world.state.run.zones).toHaveLength(1);
    expect(puddle).toMatchObject({
      weapon: "oil-splash",
      kind: "puddle",
      radius: 50,
      damage: 4,
      ttl: 2.5,
      pulse: 0.3,
      hits: [],
    });
    expect(Math.hypot(puddle.x - 1000, puddle.y)).toBeLessThan(400);
    expect(world.state.run.weapons[0].cooldown).toBe(3);
  });

  it("lands four puddles at level 8, scattered independently", () => {
    const world = playing(["oil-splash", 8]);
    step(world);
    const puddles = world.state.run.zones;
    expect(puddles).toHaveLength(4);
    expect(
      new Set(puddles.map((puddle) => `${puddle.x},${puddle.y}`)).size,
    ).toBe(4);
    expect(puddles[0]).toMatchObject({ radius: 70, damage: 8, ttl: 4 });
    expect(world.state.run.weapons[0].cooldown).toBe(2);
  });

  it("lands the firing's first puddle at nextPuddleOffset and consumes it", () => {
    const world = playing(["oil-splash", 8]);
    world.state.run.player.x = 1000;
    world.state.run.player.y = 20;
    world.state.run.nextPuddleOffset = { x: -300, y: 40 };
    step(world);
    const puddles = world.state.run.zones;
    expect(puddles).toHaveLength(4);
    expect(puddles[0]).toMatchObject({ x: 700, y: 60 });
    for (const puddle of puddles.slice(1)) {
      expect(Math.hypot(puddle.x - 1000, puddle.y - 20)).toBeLessThan(400);
    }
    expect(world.state.run.nextPuddleOffset).toBeNull();
  });

  it("covers the scatter disk uniformly over many firings", () => {
    const world = playing(["oil-splash", 8]);
    hold(world, "mirror", 2);
    let inner = 0;
    let total = 0;
    for (let i = 0; i < 100; i += 1) {
      world.state.run.zones = [];
      world.state.run.weapons[0].cooldown = 0;
      step(world);
      for (const puddle of world.state.run.zones) {
        total += 1;
        if (Math.hypot(puddle.x, puddle.y) < 400 / Math.SQRT2) inner += 1;
      }
    }
    expect(total).toBe(600);
    // Half the area of the disk lies inside 1/√2 of its radius.
    expect(inner / total).toBeGreaterThan(0.4);
    expect(inner / total).toBeLessThan(0.6);
  });
});

describe("Spark", () => {
  it("strikes one enemy within SPARK_RANGE at level 1", () => {
    const world = playing(["spark", 1]);
    spawnEnemy(world.state.run, "owl", 700, 0);
    const near = spawnEnemy(world.state.run, "owl", 100, 50);
    step(world);
    expect(world.state.run.zones).toEqual([
      expect.objectContaining({
        weapon: "spark",
        kind: "strike",
        x: 100,
        y: 50,
        radius: 40,
        damage: 15,
        ttl: 0.2,
      }),
    ]);
    expect(near.hp).toBe(1985);
    expect(world.state.run.weapons[0].cooldown).toBe(2);
    step(world, 11);
    expect(world.state.run.zones).toHaveLength(1);
    step(world);
    expect(world.state.run.zones).toHaveLength(0);
  });

  it("strikes four distinct enemies at level 8, fewer when fewer are in range", () => {
    const world = playing(["spark", 8]);
    for (let i = 0; i < 6; i += 1) {
      spawnEnemy(world.state.run, "owl", 200 * Math.cos(i), 200 * Math.sin(i));
    }
    step(world);
    const struck = world.state.run.zones.map((zone) => `${zone.x},${zone.y}`);
    expect(struck).toHaveLength(4);
    expect(new Set(struck).size).toBe(4);
    expect(world.state.run.zones[0]).toMatchObject({ radius: 70, damage: 40 });
    expect(world.state.run.weapons[0].cooldown).toBe(1.4);
    world.state.run.enemies.splice(2);
    world.state.run.zones = [];
    step(world, ticksOf(1.4));
    expect(world.state.run.zones).toHaveLength(2);
  });

  it("strikes the posed nextStrikeTarget first and consumes it", () => {
    const world = playing(["spark", 8]);
    const owls = [];
    for (let i = 0; i < 6; i += 1) {
      owls.push(
        spawnEnemy(
          world.state.run,
          "owl",
          200 * Math.cos(i),
          200 * Math.sin(i),
        ),
      );
    }
    for (let firing = 0; firing < 10; firing += 1) {
      const posed = owls[5];
      world.state.run.zones = [];
      world.state.run.weapons[0].cooldown = 0;
      world.state.run.nextStrikeTarget = posed.id;
      step(world);
      expect(world.state.run.zones).toHaveLength(4);
      expect(world.state.run.zones[0]).toMatchObject({
        x: posed.x,
        y: posed.y,
      });
      const struck = new Set(
        world.state.run.zones.map((zone) => `${zone.x},${zone.y}`),
      );
      expect(struck.size).toBe(4);
      expect(world.state.run.nextStrikeTarget).toBeNull();
    }
  });

  it("discards a posed target out of range and draws every strike", () => {
    const world = playing(["spark", 1]);
    const far = spawnEnemy(world.state.run, "owl", 700, 0);
    spawnEnemy(world.state.run, "owl", 100, 50);
    world.state.run.nextStrikeTarget = far.id;
    step(world);
    expect(world.state.run.zones).toHaveLength(1);
    expect(world.state.run.zones[0]).toMatchObject({ x: 100, y: 50 });
    expect(world.state.run.nextStrikeTarget).toBeNull();
  });

  it("keeps a posed target across a tick Spark does not fire on", () => {
    const world = playing(["spark", 1]);
    const far = spawnEnemy(world.state.run, "owl", 700, 0);
    world.state.run.nextStrikeTarget = far.id;
    step(world);
    expect(world.state.run.zones).toHaveLength(0);
    expect(world.state.run.nextStrikeTarget).toBe(far.id);
  });

  it("is not scaled in range by Glass", () => {
    const world = playing(["spark", 1]);
    hold(world, "glass", 5);
    spawnEnemy(world.state.run, "owl", 601, 0);
    step(world);
    expect(world.state.run.zones).toHaveLength(0);
    world.state.run.enemies[0].x = 600;
    step(world, ticksOf(2));
    expect(world.state.run.zones).toHaveLength(1);
    expect(world.state.run.zones[0].radius).toBe(60);
  });
});

describe("Shard", () => {
  it("flies in the facing direction at level 1 with no enemy", () => {
    const world = playing(["shard", 1]);
    step(world);
    expect(world.state.run.projectiles).toEqual([
      expect.objectContaining({
        weapon: "shard",
        vx: 500,
        vy: 0,
        ax: 0,
        ay: 0,
        radius: 8,
        damage: 8,
        ttl: 3,
        pierce: INFINITE_PIERCE,
      }),
    ]);
    expect(world.state.run.weapons[0].cooldown).toBe(2.5);
  });

  it("aims at the nearest enemy and fans three shards at level 8", () => {
    const world = playing(["shard", 8]);
    spawnEnemy(world.state.run, "owl", 0, 300);
    step(world);
    const shards = world.state.run.projectiles;
    expect(shards).toHaveLength(3);
    const angles = shards.map(
      (shard) => (Math.atan2(shard.vy, shard.vx) * 180) / Math.PI,
    );
    expect(angles[0]).toBeCloseTo(75, 9);
    expect(angles[1]).toBeCloseTo(90, 9);
    expect(angles[2]).toBeCloseTo(105, 9);
    for (const shard of shards) {
      expect(Math.hypot(shard.vx, shard.vy)).toBeCloseTo(600, 9);
    }
    expect(shards[0]).toMatchObject({ radius: 10, damage: 20, ttl: 5 });
    expect(world.state.run.weapons[0].cooldown).toBe(1.8);
  });
});

describe("Sconce", () => {
  it("launches toward the nearest enemy, decelerating, at level 1", () => {
    const world = playing(["sconce", 1]);
    spawnEnemy(world.state.run, "owl", 400, 0);
    step(world);
    expect(world.state.run.projectiles).toEqual([
      expect.objectContaining({
        weapon: "sconce",
        vx: 600,
        vy: 0,
        ax: -600,
        ay: 0,
        radius: 12,
        damage: 12,
        ttl: 2.5,
        pierce: INFINITE_PIERCE,
      }),
    ]);
    expect(world.state.run.weapons[0].cooldown).toBe(2);
  });

  it("fans four sconces at level 8", () => {
    const world = playing(["sconce", 8]);
    spawnEnemy(world.state.run, "owl", -400, 0);
    step(world);
    const sconces = world.state.run.projectiles;
    const angles = sconces.map(
      (sconce) => (Math.atan2(sconce.vy, sconce.vx) * 180) / Math.PI,
    );
    expect(angles.map((angle) => Math.round(angle))).toEqual([
      150, 170, -170, -150,
    ]);
    for (const sconce of sconces) {
      expect(Math.hypot(sconce.ax, sconce.ay)).toBeCloseTo(600, 9);
      expect(sconce.ax * sconce.vx + sconce.ay * sconce.vy).toBeLessThan(0);
    }
    expect(sconces[0]).toMatchObject({ radius: 16, damage: 30, ttl: 2.5 });
    expect(world.state.run.weapons[0].cooldown).toBe(1.4);
  });
});

describe("Flare", () => {
  it("bursts on every enemy within radius at level 1, sparing the Dark", () => {
    const world = playing(["flare", 1]);
    const near = spawnEnemy(world.state.run, "owl", 640, 0);
    const far = spawnEnemy(world.state.run, "owl", 641, 0);
    const dark = spawnEnemy(world.state.run, "dark", 100, 0);
    step(world);
    expect(world.state.run.zones).toEqual([
      expect.objectContaining({
        weapon: "flare",
        kind: "burst",
        x: 0,
        y: 0,
        radius: 640,
        damage: 100,
        ttl: 0.4,
      }),
    ]);
    expect(near.hp).toBe(1900);
    expect(far.hp).toBe(2000);
    expect(dark.hp).toBe(10000);
    expect(world.state.run.weapons[0].cooldown).toBe(60);
    step(world, 23);
    expect(world.state.run.zones).toHaveLength(1);
    expect(near.hp).toBe(1900);
    step(world);
    expect(world.state.run.zones).toHaveLength(0);
  });

  it("reads the level 8 row and ignores amount", () => {
    const world = playing(["flare", 8]);
    hold(world, "mirror", 2);
    const owl = spawnEnemy(world.state.run, "owl", 0, 500);
    step(world);
    expect(world.state.run.zones).toHaveLength(1);
    expect(world.state.run.zones[0]).toMatchObject({ damage: 500 });
    expect(owl.hp).toBe(1500);
    expect(world.state.run.weapons[0].cooldown).toBe(40);
  });
});

describe("the evolved forms", () => {
  it("Pyre slashes both sides on every firing", () => {
    const world = playing(["pyre", 1]);
    step(world);
    expect(
      world.state.run.zones.map((zone) => [zone.x, zone.width, zone.height]),
    ).toEqual([
      [100, 200, 60],
      [-100, 200, 60],
    ]);
    expect(world.state.run.zones[0].damage).toBe(60);
    expect(world.state.run.weapons[0].cooldown).toBe(1.2);
  });

  it("Beacon fires its fixed bolt at the nearest enemy", () => {
    const world = playing(["beacon", 1]);
    spawnEnemy(world.state.run, "owl", 0, -300);
    step(world);
    expect(world.state.run.projectiles).toEqual([
      expect.objectContaining({
        vx: 0,
        vy: -500,
        radius: 10,
        damage: 20,
        pierce: 2,
        ttl: 2,
      }),
    ]);
    expect(world.state.run.weapons[0].cooldown).toBe(0.25);
  });

  it("Hail fires six darts, with Mirror on top", () => {
    const world = playing(["hail", 1]);
    step(world);
    expect(world.state.run.projectiles.map((dart) => dart.y)).toEqual([
      -25, -15, -5, 5, 15, 25,
    ]);
    expect(world.state.run.projectiles[0]).toMatchObject({
      vx: 700,
      radius: 7,
      damage: 15,
      pierce: 3,
      ttl: 1.5,
    });
    hold(world, "mirror", 2);
    world.state.run.projectiles = [];
    step(world, 30);
    expect(world.state.run.projectiles).toHaveLength(8);
  });

  it("Corona pulses its fixed aura every half second", () => {
    const world = playing(["corona", 1]);
    const owl = spawnEnemy(world.state.run, "owl", 150, 0);
    step(world);
    expect(world.state.run.zones[0]).toMatchObject({
      weapon: "corona",
      kind: "aura",
      radius: 150,
      damage: 12,
      ttl: null,
    });
    expect(owl.hp).toBe(1988);
    step(world, 29);
    expect(owl.hp).toBe(1988);
    step(world);
    expect(owl.hp).toBe(1976);
  });

  it("Blaze lands five puddles on its fixed row", () => {
    const world = playing(["blaze", 1]);
    step(world);
    expect(world.state.run.zones).toHaveLength(5);
    expect(world.state.run.zones[0]).toMatchObject({
      weapon: "blaze",
      kind: "puddle",
      radius: 70,
      damage: 8,
      ttl: 4,
      pulse: 0.2,
    });
    expect(world.state.run.weapons[0].cooldown).toBe(2);
  });

  it("Chandelier holds its timer at 0 and fires nothing", () => {
    const world = playing(["chandelier", 1]);
    world.state.run.weapons[0].cooldown = 0.5;
    step(world, 3);
    expect(world.state.run.weapons[0].cooldown).toBe(0);
    expect(world.state.run.zones).toHaveLength(4);
    expect(world.state.run.nextId).toBe(4);
  });
});

describe("the debug pose of a projectile", () => {
  it("reads the level held, or level 1 and the fixed row when not held", () => {
    const world = playing(["pin", 8]);
    hold(world, "glass", 1);
    hold(world, "wick", 1);
    const run = world.state.run;
    const posed = [
      ["pin", 7 * 1.1, 15 * 1.1],
      ["ember", 8 * 1.1, 10 * 1.1],
      ["beacon", 10 * 1.1, 20 * 1.1],
    ] as const;
    for (const [id, radius, damage] of posed) {
      const bolt = makeProjectile(run, id, 0, 0, 1, 0, 0);
      expect(bolt.radius, id).toBeCloseTo(radius, 9);
      expect(bolt.damage, id).toBeCloseTo(damage, 9);
    }
  });
});

describe("the base weapon ids", () => {
  it("name the ten weapons in table order", () => {
    const ids: BaseWeaponId[] = [
      "taper",
      "ember",
      "pin",
      "lantern",
      "halo",
      "oil-splash",
      "spark",
      "shard",
      "sconce",
      "flare",
    ];
    expect([...BASE_WEAPON_IDS]).toEqual(ids);
    for (const id of ids) expect(WEAPON_LEVELS[id]).toHaveLength(8);
  });
});
