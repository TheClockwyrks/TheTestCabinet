import { describe, expect, it } from "vitest";
import {
  DESPAWN_DISTANCE,
  ENEMIES,
  EVENTS,
  HP_SCALE_PER_MINUTE,
  SPAWN_DISTANCE,
  SPAWN_WINDOW,
  SPAWN_WINDOWS,
  SWARM_LINE,
  SWARM_SIZE,
  TICK_DT,
  TICK_HZ,
  type CueName,
  type EnemyId,
} from "../constants";
import { Rng } from "../rng";
import { freshRun, initialState, type Draft } from "../state";
import { NOTHING_HELD } from "./context";
import { LAST_WINDOW, aliveCommons, spawnEnemy, windowOfTick } from "./enemies";
import { distance } from "./geometry";
import { tick } from "./tick";
import { makeProjectile } from "./weapons";

/** A run in which nothing moves, fires, or hits; the director alone runs. */
function playing(): { state: Draft; rng: Rng; cues: Set<CueName> } {
  const state = initialState();
  state.run = freshRun();
  state.screen = "playing";
  state.enemyMotion = false;
  state.enemyContact = false;
  state.weaponFire = false;
  return { state, rng: new Rng(), cues: new Set() };
}

function step(world: ReturnType<typeof playing>, ticks = 1): void {
  for (let i = 0; i < ticks; i += 1) {
    world.cues.clear();
    tick(world.state, world.rng, NOTHING_HELD, world.cues);
  }
}

/** Put the clock at the tick before `seconds`, so one tick lands on it. */
function before(world: ReturnType<typeof playing>, seconds: number): void {
  world.state.run.tick = seconds * TICK_HZ - 1;
}

describe("the windows", () => {
  it("index the night in SPAWN_WINDOW steps, the last running to dawn", () => {
    expect(SPAWN_WINDOWS).toHaveLength(LAST_WINDOW + 1);
    expect(windowOfTick(0)).toBe(0);
    expect(windowOfTick(SPAWN_WINDOW * TICK_HZ - 1)).toBe(0);
    expect(windowOfTick(SPAWN_WINDOW * TICK_HZ)).toBe(1);
    expect(windowOfTick(19 * SPAWN_WINDOW * TICK_HZ)).toBe(19);
    expect(windowOfTick(20 * SPAWN_WINDOW * TICK_HZ)).toBe(19);
    expect(SPAWN_WINDOWS[0]).toEqual({ types: ["moth"], interval: 1, cap: 20 });
    expect(SPAWN_WINDOWS[19]).toEqual({
      types: ["hound", "shade", "spider"],
      interval: 0.1,
      cap: 200,
    });
    for (let i = 1; i < SPAWN_WINDOWS.length; i += 1) {
      expect(SPAWN_WINDOWS[i].interval).toBeLessThanOrEqual(
        SPAWN_WINDOWS[i - 1].interval,
      );
      expect(SPAWN_WINDOWS[i].cap).toBeGreaterThanOrEqual(
        SPAWN_WINDOWS[i - 1].cap,
      );
    }
  });

  it("spawn on the first tick, then every interval, on the ring", () => {
    const world = playing();
    const { run } = world.state;
    run.player.x = 1000;
    run.player.y = -200;
    step(world);
    expect(run.enemies).toHaveLength(1);
    expect(run.enemies[0].type).toBe("moth");
    expect(distance(run.enemies[0], run.player)).toBeCloseTo(SPAWN_DISTANCE, 9);
    expect(run.spawnTimer).toBe(SPAWN_WINDOWS[0].interval);
    step(world, 59);
    expect(run.enemies).toHaveLength(1);
    expect(run.spawnTimer).toBeCloseTo(TICK_DT, 12);
    step(world);
    expect(run.spawnTimer).toBe(SPAWN_WINDOWS[0].interval);
    expect(run.enemies).toHaveLength(2);
    expect(run.enemies[1].id).toBe(1);
  });

  it("choose a type uniformly from the window's row", () => {
    const seen = new Set<EnemyId>();
    for (let night = 1; night <= 5; night += 1) {
      const world = playing();
      const { run } = world.state;
      run.tick = 2 * SPAWN_WINDOW * TICK_HZ;
      step(world, 3 * TICK_HZ);
      for (const enemy of run.enemies) seen.add(enemy.type);
    }
    expect([...seen].sort()).toEqual(["bat", "moth", "rat"]);
  });

  it("reset the timer on the first tick of a new window", () => {
    const world = playing();
    const { run } = world.state;
    run.tick = SPAWN_WINDOW * TICK_HZ - 2;
    run.spawnTimer = 0.9;
    step(world);
    expect(run.enemies).toHaveLength(0);
    expect(run.spawnTimer).toBeCloseTo(0.9 - TICK_DT, 12);
    step(world);
    expect(run.tick).toBe(SPAWN_WINDOW * TICK_HZ);
    expect(run.enemies).toHaveLength(1);
    expect(run.spawnTimer).toBe(SPAWN_WINDOWS[1].interval);
  });

  it("scale the spawn's health by the clock", () => {
    const world = playing();
    world.state.events = false;
    before(world, 60);
    step(world);
    const [spawned] = world.state.run.enemies;
    expect(spawned.maxHp).toBeCloseTo(
      ENEMIES[spawned.type].hp * (1 + HP_SCALE_PER_MINUTE),
      12,
    );
  });
});

