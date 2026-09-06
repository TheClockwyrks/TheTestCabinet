import { describe, expect, it } from "vitest";
import {
  BASE_MAX_HP,
  BREAD_HEAL,
  COLLECT_RADIUS,
  GEM_SPEED,
  PICKUP_ITEM_RADIUS,
  PICKUP_RADIUS,
  PLAYER_RADIUS,
  TICK_DT,
  type CueName,
  type GemTier,
  type PickupKind,
} from "../constants";
import { Rng } from "../rng";
import { freshRun, initialState, type Draft } from "../state";
import { NOTHING_HELD } from "./context";
import { tick } from "./tick";

function playing(): { state: Draft; rng: Rng; cues: Set<CueName> } {
  const state = initialState();
  state.run = freshRun();
  state.screen = "playing";
  return { state, rng: new Rng(), cues: new Set() };
}

function step(world: ReturnType<typeof playing>, ticks = 1): void {
  for (let i = 0; i < ticks; i += 1) {
    world.cues.clear();
    tick(world.state, world.rng, NOTHING_HELD, world.cues);
  }
}

function gem(
  world: ReturnType<typeof playing>,
  tier: GemTier,
  x: number,
  y = 0,
) {
  const { run } = world.state;
  const placed = { id: run.nextId, tier, x, y, attracted: false, bornTick: -1 };
  run.nextId += 1;
  run.gems.push(placed);
  return placed;
}

function pickup(
  world: ReturnType<typeof playing>,
  kind: PickupKind,
  x: number,
) {
  const { run } = world.state;
  run.pickups.push({ id: run.nextId, kind, x, y: 0 });
  run.nextId += 1;
}

describe("gems", () => {
  it("attracts a gem at most pickupRadius away and leaves one beyond", () => {
    const world = playing();
    const inside = gem(world, "small", PICKUP_RADIUS);
    const outside = gem(world, "small", PICKUP_RADIUS + 0.01);
    step(world);
    expect(outside.attracted).toBe(false);
    expect(outside.x).toBe(PICKUP_RADIUS + 0.01);
    expect(inside.attracted).toBe(true);
    expect(inside.x).toBeCloseTo(PICKUP_RADIUS - GEM_SPEED * TICK_DT, 9);
  });

  it("flies at GEM_SPEED, stops at the center, and is collected within COLLECT_RADIUS", () => {
    const world = playing();
    const far = gem(world, "medium", 300);
    far.attracted = true;
    step(world);
    expect(far.x).toBeCloseTo(300 - GEM_SPEED * TICK_DT, 9);
    step(world, 28);
    expect(far.x).toBeCloseTo(300 - 29 * GEM_SPEED * TICK_DT, 6);
    step(world);
    expect(world.state.run.gems).toHaveLength(0);
    expect(world.state.run.xp).toBe(3);
    expect(world.cues.has("gem")).toBe(true);
  });

  it("collects a gem sitting within COLLECT_RADIUS without attraction", () => {
    const world = playing();
    gem(world, "large", COLLECT_RADIUS);
    world.state.run.level = 50;
    step(world);
    expect(world.state.run.gems).toHaveLength(0);
    expect(world.state.run.xp).toBe(10);
  });

  it("scales experience by Soot and queues level-ups", () => {
    const world = playing();
    world.state.run.passives.push({ id: "soot", level: 5 });
    gem(world, "large", 0);
    step(world);
    expect(world.state.run.level).toBe(2);
    expect(world.state.run.xp).toBeCloseTo(15 - 5, 9);
    expect(world.state.run.pendingLevelUps).toBe(1);
    expect(world.state.screen).toBe("levelup");
  });

  it("widens the radius with Lure", () => {
    const world = playing();
    world.state.run.passives.push({ id: "lure", level: 4 });
    const placed = gem(world, "small", 96);
    step(world);
    expect(placed.attracted).toBe(true);
  });
});

describe("pickups", () => {
  it("collects bread within PICKUP_ITEM_RADIUS + PLAYER_RADIUS and heals, capped", () => {
    const world = playing();
    world.state.run.player.hp = 90;
    pickup(world, "bread", PICKUP_ITEM_RADIUS + PLAYER_RADIUS);
    step(world);
    expect(world.state.run.pickups).toHaveLength(1);
    world.state.run.pickups[0].x -= 0.01;
    step(world);
    expect(world.state.run.pickups).toHaveLength(0);
    expect(world.state.run.player.hp).toBe(BASE_MAX_HP);
    expect(world.cues.has("pickup")).toBe(true);
    world.state.run.player.hp = 10;
    pickup(world, "bread", 0);
    step(world);
    expect(world.state.run.player.hp).toBe(10 + BREAD_HEAL);
  });

  it("attracts every gem on a draft, and they fly on the same tick", () => {
    const world = playing();
    const a = gem(world, "small", 500);
    const b = gem(world, "small", -900, 200);
    pickup(world, "draft", 0);
    step(world);
    expect(a.attracted).toBe(true);
    expect(b.attracted).toBe(true);
    expect(a.x).toBeCloseTo(500 - GEM_SPEED * TICK_DT, 9);
  });

  it("opens the chest overlay on the collecting tick, lowest id first", () => {
    const world = playing();
    pickup(world, "chest", 0);
    pickup(world, "chest", 0);
    step(world);
    expect(world.state.screen).toBe("chest");
    expect(world.state.run.chestResult).toEqual({
      kind: "level",
      item: "taper",
      level: 2,
    });
    expect(world.state.run.pickups).toHaveLength(1);
    expect(world.state.run.pickups[0].id).toBe(1);
    expect(world.cues.has("chest")).toBe(true);
  });

  it("lets a chest take the overlay ahead of a level-up on the same tick", () => {
    const world = playing();
    world.state.run.pendingLevelUps = 1;
    pickup(world, "chest", 0);
    step(world);
    expect(world.state.screen).toBe("chest");
    expect(world.state.run.pendingLevelUps).toBe(1);
  });
});
