import { describe, expect, it } from "vitest";
import {
  INFINITE_PIERCE,
  TICK_DT,
  type CueName,
  type WeaponId,
} from "../constants";
import { Rng } from "../rng";
import { freshRun, initialState, type Draft } from "../state";
import { NOTHING_HELD } from "./context";
import { spawnEnemy } from "./enemies";
import { tick } from "./tick";
import { makeProjectile, makePuddle } from "./weapons";

interface World {
  state: Draft;
  rng: Rng;
  cues: Set<CueName>;
}

/** A `playing` run holding `weapons`, every autonomous faculty held. */
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

function step(world: World, ticks = 1): void {
  for (let i = 0; i < ticks; i += 1) {
    world.cues.clear();
    tick(world.state, world.rng, NOTHING_HELD, world.cues);
  }
}

/** An owl with plenty of health, posed at `(x, y)`. */
function owl(
  world: World,
  x: number,
  y: number,
): ReturnType<typeof spawnEnemy> {
  return spawnEnemy(world.state.run, "owl", x, y);
}

describe("a projectile with finite pierce", () => {
  it("hits enemies in ascending id until it is removed, each at most once", () => {
    const world = playing();
    const { run } = world.state;
    const c = owl(world, 4, 0);
    const a = owl(world, -4, 0);
    const b = owl(world, 0, 4);
    run.projectiles.push(makeProjectile(run, "pin", 0, 0, 0, 0, 1));
    step(world);
    expect([c.hp, a.hp, b.hp]).toEqual([1994, 1994, 2000]);
    expect(run.projectiles).toHaveLength(0);
    expect(world.cues.has("hit")).toBe(true);
  });

  it("is removed by a hit at pierce 0, and hits a given enemy once", () => {
    const world = playing();
    const { run } = world.state;
    const target = owl(world, 0, 0);
    const bolt = makeProjectile(run, "ember", 0, 0, 0, 0, 0);
    run.projectiles.push(bolt);
    step(world);
    expect(target.hp).toBe(1990);
    expect(run.projectiles).toEqual([]);
    const dart = makeProjectile(run, "pin", 0, 0, 0, 0, 3);
    run.projectiles.push(dart);
    step(world, 10);
    expect(target.hp).toBe(1984);
    expect(dart.pierce).toBe(2);
    expect(dart.hits).toEqual([
      { enemy: 0, cooldown: expect.closeTo(1.5 - 10 * TICK_DT, 9) },
    ]);
  });

  it("kills, counting the kill and dropping the gem, and forgets the entry", () => {
    const world = playing();
    const { run } = world.state;
    // Close enough to overlap the dart, far enough that its gem is not
    // collected on the tick it drops.
    const moth = spawnEnemy(run, "moth", 12, 0);
    const dart = makeProjectile(run, "pin", 0, 0, 0, 0, 3);
    run.projectiles.push(dart);
    step(world);
    expect(run.enemies).toEqual([]);
    expect(run.kills).toBe(1);
    expect(run.gems).toEqual([
      expect.objectContaining({ tier: "small", x: 12, y: 0 }),
    ]);
    expect(dart.hits).toEqual([]);
    expect(moth.hp).toBe(-1);
    expect(world.cues.has("hit")).toBe(true);
    expect(world.cues.has("kill")).toBe(true);
  });
});

describe("a projectile with infinite pierce", () => {
  it("re-hits an enemy every SHARD_REHIT, timed from the previous hit", () => {
    const world = playing();
    const { run } = world.state;
    const target = owl(world, 0, 0);
    const shard = makeProjectile(run, "shard", 0, 0, 0, 0, INFINITE_PIERCE);
    run.projectiles.push(shard);
    step(world);
    expect(target.hp).toBe(1992);
    expect(shard.hits).toEqual([{ enemy: 0, cooldown: 0.5 }]);
    step(world, 29);
    expect(target.hp).toBe(1992);
    expect(shard.hits[0].cooldown).toBeCloseTo(TICK_DT, 9);
    step(world);
    expect(target.hp).toBe(1984);
    expect(shard.hits[0].cooldown).toBe(0.5);
    expect(shard.pierce).toBe(INFINITE_PIERCE);
    expect(run.projectiles).toEqual([shard]);
  });

  it("re-hits every SCONCE_REHIT and never loses its pierce", () => {
    // Launched at an owl sitting on its turning point, the sconce overlaps
    // it from moving tick 37 to 84: two hits, half a second apart.
    const world = playing(["sconce", 1]);
    const target = owl(world, 305, 0);
    step(world, 100);
    expect(target.hp).toBe(2000 - 12 * 2);
    const [sconce] = world.state.run.projectiles;
    expect(sconce.pierce).toBe(INFINITE_PIERCE);
    expect(sconce.hits).toEqual([{ enemy: 0, cooldown: expect.any(Number) }]);
  });
});