describe("the cap", () => {
  it("rests the timer at 0 when full and spawns on the first tick with room", () => {
    const world = playing();
    const { run } = world.state;
    for (let i = 0; i < SPAWN_WINDOWS[0].cap; i += 1) {
      spawnEnemy(run, "moth", 800, 0);
    }
    step(world, 5);
    expect(run.enemies).toHaveLength(SPAWN_WINDOWS[0].cap);
    expect(run.spawnTimer).toBe(0);
    run.enemies.pop();
    step(world);
    expect(run.enemies).toHaveLength(SPAWN_WINDOWS[0].cap);
    expect(run.spawnTimer).toBe(SPAWN_WINDOWS[0].interval);
  });

  it("counts commons other than gnats, never the elites or the Dark", () => {
    const world = playing();
    const { run } = world.state;
    for (let i = 0; i < SPAWN_WINDOWS[0].cap - 1; i += 1) {
      spawnEnemy(run, "bat", 800, 0);
    }
    for (let i = 0; i < 5; i += 1) spawnEnemy(run, "gnat", 800, 0);
    spawnEnemy(run, "mothwing", 800, 0);
    spawnEnemy(run, "owl", 800, 0);
    spawnEnemy(run, "dark", 800, 0);
    expect(aliveCommons(run)).toBe(SPAWN_WINDOWS[0].cap - 1);
    step(world);
    expect(aliveCommons(run)).toBe(SPAWN_WINDOWS[0].cap);
    step(world, 120);
    expect(aliveCommons(run)).toBe(SPAWN_WINDOWS[0].cap);
  });
});

describe("with spawning off", () => {
  it("holds the timer, a window change included, and lands nothing", () => {
    const world = playing();
    world.state.spawning = false;
    const { run } = world.state;
    run.tick = SPAWN_WINDOW * TICK_HZ - 5;
    run.spawnTimer = 0.5;
    step(world, 10);
    expect(run.enemies).toHaveLength(0);
    expect(run.spawnTimer).toBe(0.5);
    world.state.spawning = true;
    step(world, 29);
    expect(run.enemies).toHaveLength(0);
    step(world);
    expect(run.enemies).toHaveLength(1);
  });
});

