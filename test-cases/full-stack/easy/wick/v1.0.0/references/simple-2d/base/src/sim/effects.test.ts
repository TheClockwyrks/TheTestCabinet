import { describe, expect, it } from "vitest";
import {
  BREAD_CHANCE,
  DRAFT_CHANCE,
  TICK_DT,
  type CueName,
} from "../constants";
import { Rng } from "../rng";
import { freshRun, initialState, type Draft } from "../state";
import { NOTHING_HELD } from "./context";
import { spawnEnemy } from "./enemies";
import { tick } from "./tick";
import { makeProjectile, makePuddle } from "./weapons";

/** A `playing` run drawing from `source`, `Math.random` unless given. */
function playing(source?: () => number): {
  state: Draft;
  rng: Rng;
  cues: Set<CueName>;
} {
  const state = initialState();
  state.run = freshRun();
  state.screen = "playing";
  state.enemyMotion = false;
  state.enemyContact = false;
  state.weaponFire = false;
  // The director would put a moth on the ring and draw its angle.
  state.spawning = false;
  return { state, rng: new Rng(source), cues: new Set() };
}

/** A source handing out `values` in order, then the last one for ever. */
function draws(...values: number[]): () => number {
  let at = 0;
  return () => {
    const value = values[Math.min(at, values.length - 1)];
    at += 1;
    return value;
  };
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
    run.nextDrop = "bread";
    step(world);
    expect(run.kills).toBe(2);
    expect(run.pickups).toEqual([{ id: 2, kind: "chest", x: 400, y: 0 }]);
    expect(run.gems).toEqual([]);
    // Neither death rolls, so the posed drop stands for the next common kill.
    expect(run.nextDrop).toBe("bread");
  });

  it("leaves a posed drop standing while drops is off", () => {
    const world = playing();
    world.state.drops = false;
    const { run } = world.state;
    run.nextDrop = "draft";
    spawnEnemy(run, "rat", 500, 0).hp = 0;
    step(world);
    expect(run.kills).toBe(1);
    expect(run.gems).toEqual([]);
    expect(run.pickups).toEqual([]);
    expect(run.nextDrop).toBe("draft");
  });

  /** What one rat kill drops under `source`, and the pose it leaves. */
  function killDrops(
    source: () => number,
    posed: "bread" | "draft" | "none" | null = null,
  ): { kind: string; posed: string | null } {
    const world = playing(source);
    const { run } = world.state;
    run.nextDrop = posed;
    spawnEnemy(run, "rat", 500, 0).hp = 0;
    step(world);
    expect(run.pickups.length).toBeLessThanOrEqual(1);
    expect(run.gems).toHaveLength(1);
    return { kind: run.pickups[0]?.kind ?? "none", posed: run.nextDrop };
  }

  it("rolls bread below BREAD_CHANCE, then a draft below DRAFT_CHANCE", () => {
    expect(killDrops(draws(BREAD_CHANCE - 1e-9, 0)).kind).toBe("bread");
    expect(killDrops(draws(BREAD_CHANCE, DRAFT_CHANCE - 1e-9)).kind).toBe(
      "draft",
    );
    expect(killDrops(draws(BREAD_CHANCE, DRAFT_CHANCE)).kind).toBe("none");
    expect(killDrops(draws(0.5, 0.5)).kind).toBe("none");
  });

  it("drops what nextDrop posed, in place of the roll, and consumes it", () => {
    // A source that would drop bread on its own; the pose overrides it.
    const bread = draws(0);
    expect(killDrops(bread, "draft")).toEqual({ kind: "draft", posed: null });
    expect(killDrops(bread, "none")).toEqual({ kind: "none", posed: null });
    expect(killDrops(draws(0.5), "bread")).toEqual({
      kind: "bread",
      posed: null,
    });
  });
});
