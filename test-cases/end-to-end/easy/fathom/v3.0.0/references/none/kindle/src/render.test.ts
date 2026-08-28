import { describe, expect, it } from "vitest";

import { board, SEALED_DEN, stamp } from "./board.test-support";
import {
  GRID_COLS,
  GRID_ORIGIN_X,
  GRID_ORIGIN_Y,
  TICK_HZ,
  TILE,
} from "./constants";
import { poseMaze, type FathomState } from "./game";
import {
  harness,
  stageContext,
  stubAssets,
  type Harness,
} from "./harness.test-support";
import { Maze } from "./maze";
import { render } from "./render";
import { tileKey } from "./sensing";
import type { Screen } from "./types";

const SCREENS: readonly Screen[] = [
  "title",
  "howto",
  "countdown",
  "playing",
  "paused",
  "cleared",
  "gameover",
];

/** Draw one state through a real 2D context and read pixels back off it. */
function drawn(state: FathomState, alpha = 0): ReturnType<typeof stageContext> {
  const surface = stageContext();
  render(state, surface.ctx, alpha);
  return surface;
}

/** The device pixel at the center of a tile, the stage being drawn 1:1. */
function tileCenter(col: number, row: number): [number, number] {
  return [
    GRID_ORIGIN_X + col * TILE + TILE / 2,
    GRID_ORIGIN_Y + row * TILE + TILE / 2,
  ];
}