describe("the scripted events", () => {
  it("are seven, in time order, each firing on its exact tick once", () => {
    expect(
      EVENTS.map((event) => [
        event.time,
        event.kind === "swarm" ? "swarm" : event.type,
      ]),
    ).toEqual([
      [60, "swarm"],
      [120, "mothwing"],
      [240, "swarm"],
      [300, "mothwing"],
      [420, "swarm"],
      [450, "owl"],
      [540, "dark"],
    ]);
    const world = playing();
    world.state.spawning = false;
    const { run } = world.state;
    run.tick = 120 * TICK_HZ - 2;
    step(world);
    expect(run.enemies).toHaveLength(0);
    expect(run.firedEvents).toEqual([]);
    step(world);
    expect(run.enemies.map((enemy) => enemy.type)).toEqual(["mothwing"]);
    expect(run.firedEvents).toEqual([120]);
    before(world, 120);
    step(world);
    expect(run.enemies).toHaveLength(1);
    expect(run.firedEvents).toEqual([120]);
  });

  it("spawn the second Mothwing beside the first, then the Owl and the Dark", () => {
    const world = playing();
    world.state.spawning = false;
    const { run } = world.state;
    for (const seconds of [120, 300, 450, 540]) {
      before(world, seconds);
      step(world);
    }
    expect(run.enemies.map((enemy) => enemy.type)).toEqual([
      "mothwing",
      "mothwing",
      "owl",
      "dark",
    ]);
    for (const enemy of run.enemies) {
      expect(distance(enemy, run.player)).toBeCloseTo(SPAWN_DISTANCE, 9);
      expect(enemy.maxHp).toBe(ENEMIES[enemy.type].hp);
    }
    expect(run.firedEvents).toEqual([120, 300, 450, 540]);
  });

  it("lay a gnat swarm across a line facing the lamplighter", () => {
    const world = playing();
    world.state.spawning = false;
    const { run } = world.state;
    run.player.x = 250;
    run.player.y = -75;
    before(world, 60);
    step(world);
    const gnats = run.enemies;
    expect(gnats).toHaveLength(SWARM_SIZE);
    expect(gnats.every((gnat) => gnat.type === "gnat")).toBe(true);
    expect(run.firedEvents).toEqual([60]);
    const heading = gnats[0].heading;
    for (const gnat of gnats) {
      expect(gnat.heading).toEqual(heading);
      expect(gnat.maxHp).toBeCloseTo(
        ENEMIES.gnat.hp * (1 + HP_SCALE_PER_MINUTE),
        12,
      );
    }
    const d = { x: -heading.x, y: -heading.y };
    const center = {
      x: gnats.reduce((sum, gnat) => sum + gnat.x, 0) / SWARM_SIZE,
      y: gnats.reduce((sum, gnat) => sum + gnat.y, 0) / SWARM_SIZE,
    };
    expect(center.x).toBeCloseTo(run.player.x + d.x * SPAWN_DISTANCE, 9);
    expect(center.y).toBeCloseTo(run.player.y + d.y * SPAWN_DISTANCE, 9);
    const first = gnats[0];
    const last = gnats[SWARM_SIZE - 1];
    expect(distance(first, last)).toBeCloseTo(SWARM_LINE, 9);
    const spacing = SWARM_LINE / (SWARM_SIZE - 1);
    for (let i = 1; i < SWARM_SIZE; i += 1) {
      expect(distance(gnats[i - 1], gnats[i])).toBeCloseTo(spacing, 9);
      const along = { x: gnats[i].x - first.x, y: gnats[i].y - first.y };
      expect(along.x * d.x + along.y * d.y).toBeCloseTo(0, 9);
    }
    expect(gnats.map((gnat) => gnat.id)).toEqual(
      gnats.map((_, i) => gnats[0].id + i),
    );
  });

  it("drift the swarm across the lamplighter's position and on past it", () => {
    const world = playing();
    world.state.spawning = false;
    world.state.enemyMotion = true;
    const { run } = world.state;
    before(world, 60);
    step(world);
    const middle = run.enemies[Math.floor(SWARM_SIZE / 2)];
    const crossing = Math.round(
      (SPAWN_DISTANCE / ENEMIES.gnat.speed) * TICK_HZ,
    );
    step(world, crossing);
    expect(distance(middle, run.player)).toBeLessThan(SWARM_LINE / 2);
    step(world, TICK_HZ);
    expect(distance(middle, run.player)).toBeGreaterThan(
      ENEMIES.gnat.speed - 1,
    );
  });

  it("never fire while events is off or when the clock skips their tick", () => {
    const world = playing();
    world.state.spawning = false;
    world.state.events = false;
    const { run } = world.state;
    before(world, 60);
    step(world);
    expect(run.enemies).toHaveLength(0);
    expect(run.firedEvents).toEqual([]);
    world.state.events = true;
    step(world);
    expect(run.enemies).toHaveLength(0);
    run.tick = 120 * TICK_HZ;
    step(world, 5);
    expect(run.enemies).toHaveLength(0);
    expect(run.firedEvents).toEqual([]);
  });

  it("record the fired times ascending whatever order the clock met them", () => {
    const world = playing();
    world.state.spawning = false;
    const { run } = world.state;
    before(world, 120);
    step(world);
    before(world, 60);
    step(world);
    expect(run.firedEvents).toEqual([60, 120]);
  });
});

