// The state contract: the world's game state, its title-screen values, and the
// one field derived beside them.

import { describe, expect, it } from "vitest";
import { DIFFICULTY_TABLE, START_LIVES } from "./constants";
import { BACKGROUND, MeltdownState, game, meltdownState } from "./game";
import { createHarness, poseTower, startRun } from "./harness";

describe("the game definition", () => {
  it("registers one level and opens it", () => {
    expect(Object.keys(game.levels)).toEqual(["floor"]);
    expect(game.startLevel).toBe("floor");
    expect(BACKGROUND).toMatch(/^rgb\(/);
  });

  it("names MeltdownState as the world's game state", async () => {
    const harness = await createHarness();
    expect(harness.engine.world.state).toBeInstanceOf(MeltdownState);
    expect(meltdownState(harness.engine.world)).toBe(
      harness.engine.world.state,
    );
    harness.dispose();
  });

  it("refuses a world that does not hold one", () => {
    const wrong = { state: {} } as unknown as Parameters<
      typeof meltdownState
    >[0];
    expect(() => meltdownState(wrong)).toThrow(/MeltdownState/);
  });
});

describe("the declared fields", () => {
  it("opens on its title-screen values, every one of them present", () => {
    const state = new MeltdownState();
    expect(state).toMatchObject({
      screen: "title",
      phase: "opening",
      menuIndex: 0,
      mode: "containment",
      difficulty: "medium",
      money: DIFFICULTY_TABLE.medium.money,
      lives: START_LIVES,
      score: 0,
      wave: 1,
      buildTimer: 0,
      wavePending: 0,
      spawnClock: 0,
      speed: 1,
      selected: null,
      hoverShop: null,
      build: null,
      waveSpawning: true,
      spawnVent: null,
      muted: false,
      nextId: 1,
      simTime: 0,
    });
    expect(state.towers).toEqual([]);
    expect(state.surge).toEqual([]);
    expect(state.pointer).toEqual({ x: 0, y: 0, down: false });
  });

  it("rebuilds its routes from the towers rather than storing them", async () => {
    const harness = await createHarness();
    startRun(harness);
    const state = meltdownState(harness.engine.world);
    const open = state.routes.lengths.left;
    const id = poseTower(harness, "lance", 20, 16, 0);
    expect(state.routes.lengths.left).toBeGreaterThan(open);
    harness.debug.removeTower(id);
    expect(state.routes.lengths.left).toBe(open);
    harness.dispose();
  });

  it("hands every new entity an id no live entity holds", async () => {
    const harness = await createHarness();
    startRun(harness);
    const ids = new Set<number>();
    for (let index = 0; index < 6; index += 1) {
      ids.add(poseTower(harness, "arc", 2 + index * 3, 2, 0));
      harness.debug.addUnit("mote", "left");
      const surge = harness.debug.snapshot().surge;
      ids.add(surge[surge.length - 1].id);
    }
    expect(ids.size).toBe(12);
    harness.dispose();
  });

  it("keeps an entity's id for its whole life", async () => {
    const harness = await createHarness();
    startRun(harness);
    const first = poseTower(harness, "arc", 4, 4, 0);
    const second = poseTower(harness, "arc", 8, 4, 0);
    harness.debug.removeTower(first);
    const third = poseTower(harness, "arc", 12, 4, 0);
    const towers = harness.debug.snapshot().towers;
    expect(towers.map((tower) => tower.id)).toEqual([second, third]);
    expect(third).not.toBe(first);
    harness.dispose();
  });
});