describe("the flashes", () => {
  it("a slash hits the enemies its rectangle overlaps on its tick alone", () => {
    const world = playing(["taper", 1]);
    const inside = owl(world, 100, 40);
    const edge = owl(world, 156, 0);
    const outside = owl(world, -50, 0);
    step(world);
    expect([inside.hp, edge.hp, outside.hp]).toEqual([1990, 2000, 2000]);
    outside.x = 60;
    step(world);
    expect([inside.hp, outside.hp]).toEqual([1990, 2000]);
  });

  it("a strike hits within its area of the target's center, on its tick alone", () => {
    const world = playing(["spark", 1]);
    // The target alone is within SPARK_RANGE; the other two sit past it.
    const target = owl(world, 599, 0);
    const near = owl(world, 639, 0);
    const far = owl(world, 640, 0);
    step(world);
    expect([target.hp, near.hp, far.hp]).toEqual([1985, 1985, 2000]);
    far.x = 300;
    step(world);
    expect(far.hp).toBe(2000);
  });

  it("a burst hits within its radius on its tick alone, the Dark excepted", () => {
    const world = playing(["flare", 3]);
    const near = owl(world, 0, 600);
    const dark = spawnEnemy(world.state.run, "dark", 0, 0);
    step(world);
    expect([near.hp, dark.hp]).toEqual([1850, 10000]);
    step(world);
    expect(near.hp).toBe(1850);
  });
});

describe("the pulsing effects", () => {
  it("a fired puddle pulses on its tick and every OIL_PULSE after", () => {
    const world = playing();
    const { run } = world.state;
    const target = owl(world, 0, 0);
    run.tick = 9;
    run.zones.push(makePuddle(run, "oil-splash", 0, 0));
    run.tick = 8;
    step(world);
    expect(target.hp).toBe(1996);
    expect(run.zones[0].pulse).toBe(0.3);
    step(world, 17);
    expect(target.hp).toBe(1996);
    step(world);
    expect(target.hp).toBe(1992);
    step(world, 18);
    expect(target.hp).toBe(1988);
    expect(run.zones[0].hits).toEqual([]);
  });

  it("a posed puddle pulses first on the next tick, Blaze every BLAZE_PULSE", () => {
    const world = playing();
    const { run } = world.state;
    const target = owl(world, 0, 0);
    run.zones.push(makePuddle(run, "blaze", 0, 0));
    expect(target.hp).toBe(2000);
    step(world);
    expect(target.hp).toBe(1992);
    step(world, 11);
    expect(target.hp).toBe(1992);
    step(world);
    expect(target.hp).toBe(1984);
  });

  it("the aura pulses only when its weapon's timer is due", () => {
    const world = playing(["halo", 1]);
    const target = owl(world, 0, 0);
    step(world);
    expect(target.hp).toBe(1997);
    world.state.run.weapons[0].cooldown = 0.05;
    step(world, 2);
    expect(target.hp).toBe(1997);
    step(world);
    expect(target.hp).toBe(1994);
    world.state.weaponFire = false;
    step(world, 200);
    expect(target.hp).toBe(1994);
  });
});

describe("the lanterns", () => {
  it("touch an enemy at most once per LANTERN_REHIT per lantern", () => {
    const world = playing(["lantern", 2]);
    world.state.effectMotion = false;
    const east = owl(world, 90, 0);
    const west = owl(world, -90, 0);
    step(world);
    expect([east.hp, west.hp]).toEqual([1990, 1990]);
    const [first, second] = world.state.run.zones;
    expect(first.hits).toEqual([{ enemy: 0, cooldown: 0.5 }]);
    expect(second.hits).toEqual([{ enemy: 1, cooldown: 0.5 }]);
    step(world, 29);
    expect(east.hp).toBe(1990);
    step(world);
    expect(east.hp).toBe(1980);
    west.x = 90;
    step(world);
    expect(west.hp).toBe(1970);
    expect(first.hits.map((hit) => hit.enemy)).toEqual([0, 1]);
  });
});

