// The game definition, the state contract, and the framework objects.

import { describe, expect, it } from "vitest";
import { GameState } from "@test-cabinet/structured-2d";
import type { World } from "@test-cabinet/structured-2d";
import { BACKGROUND, FacetState, facetState, game } from "./game";
import { Bench } from "./bench";
import { FacetController } from "./controller";
import { CURSOR_START_COL, CURSOR_START_ROW, DEFAULT_SEED } from "./constants";
import { COLOR } from "./theme";
import { createHarness } from "./harness";

describe("the definition", () => {
  it("registers one level and opens it", () => {
    expect(Object.keys(game.levels)).toEqual(["bench"]);
    expect(game.startLevel).toBe("bench");
    expect(game.instance).toBeTypeOf("function");
  });

  it("hands the engine the field's own color to clear to", () => {
    expect(BACKGROUND).toBe(COLOR.bg);
    expect(BACKGROUND).toMatch(/^#[0-9a-f]{3,8}$/i);
  });
});

describe("FacetState", () => {
  it("is the engine's game state", () => {
    expect(new FacetState()).toBeInstanceOf(GameState);
  });

  it("opens on the title-screen value of every declared field", () => {
    const state = new FacetState();
    expect(state.screen).toBe("title");
    expect(state.menuIndex).toBe(0);
    expect(state.board).toEqual({ cols: 0, rows: 0, cells: [] });
    expect(state.phase).toBe("idle");
    expect(state.chainStep).toBe(0);
    expect(state.stepTimer).toBe(0);
    expect(state.score).toBe(0);
    expect(state.level).toBe(1);
    expect(state.levelScore).toBe(0);
    expect(state.lastCleared).toBe(0);
    expect(state.lastPoints).toBe(0);
    expect(state.cursor).toEqual({
      col: CURSOR_START_COL,
      row: CURSOR_START_ROW,
    });
    expect(state.selection).toBeNull();
    expect(state.refusal).toBeNull();
    expect(state.pointer).toEqual({ x: 0, y: 0, down: false });
    expect(state.simTime).toBe(0);
    expect(state.muted).toBe(false);
    expect(state.rngState).toBe(DEFAULT_SEED);
    expect(state.chainSwap).toBeNull();
    expect(state.pressedCell).toBeNull();
    expect(state.dragSwapped).toBe(false);
  });

  it("gives every instance its own containers", () => {
    const first = new FacetState();
    const second = new FacetState();
    first.cursor.col = 5;
    first.board.cells.push({
      col: 0,
      row: 0,
      kind: "ruby",
      cut: "plain",
      strain: 0,
    });
    expect(second.cursor.col).toBe(0);
    expect(second.board.cells).toEqual([]);
  });
});

describe("facetState", () => {
  it("names a world that does not hold one rather than casting", () => {
    const wrong = { state: new GameState() } as unknown as World;
    expect(() => facetState(wrong)).toThrow(/does not hold a FacetState/);
  });
});

describe("the world the engine builds", () => {
  it("holds the state, the one player, and the bench", async () => {
    const harness = await createHarness();
    try {
      const world = harness.engine.world;
      expect(world.level).toBe("bench");
      expect(world.state).toBeInstanceOf(FacetState);
      expect(facetState(world)).toBe(world.state);
      expect(world.players()).toHaveLength(1);
      expect(world.players()[0]).toBeInstanceOf(FacetController);
      // The one player possesses nothing: the board is played through state.
      expect(world.players()[0].pawn).toBeNull();
      expect(world.ofType(Bench)).toHaveLength(1);
    } finally {
      harness.dispose();
    }
  });

  it("leaves the camera at rest, so world units are the stage's", async () => {
    const harness = await createHarness();
    try {
      const camera = harness.engine.world.camera.snapshot();
      expect(camera).toEqual({ x: 640, y: 360, zoom: 1, rotation: 0 });
      const viewport = harness.engine.viewport();
      expect(viewport.scale).toBe(1);
      expect(viewport.offsetX).toBe(0);
      expect(viewport.offsetY).toBe(0);
    } finally {
      harness.dispose();
    }
  });

  it("draws the bench through two render components, in layer order", async () => {
    const harness = await createHarness();
    try {
      const bench = harness.bench;
      expect(bench.components).toHaveLength(2);
      const layers = bench.components.map(
        (component) => (component as unknown as { layer: number }).layer,
      );
      expect(layers).toEqual([...layers].sort((a, b) => a - b));
      expect(new Set(layers).size).toBe(2);
    } finally {
      harness.dispose();
    }
  });

  it("ages what is flying in the bench's own tick", async () => {
    const harness = await createHarness();
    try {
      harness.debug.loadBoard([
        "R0 A0 R0 J0 B0 S0 M0 R0",
        "J0 R0 S0 M0 R0 A0 C0 J0",
        "M0 R0 A0 C0 J0 B0 S0 M0",
        "C0 J0 B0 S0 M0 R0 A0 C0",
        "S0 M0 R0 A0 C0 J0 B0 S0",
        "A0 C0 J0 B0 S0 M0 R0 A0",
        "B0 S0 M0 R0 A0 C0 J0 B0",
        "R0 A0 C0 J0 B0 S0 M0 R0",
      ]);
      harness.debug.requestSwap(1, 1, 1, 0);
      // The pose spawned break sheets; without a canvas to composite into
      // there are no bursts, so the sheets alone are what age away.
      expect(harness.bench.presentation.idle()).toBe(false);
      await harness.advance(60);
      expect(harness.bench.presentation.idle()).toBe(true);
    } finally {
      harness.dispose();
    }
  });
});
