import { describe, expect, it } from "vitest";
import { BREAD_CHANCE, TICK_DT, type CueName } from "../constants";
import { Rng } from "../rng";
import { NOTHING_HELD, freshRun, initialState, type WickState } from "../state";
import { spawnEnemy } from "./enemies";
import { tick } from "./tick";
import { makeProjectile, makePuddle } from "./weapons";

function playing(): { state: WickState; rng: Rng; cues: Set<CueName> } {
  const state = initialState(1);
  state.run = freshRun();
  state.screen = "playing";
  state.enemyMotion = false;
  state.enemyContact = false;
  state.weaponFire = false;
  // The director would put a moth on the ring and draw its angle.
  state.spawning = false;
  return { state, rng: new Rng(() => state), cues: new Set() };
}

function step(world: ReturnType<typeof playing>, ticks = 1): void {
  for (let i = 0; i < ticks; i += 1) {
    world.cues.clear();
    tick(world.state, world.rng, NOTHING_HELD, world.cues);
  }
}

describe("expiry", () => {
  it("removes a projectile on the tick its ttl is due and counts re-hit entries", () => {
    const world = playing();
    const { run } = world.state;
    const bolt = makeProjectile(run, "ember", 0, 0, 0, 0, 0);
    bolt.hits.push({ enemy: 3, cooldown: 0.5 });
    run.projectiles.push(bolt);
    step(world, 119);
    expect(run.projectiles).toHaveLength(1);
    expect(bolt.ttl).toBeCloseTo(TICK_DT, 9);
    expect(bolt.hits[0].cooldown).toBe(0);
    step(world);
    expect(run.projectiles).toHaveLength(0);
  });

  it("keeps a zone with a null ttl and expires a puddle by its duration", () => {
    const world = playing();
    const { run } = world.state;
    run.zones.push(makePuddle(run, "oil-splash", 10, 10));
    run.weapons.push({ id: "halo", level: 1, cooldown: 0, cooldownSet: 0 });
    run.zones.push({
      id: run.nextId,
      weapon: "halo",
      kind: "aura",
      x: 0,
      y: 0,
      radius: 80,
      damage: 3,
      ttl: null,
      hits: [{ enemy: 1, cooldown: 0.1 }],
      bornTick: run.tick,
    });
    step(world, 150);
    expect(run.zones).toHaveLength(1);
    expect(run.zones[0].kind).toBe("aura");
    expect(run.zones[0].hits[0].cooldown).toBe(0);
  });

  it("leaves a shape created this tick to count from the next", () => {
    const world = playing();
    const { run } = world.state;
    run.tick = 5;
    const bolt = makeProjectile(run, "pin", 0, 0, 100, 0, 1);
    run.projectiles.push(bolt);
    expect(bolt.bornTick).toBe(5);
    run.tick = 4;
    step(world);
    expect(bolt.ttl).toBe(1.5);
    expect(bolt.x).toBe(0);
    step(world);
    expect(bolt.ttl).toBeCloseTo(1.5 - TICK_DT, 9);
    expect(bolt.x).toBeCloseTo(100 * TICK_DT, 9);
  });
});

describe("deaths", () => {
  it("counts the kill, drops the gem, leaves a puff, and sounds kill", () => {
    const world = playing();
    const { run } = world.state;
    const moth = spawnEnemy(run, "moth", 300, 0);
    moth.hp = 0;
    const hound = spawnEnemy(run, "hound", -300, 0);
    hound.hp = -4;
    const alive = spawnEnemy(run, "bat", 0, 300);
    step(world);
    expect(run.enemies).toEqual([alive]);
    expect(run.kills).toBe(2);
    expect(
      run.gems.map((gem) => [gem.tier, gem.x, gem.y, gem.attracted]),
    ).toEqual([
      ["small", 300, 0, false],
      ["large", -300, 0, false],
    ]);
    expect(run.puffs.map((puff) => [puff.x, puff.y, puff.bornTick])).toEqual([
      [300, 0, 1],
      [-300, 0, 1],
    ]);
    expect(world.cues.has("kill")).toBe(true);
    step(world, 24);
    expect(run.puffs).toHaveLength(0);
  });

  it("drops a chest from an elite and nothing from the Dark", () => {
    const world = playing();
    const { run } = world.state;
    spawnEnemy(run, "owl", 400, 0).hp = 0;
    spawnEnemy(run, "dark", -400, 0).hp = 0;
    const rngBefore = world.state.rngState;
    step(world);
    expect(run.kills).toBe(2);
    expect(run.pickups).toEqual([{ id: 2, kind: "chest", x: 400, y: 0 }]);
    expect(run.gems).toEqual([]);
    expect(world.state.rngState).toBe(rngBefore);
  });

  it("rolls bread, then a draft, at most one per common kill", () => {
    const counts = { bread: 0, draft: 0, none: 0 };
    for (let seed = 1; seed <= 400; seed += 1) {
      const world = playing();
      world.state.rngState = seed;
      const { run } = world.state;
      spawnEnemy(run, "rat", 500, 0).hp = 0;
      step(world);
      expect(run.pickups.length).toBeLessThanOrEqual(1);
      const kind = run.pickups[0]?.kind ?? "none";
      counts[kind as keyof typeof counts] += 1;
    }
    expect(counts.bread).toBeGreaterThan(0);
    expect(counts.bread).toBeLessThan(400 * BREAD_CHANCE * 4);
    expect(counts.none).toBeGreaterThan(350);
  });
});