/** How far apart two sampled pixels are, of the 441 the RGB cube spans. */
function apart(a: readonly number[], b: readonly number[]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/**
 * Live play over one straight corridor, with the forager parked and unfed, so
 * the brightness is `0` and the vision circle stands at KINDLE_VISION_MIN.
 */
function dim(col: number): Harness {
  const h = harness();
  h.state.screen = "playing";
  h.state.creatureAI = false;
  poseMaze(h.state, stamp(board([".".repeat(30)], 8, 3), SEALED_DEN, 1, 16));
  h.state.forager.placeOn(col, 8);
  // The mouthful underfoot would brighten the forager and widen the circle.
  h.state.plankton[tileKey(col, 8)] = false;
  h.advance(1);
  return h;
}

describe("render", () => {
  it("draws every screen without failing", () => {
    const h = harness();
    for (const screen of SCREENS) {
      h.state.screen = screen;
      expect(() => h.draw()).not.toThrow();
    }
  });

  it("draws the same picture whatever order the screens were drawn in", () => {
    const h = harness();
    h.state.screen = "gameover";
    const first = drawn(h.state).read(640, 360);
    h.state.screen = "title";
    drawn(h.state);
    h.state.screen = "gameover";
    expect(drawn(h.state).read(640, 360)).toEqual(first);
  });

  it("draws an unrevealed tile as flat darkness", () => {
    const h = harness();
    h.state.screen = "playing";
    const surface = drawn(h.state);
    const [x, y] = tileCenter(1, 1);
    const [r, g, b] = surface.read(x, y);
    expect(Math.max(r, g, b)).toBeLessThanOrEqual(25);
  });

  it("draws the HUD over the four screens the maze stands behind", () => {
    const h = harness();
    for (const screen of [
      "countdown",
      "playing",
      "paused",
      "cleared",
    ] as const) {
      h.state.screen = screen;
      const surface = drawn(h.state);
      // The score's own strip, above the maze region.
      let ink = 0;
      for (let x = 40; x < 200; x += 2) {
        for (let y = 20; y < 70; y += 2) {
          if (surface.read(x, y)[0] > 60) ink += 1;
        }
      }
      expect(ink).toBeGreaterThan(0);
    }
  });

  it("leaves the HUD strips clear on the screens with no maze", () => {
    const h = harness();
    h.state.screen = "title";
    const surface = drawn(h.state);
    let ink = 0;
    for (let x = 40; x < 200; x += 2) {
      for (let y = 20; y < 70; y += 2) {
        if (surface.read(x, y)[0] > 60) ink += 1;
      }
    }
    expect(ink).toBe(0);
  });

  it("lights the pocket around the forager and leaves the rest dark", () => {
    const h = harness();
    h.state.screen = "playing";
    poseMaze(h.state, stamp(board([".".repeat(30)], 8, 3), SEALED_DEN, 1, 16));
    h.state.forager.placeOn(10, 8);
    h.advance(1);
    const surface = drawn(h.state);
    const near = surface.read(...tileCenter(11, 8));
    const far = surface.read(...tileCenter(28, 8));
    expect(Math.max(...near.slice(0, 3))).toBeGreaterThan(
      Math.max(...far.slice(0, 3)),
    );
  });

  it("draws a live sonar wavefront in the corridor it is washing down", () => {
    const h = harness();
    h.state.screen = "playing";
    poseMaze(h.state, stamp(board([".".repeat(30)], 8, 3), SEALED_DEN, 1, 16));
    h.state.forager.placeOn(10, 8);
    h.press("a");
    h.advance(Math.round(TICK_HZ * 0.3));
    const withPulse = drawn(h.state).read(...tileCenter(14, 8));
    h.state.waves = [];
    const without = drawn(h.state).read(...tileCenter(14, 8));
    expect(withPulse[2]).toBeGreaterThan(without[2]);
  });

  it("draws an ink cloud darker than the water it stands in", () => {
    const h = harness();
    h.state.screen = "playing";
    poseMaze(h.state, stamp(board([".".repeat(30)], 8, 3), SEALED_DEN, 1, 16));
    h.state.forager.placeOn(10, 8);
    h.advance(1);
    const clear = drawn(h.state).read(...tileCenter(11, 8));
    h.state.ink.release(Maze.centerX(11), Maze.centerY(8));
    const inked = drawn(h.state).read(...tileCenter(11, 8));
    expect(inked[1]).toBeLessThan(clear[1]);
  });

  it("draws the amber mote of a loose Lanternjaw inside the circle", () => {
    const h = dim(3);
    const lanternjaw = h.state.predators[0];
    lanternjaw.state = "wander";
    // Five tiles out: past the light pocket, inside the vision circle.
    lanternjaw.placeOn(8, 8);
    const [x, y] = tileCenter(8, 8);
    const surface = drawn(h.state);
    // The core is a bright light where the fog has revealed nothing.
    expect(Math.max(...surface.read(x, y).slice(0, 3))).toBeGreaterThan(200);
    // Its halo is warm and red-leaning, told apart from the cool water.
    const [r, g, b] = surface.read(x + 6, y);
    expect(r).toBeGreaterThan(b);
    expect(g).toBeGreaterThan(b);
  });

  it("clips an amber light beyond the circle away with the ground round it", () => {
    const h = dim(3);
    const lanternjaw = h.state.predators[0];
    lanternjaw.state = "wander";
    // Ten tiles out, well beyond KINDLE_VISION_MIN's six.
    lanternjaw.placeOn(13, 8);
    const surface = drawn(h.state);
    const fog = surface.read(...tileCenter(1, 1));
    for (let dx = -12; dx <= 12; dx += 2) {
      const [x, y] = tileCenter(13, 8);
      expect(apart(surface.read(x + dx, y), fog)).toBeLessThanOrEqual(25);
    }
  });

  it("draws revealed ground inside the circle and flat fog beyond it", () => {
    const h = dim(10);
    expect(h.state.forager.brightness).toBe(0);
    // The circle is six tiles: column 15 is five tiles out, column 18 eight.
    for (const col of [15, 18]) h.state.fog.reveal(col, 8);
    const surface = drawn(h.state);
    const fog = surface.read(...tileCenter(1, 1));
    expect(apart(surface.read(...tileCenter(15, 8)), fog)).toBeGreaterThan(25);
    expect(apart(surface.read(...tileCenter(18, 8)), fog)).toBeLessThanOrEqual(
      25,
    );
  });

  it("hides remembered ground beyond the circle without forgetting it", () => {
    const h = dim(10);
    h.state.fog.reveal(18, 8);
    const fog = drawn(h.state).read(...tileCenter(1, 1));
    expect(
      apart(drawn(h.state).read(...tileCenter(18, 8)), fog),
    ).toBeLessThanOrEqual(25);
    // Hidden, and still remembered underneath.
    expect(h.state.fog.visibility(18, 8)).toBe("remembered");
    // Swimming back within the circle draws it again, plankton and all.
    h.state.forager.placeOn(16, 8);
    expect(
      apart(drawn(h.state).read(...tileCenter(18, 8)), fog),
    ).toBeGreaterThan(25);
  });

  it("draws the maze inside a flare burning beyond the circle", () => {
    const h = dim(3);
    const flarefish = h.state.predators[2];
    flarefish.state = "wander";
    // Seventeen tiles out: the whole flare disc lies beyond the circle.
    flarefish.placeOn(20, 8);
    const fog = drawn(h.state).read(...tileCenter(1, 1));
    const sample = (): number =>
      apart(drawn(h.state).read(...tileCenter(20, 8)), fog);
    expect(sample()).toBeLessThanOrEqual(25);
    flarefish.flarePhase = "bloom";
    flarefish.flarePhaseT = 0.5;
    h.advance(1);
    expect(sample()).toBeGreaterThan(25);
    // With the bloom gone the disc goes back to the flat fog, still remembered.
    flarefish.flarePhase = "none";
    flarefish.flarePhaseT = 0;
    h.advance(1);
    expect(h.state.fog.visibility(20, 8)).toBe("remembered");
    expect(sample()).toBeLessThanOrEqual(25);
  });

  it("draws a sonar wavefront out past the circle it sweeps beyond", () => {
    const h = dim(10);
    h.press("a");
    // 0.6 s at 14 corridor steps a second: the front stands 8.4 tiles out, so
    // its crest is over the tile eight tiles along, two beyond the circle.
    h.advance(Math.round(TICK_HZ * 0.6));
    const surface = drawn(h.state);
    const fog = surface.read(...tileCenter(1, 1));
    expect(apart(surface.read(...tileCenter(18, 8)), fog)).toBeGreaterThan(25);
  });

  it("draws a burning flare's disc at full brightness through rock", () => {
    const h = harness();
    h.state.screen = "playing";
    poseMaze(h.state, stamp(board([".".repeat(30)], 8, 3), SEALED_DEN, 1, 16));
    h.state.forager.placeOn(3, 8);
    const flarefish = h.state.predators[2];
    flarefish.state = "wander";
    flarefish.placeOn(20, 8);
    const dark = drawn(h.state).read(...tileCenter(20, 8));
    flarefish.flarePhase = "bloom";
    flarefish.flarePhaseT = 0.5;
    h.advance(1);
    const lit = drawn(h.state).read(...tileCenter(20, 8));
    expect(Math.max(...lit.slice(0, 3))).toBeGreaterThan(
      Math.max(...dark.slice(0, 3)),
    );
  });

  it("draws a moving body between the two ticks either side of it", () => {
    const h = dim(10);
    h.hold("right");
    h.advance(30);
    // Everything the forager carries is stuck to it, so the far rim of the
    // drawn picture stands where the body stands. It is a whole pixel further
    // along at the end of the tick than at its start.
    const rim = (alpha: number): number => {
      const surface = stageContext();
      render(h.state, surface.ctx, alpha);
      const [, y] = tileCenter(11, 8);
      let last = GRID_ORIGIN_X;
      for (
        let x = GRID_ORIGIN_X;
        x < GRID_ORIGIN_X + GRID_COLS * TILE;
        x += 1
      ) {
        if (surface.read(x, y)[1] > 6) last = x;
      }
      return last;
    };
    expect(rim(1)).toBeGreaterThan(rim(0));
  });

  it("draws through a full dive without failing on any frame", () => {
    const h = harness();
    h.press("confirm");
    h.advance(1);
    for (let i = 0; i < 40; i += 1) {
      h.advance(30);
      expect(() => h.draw(0.5)).not.toThrow();
    }
  });

  it("needs every frame of every sheet the project ships", () => {
    const assets = stubAssets();
    expect(assets.forager).toHaveLength(8);
    expect(assets.lanternjaw).toHaveLength(16);
    expect(assets.trench).toHaveLength(19);
    expect(assets.flareBloom).toHaveLength(8);
  });
});