describe("despawning", () => {
  it("removes a common beyond DESPAWN_DISTANCE with no kill, gem, or cue", () => {
    const world = playing();
    world.state.spawning = false;
    const { run } = world.state;
    const far = spawnEnemy(run, "moth", DESPAWN_DISTANCE + 1, 0);
    const edge = spawnEnemy(run, "moth", DESPAWN_DISTANCE, 0);
    const gnat = spawnEnemy(run, "gnat", 0, -DESPAWN_DISTANCE - 50);
    run.projectiles.push(makeProjectile(run, "ember", 0, 0, 0, 0, 0));
    run.projectiles[0].hits.push({ enemy: far.id, cooldown: 1 });
    step(world);
    expect(run.enemies).toEqual([edge]);
    expect(run.kills).toBe(0);
    expect(run.gems).toEqual([]);
    expect(world.cues.has("kill")).toBe(false);
    expect(run.projectiles[0].hits).toEqual([]);
    expect(gnat.id).toBe(2);
  });

  it("leaves the elites and the Dark at any distance", () => {
    const world = playing();
    world.state.spawning = false;
    const { run } = world.state;
    spawnEnemy(run, "mothwing", 5000, 0);
    spawnEnemy(run, "owl", -5000, 0);
    spawnEnemy(run, "dark", 0, 5000);
    step(world, 10);
    expect(run.enemies.map((enemy) => enemy.type)).toEqual([
      "mothwing",
      "owl",
      "dark",
    ]);
  });

  it("removes nothing while despawning is off", () => {
    const world = playing();
    world.state.spawning = false;
    world.state.despawning = false;
    const { run } = world.state;
    spawnEnemy(run, "rat", 3000, 0);
    step(world, 10);
    expect(run.enemies).toHaveLength(1);
    world.state.despawning = true;
    step(world);
    expect(run.enemies).toHaveLength(0);
  });
});

describe("dawn", () => {
  it("ends the run on tick DAWN_TICK with the director's spawns on the field", () => {
    const world = playing();
    const { run } = world.state;
    run.tick = 600 * TICK_HZ - 2;
    step(world);
    expect(run.enemies).toHaveLength(1);
    step(world);
    expect(world.state.screen).toBe("dawn");
    expect(run.tick).toBe(600 * TICK_HZ);
    expect(run.enemies.length).toBeGreaterThanOrEqual(1);
  });
});

describe("the posed angles", () => {
  it("place the next window spawn at nextSpawnAngle and consume it", () => {
    const world = playing();
    const { run } = world.state;
    run.player.x = 100;
    run.player.y = -50;
    run.nextSpawnAngle = 90;
    step(world);
    expect(run.enemies).toHaveLength(1);
    expect(run.enemies[0].x).toBeCloseTo(100, 9);
    expect(run.enemies[0].y).toBeCloseTo(-50 + SPAWN_DISTANCE, 9);
    expect(run.nextSpawnAngle).toBeNull();
  });

  it("place the next scripted elite at nextSpawnAngle", () => {
    const world = playing();
    world.state.spawning = false;
    const { run } = world.state;
    run.nextSpawnAngle = 180;
    before(world, 120);
    step(world);
    expect(run.enemies.map((enemy) => enemy.type)).toEqual(["mothwing"]);
    expect(run.enemies[0].x).toBeCloseTo(-SPAWN_DISTANCE, 9);
    expect(run.enemies[0].y).toBeCloseTo(0, 9);
    expect(run.nextSpawnAngle).toBeNull();
  });

  it("lay the next swarm along nextSwarmAngle and consume it", () => {
    const world = playing();
    world.state.spawning = false;
    const { run } = world.state;
    run.nextSwarmAngle = 0;
    run.nextSpawnAngle = 90;
    before(world, 60);
    step(world);
    expect(run.enemies).toHaveLength(SWARM_SIZE);
    for (const gnat of run.enemies) {
      expect(gnat.x).toBeCloseTo(SPAWN_DISTANCE, 9);
      expect(gnat.heading.x).toBeCloseTo(-1, 12);
    }
    const ys = run.enemies.map((gnat) => gnat.y).sort((a, b) => a - b);
    expect(ys[0]).toBeCloseTo(-SWARM_LINE / 2, 9);
    expect(ys[SWARM_SIZE - 1]).toBeCloseTo(SWARM_LINE / 2, 9);
    expect(run.nextSwarmAngle).toBeNull();
    // A swarm draws no spawn point, so the posed spawn angle stands.
    expect(run.nextSpawnAngle).toBe(90);
  });
});