describe("the evolved heals", () => {
  it("Pyre heals one per enemy hit, capped at maxHp", () => {
    const world = playing(["pyre", 1]);
    world.state.run.player.hp = 97;
    owl(world, 50, 0);
    owl(world, -50, 0);
    owl(world, 60, 10);
    owl(world, 500, 0);
    step(world);
    expect(world.state.run.player.hp).toBe(100);
    world.state.run.player.hp = 10;
    step(world, 72);
    expect(world.state.run.player.hp).toBe(13);
  });

  it("Corona heals one per enemy a pulse kills", () => {
    const world = playing(["corona", 1]);
    // The moths die within collection distance, so the drop roll is held
    // off: a bread they rolled would be collected on the same tick and heal
    // BREAD_HEAL on top of the pulse's heal.
    world.state.drops = false;
    world.state.run.player.hp = 50;
    spawnEnemy(world.state.run, "moth", 20, 0);
    spawnEnemy(world.state.run, "moth", -20, 0);
    const bat = spawnEnemy(world.state.run, "bat", 0, 30);
    bat.hp = 12;
    owl(world, 0, -40);
    step(world);
    expect(world.state.run.kills).toBe(3);
    expect(world.state.run.player.hp).toBe(53);
  });
});

describe("the shard's bounce", () => {
  it("reverses the component across the edge it would cross, clamped to it", () => {
    const world = playing();
    const { run } = world.state;
    const shard = makeProjectile(run, "shard", 635, 0, 500, 0, INFINITE_PIERCE);
    run.projectiles.push(shard);
    step(world);
    expect(shard.x).toBe(640);
    expect(shard.vx).toBe(-500);
    step(world);
    expect(shard.x).toBeCloseTo(640 - 500 * TICK_DT, 9);
    const corner = makeProjectile(
      run,
      "shard",
      -638,
      -358,
      -600,
      -600,
      INFINITE_PIERCE,
    );
    run.projectiles.push(corner);
    step(world);
    expect([corner.x, corner.y, corner.vx, corner.vy]).toEqual([
      -640, -360, 600, 600,
    ]);
  });

  it("rides the view as the lamplighter moves", () => {
    const world = playing();
    const { run } = world.state;
    const shard = makeProjectile(run, "shard", 630, 0, 500, 0, INFINITE_PIERCE);
    run.projectiles.push(shard);
    run.player.x = 100;
    step(world);
    expect(shard.x).toBeCloseTo(630 + 500 * TICK_DT, 9);
    expect(shard.vx).toBe(500);
    step(world);
    expect(shard.x).toBeCloseTo(630 + 1000 * TICK_DT, 9);
    // The lamplighter steps back: the view's edge is now behind the shard.
    run.player.x = 0;
    step(world);
    expect(shard.x).toBe(640);
    expect(shard.vx).toBe(-500);
  });
});

describe("the sconce's return", () => {
  it("decelerates to a stop after speed / SCONCE_DECEL seconds and comes back", () => {
    const world = playing(["sconce", 1]);
    owl(world, 500, 0);
    step(world);
    const [sconce] = world.state.run.projectiles;
    step(world, 60);
    expect(sconce.vx).toBeCloseTo(0, 6);
    expect(sconce.x).toBeCloseTo(305, 6);
    step(world, 60);
    expect(sconce.vx).toBeCloseTo(-600, 6);
    expect(sconce.x).toBeCloseTo(10, 6);
    step(world, 2);
    expect(sconce.x).toBeLessThan(0);
    step(world, 150 - 122);
    // The second sconce, launched on tick 121, is the one still flying.
    expect(world.state.run.projectiles.map((flying) => flying.id)).toEqual([2]);
    expect(world.state.run.projectiles).not.toContain(sconce);
  });
});

describe("what a pose leaves alone", () => {
  it("fixes a shape's damage and lengths when it is created", () => {
    const world = playing();
    const { run } = world.state;
    const puddle = makePuddle(run, "oil-splash", 0, 0);
    run.zones.push(puddle);
    run.passives.push({ id: "wick", level: 5 }, { id: "glass", level: 5 });
    step(world);
    expect(puddle).toMatchObject({ radius: 50, damage: 4 });
  });
});
