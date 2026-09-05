// The game, stood up on a real engine and driven the way a player drives it.
//
// Everything here runs against `createHarness`: a real `createEngine` over an
// `@napi-rs/canvas` canvas and a `SurfaceMetrics` of the test's own, stepped
// with `engine.advance` against a `ConstantClock`, with keys and the pointer
// dispatched as real events at the surface's event target. What is asserted is
// what the engine holds afterwards — the world's `FacetState`, the debug
// surface `initialize` returned, the cues the bus emitted, and the pixels the
// render produced.

import { describe, expect, it } from "vitest";
import { createHarness, FRAME_MS, type Harness } from "./harness";
import { assetManifest, assets } from "./assets";
import { cellCenter } from "./core";
import {
  GRID_COLS,
  GRID_ROWS,
  LAND_MIN_ROWS,
  LEVEL_TARGET_STEP,
  STEP_SECONDS,
  SWAP_SECONDS,
} from "./constants";
import { quietRowsWith } from "./core/fixtures";

/**
 * The quiet board with a three-ruby row one swap away: exchanging `(1, 1)`
 * with `(1, 0)` puts a third ruby in the top row and clears exactly those
 * three. Nothing else on the quiet board carries a run or a productive swap,
 * so the scenario is the swap and nothing else.
 */
const ONE_RUN = quietRowsWith({ "2,0": "R0", "1,1": "R0" });
const ONE_RUN_SWAP = { a: { col: 1, row: 1 }, b: { col: 1, row: 0 } };

/**
 * A board whose first step sets off a second: exchanging `(3, 6)` with
 * `(4, 6)` completes a vertical ruby run down column 3, and the jades that
 * fall three cells into row 7 land beside the two already there.
 */
const CASCADE = quietRowsWith({
  "3,4": "J0",
  "3,5": "R0",
  "3,6": "C0",
  "3,7": "R0",
  "4,6": "R0",
  "2,7": "J0",
  "4,7": "J0",
});
const CASCADE_SWAP = { a: { col: 3, row: 6 }, b: { col: 4, row: 6 } };

/** Frames enough to carry an accepted swap into its first chain step. */
const SWAP_FRAMES = Math.ceil(SWAP_SECONDS / (FRAME_MS / 1000)) + 1;

/**
 * A round begun the way a caller begins one, out of the surface's
 * single-element operations: the surface carries no operation that arranges a
 * whole round at once (specs/instrumentation.md).
 */
function startRound(harness: Harness): void {
  const d = harness.debug;
  d.setScore(0);
  d.setLevel(1);
  d.setLevelScore(0);
  d.setMoveScore(0);
  d.setBestMove(0);
  d.setBestChain(0);
  d.clearSelection();
  d.clearOffer();
  d.clearRefusal();
  d.clearChain();
  d.dealBoard();
  d.setMenuIndex(0);
  d.setScreen("playing");
}

describe("the engine stands the game up", () => {
  it("opens on the title screen with no board in play", async () => {
    const harness = await createHarness();
    try {
      expect(harness.state.screen).toBe("title");
      expect(harness.state.menuIndex).toBe(0);
      expect(harness.state.board).toEqual({ cols: 0, rows: 0, cells: [] });
      expect(harness.state.phase).toBe("idle");
      expect(harness.debug.version).toBe(1);
    } finally {
      harness.dispose();
    }
  });

  it("loads every produced file the manifest names", async () => {
    const harness = await createHarness();
    try {
      const manifest = assetManifest();
      const total =
        Object.keys(manifest.images).length +
        Object.keys(manifest.systems).length;
      expect(assets().failures()).toEqual([]);
      expect(assets().loaded()).toBe(total);
      expect(assets().image("gem:ruby:0")).not.toBeNull();
      expect(assets().system("clear-burst")?.emitters.length).toBeGreaterThan(
        0,
      );
    } finally {
      harness.dispose();
    }
  });

  it("serves the committed tree, and 404s a path that is not in it", async () => {
    const harness = await createHarness();
    try {
      expect((await fetch("assets/gems/frame.png")).ok).toBe(true);
      expect((await fetch("assets/gems/nothing.png")).status).toBe(404);
    } finally {
      harness.dispose();
    }
  });

  it("reads a held key as one press, and releases it", async () => {
    const harness = await createHarness();
    try {
      harness.hold("ArrowDown");
      await harness.advance(1);
      await harness.advance(1);
      // An edge is armed once per press, however long the key is held.
      expect(harness.state.menuIndex).toBe(1);
      harness.release("ArrowDown");
      harness.hold("ArrowDown");
      await harness.advance(1);
      expect(harness.state.menuIndex).toBe(0);
      harness.release("ArrowDown");
    } finally {
      harness.dispose();
    }
  });

  it("accumulates simTime from the frames it is advanced", async () => {
    const harness = await createHarness();
    try {
      await harness.advance(30);
      expect(harness.state.simTime).toBeCloseTo((30 * FRAME_MS) / 1000, 6);
      // The framework's own match clock stays at rest: Facet runs its screens
      // on `screen` and never calls `setPhase` (specs/state.md).
      expect(harness.state.elapsed).toBe(0);
    } finally {
      harness.dispose();
    }
  });

  it("draws the title screen onto the canvas", async () => {
    const harness = await createHarness();
    try {
      await harness.advance(1);
      // The heading is drawn across the top of the stage in the theme's gold,
      // and the stage corner carries the ground alone. If nothing drew, the
      // brightest pixel of the heading band would be the ground too.
      const heading = harness.brightest(340, 110, 600, 84);
      expect(heading[0]).toBeGreaterThan(200);
      expect(heading[2]).toBeLessThan(heading[0]);
      expect(harness.pixel(6, 6)[0]).toBeLessThan(60);
      // And the row of stones under it is drawn from the produced sprites.
      expect(harness.litPixels(330, 300, 620, 70, 90)).toBeGreaterThan(2000);
    } finally {
      harness.dispose();
    }
  });
});

describe("the keyboard drives the menus", () => {
  it("walks the title menu to HOW TO PLAY and back", async () => {
    const harness = await createHarness();
    try {
      harness.tap("ArrowDown");
      await harness.advance(1);
      expect(harness.state.menuIndex).toBe(1);

      harness.tap("Enter");
      await harness.advance(1);
      expect(harness.state.screen).toBe("howto");

      // `back` puts a player who came in to read the rules back on the item
      // they came in through (specs/ui.md).
      harness.tap("Escape");
      await harness.advance(1);
      expect(harness.state.screen).toBe("title");
      expect(harness.state.menuIndex).toBe(1);
    } finally {
      harness.dispose();
    }
  });

  it("acts on every armed action in one frame, in order", async () => {
    const harness = await createHarness();
    try {
      // Both edges arrive between two frames. A build that acted on one
      // action per frame would swallow the `confirm` entirely.
      harness.tap("ArrowDown");
      harness.tap("Enter");
      await harness.advance(1);
      expect(harness.state.screen).toBe("howto");
    } finally {
      harness.dispose();
    }
  });

  it("starts a round from PLAY, on a legal opening board", async () => {
    const harness = await createHarness();
    try {
      harness.tap("Enter");
      await harness.advance(1);

      const shot = harness.debug.snapshot();
      expect(shot.screen).toBe("playing");
      expect(shot.board.cells).toHaveLength(GRID_COLS * GRID_ROWS);
      expect(shot.legalSwap).toBe(true);
      expect(shot.score).toBe(0);
      expect(shot.level).toBe(1);
      expect(shot.levelTarget).toBe(LEVEL_TARGET_STEP);
      // The opening board holds no run, so nothing is resolving on it.
      expect(shot.phase).toBe("idle");
      expect(shot.selection).toBeNull();
      // The whole board is dealt in from above (specs/rules.md).
      expect(shot.board.cells.every((cell) => cell.fell >= cell.row + 1)).toBe(
        true,
      );
    } finally {
      harness.dispose();
    }
  });

  it("wraps the menu highlight at both ends", async () => {
    const harness = await createHarness();
    try {
      harness.tap("ArrowUp");
      await harness.advance(1);
      expect(harness.state.menuIndex).toBe(1);

      harness.tap("ArrowDown");
      await harness.advance(1);
      expect(harness.state.menuIndex).toBe(0);
    } finally {
      harness.dispose();
    }
  });

  it("pauses, resumes, and quits from the keyboard", async () => {
    const harness = await createHarness();
    try {
      startRound(harness);
      harness.tap("KeyP");
      await harness.advance(1);
      expect(harness.state.screen).toBe("paused");

      harness.tap("Escape");
      await harness.advance(1);
      expect(harness.state.screen).toBe("playing");

      harness.tap("KeyP");
      harness.tap("ArrowDown");
      harness.tap("Enter");
      await harness.advance(1);
      expect(harness.state.screen).toBe("title");
    } finally {
      harness.dispose();
    }
  });

  it("toggles the engine's mute bit and mirrors it into the state", async () => {
    const harness = await createHarness();
    try {
      harness.tap("KeyM");
      await harness.advance(1);
      expect(harness.engine.world.audio.muted()).toBe(true);
      expect(harness.state.muted).toBe(true);

      harness.tap("KeyM");
      await harness.advance(1);
      expect(harness.state.muted).toBe(false);
    } finally {
      harness.dispose();
    }
  });
});

describe("the pointer plays the board", () => {
  it("selects a cell on a press and swaps on a press beside it", async () => {
    const harness = await createHarness();
    try {
      startRound(harness);
      harness.debug.loadBoard(ONE_RUN);

      const [ax, ay] = cellCenter(ONE_RUN_SWAP.a);
      harness.pointer("pointerdown", ax, ay);
      harness.pointer("pointerup", ax, ay);
      await harness.advance(1);
      expect(harness.state.selection).toEqual(ONE_RUN_SWAP.a);
      expect(harness.state.offer).toBeNull();

      // A press on the neighbor offers the held stone into it, and the
      // release is what plays the move.
      const [bx, by] = cellCenter(ONE_RUN_SWAP.b);
      harness.pointer("pointerdown", bx, by);
      await harness.advance(1);
      expect(harness.state.offer).toEqual(ONE_RUN_SWAP.b);
      expect(harness.state.phase).toBe("idle");

      harness.pointer("pointerup", bx, by);
      await harness.advance(1);
      expect(harness.state.selection).toBeNull();
      expect(harness.state.offer).toBeNull();
      expect(harness.state.phase).toBe("swapping");

      await harness.advance(SWAP_FRAMES);
      expect(harness.state.lastCleared).toBe(3);
      expect(harness.state.lastPoints).toBe(30);
      expect(harness.cues.map((play) => play.cue)).toContain("swap");
      expect(harness.cues.map((play) => play.cue)).toContain("clear");
    } finally {
      harness.dispose();
    }
  });

  it("requests the swap from a drag onto the neighboring cell", async () => {
    const harness = await createHarness();
    try {
      startRound(harness);
      harness.debug.loadBoard(ONE_RUN);
      const [ax, ay] = cellCenter(ONE_RUN_SWAP.a);
      const [bx, by] = cellCenter(ONE_RUN_SWAP.b);

      harness.pointer("pointerdown", ax, ay);
      harness.pointer("pointermove", bx, by);
      harness.pointer("pointerup", bx, by);
      await harness.advance(1);
      expect(harness.state.phase).toBe("swapping");

      await harness.advance(SWAP_FRAMES);
      expect(harness.state.phase).toBe("resolving");
      expect(harness.state.lastCleared).toBe(3);
      expect(harness.state.selection).toBeNull();
    } finally {
      harness.dispose();
    }
  });

  it("plays nothing when the hold is carried back where it started", async () => {
    const harness = await createHarness();
    try {
      startRound(harness);
      harness.debug.loadBoard(ONE_RUN);
      const [ax, ay] = cellCenter(ONE_RUN_SWAP.a);
      const [bx, by] = cellCenter(ONE_RUN_SWAP.b);

      harness.pointer("pointerdown", ax, ay);
      harness.pointer("pointermove", bx, by);
      harness.pointer("pointermove", ax, ay);
      harness.pointer("pointerup", ax, ay);
      await harness.advance(SWAP_FRAMES + 4);

      expect(harness.state.phase).toBe("idle");
      expect(harness.state.offer).toBeNull();
      expect(harness.state.lastCleared).toBe(0);
      expect(harness.state.refusal).toBeNull();
    } finally {
      harness.dispose();
    }
  });

  it("works a screen's targets with a finger, arming and taking", async () => {
    const harness = await createHarness();
    try {
      const play = harness.debug.snapshot().targets[0];
      const cx = play.x + play.w / 2;
      const cy = play.y + play.h / 2;

      harness.pointer("pointerdown", cx, cy, "touch");
      await harness.advance(1);
      expect(harness.state.armedTarget).toBe("menu-0");
      expect(harness.state.pointer.device).toBe("touch");

      harness.pointer("pointerup", cx, cy, "touch");
      await harness.advance(1);
      expect(harness.state.screen).toBe("playing");
      expect(harness.state.armedTarget).toBeNull();

      // And the `pause` control on `playing` is worked the same way.
      const pause = harness.debug.snapshot().targets[0];
      expect(pause.id).toBe("pause");
      harness.pointer("pointerdown", pause.x + 4, pause.y + 4, "touch");
      harness.pointer("pointerup", pause.x + 4, pause.y + 4, "touch");
      await harness.advance(1);
      expect(harness.state.screen).toBe("paused");
    } finally {
      harness.dispose();
    }
  });

  it("mirrors the engine's pointer snapshot into the state", async () => {
    const harness = await createHarness();
    try {
      harness.pointer("pointerdown", 120, 240, "pen");
      await harness.advance(1);
      expect(harness.state.pointer).toEqual({
        x: 120,
        y: 240,
        down: true,
        device: "pen",
      });

      harness.pointer("pointerup", 120, 240, "pen");
      await harness.advance(1);
      expect(harness.state.pointer.down).toBe(false);
    } finally {
      harness.dispose();
    }
  });

  it("marks a refused swap on its two cells and drops the mark in time", async () => {
    const harness = await createHarness();
    try {
      startRound(harness);
      harness.debug.loadBoard(quietRowsWith({}));
      const [ax, ay] = cellCenter({ col: 2, row: 2 });
      const [bx, by] = cellCenter({ col: 3, row: 2 });
      harness.pointer("pointerdown", ax, ay);
      harness.pointer("pointermove", bx, by);
      harness.pointer("pointerup", bx, by);
      await harness.advance(1);

      expect(harness.state.refusal).not.toBeNull();
      expect(harness.state.refusal?.a).toEqual({ col: 2, row: 2 });
      expect(harness.cues.map((play) => play.cue)).toContain("refuse");

      // REFUSAL_SECONDS is 0.3, which is 18 frames at a sixtieth each.
      await harness.advance(20);
      expect(harness.state.refusal).toBeNull();
    } finally {
      harness.dispose();
    }
  });
});

describe("a chain runs as the frames advance", () => {
  it("carries a chain from one step to the next on the step timer", async () => {
    const harness = await createHarness();
    try {
      startRound(harness);
      harness.debug.loadBoard(CASCADE);
      harness.debug.requestSwap(
        CASCADE_SWAP.a.col,
        CASCADE_SWAP.a.row,
        CASCADE_SWAP.b.col,
        CASCADE_SWAP.b.row,
      );
      expect(harness.state.phase).toBe("swapping");

      // The swap runs SWAP_SECONDS before its first step resolves.
      await harness.advance(SWAP_FRAMES);
      expect(harness.state.chainStep).toBe(1);
      expect(harness.state.lastCleared).toBe(3);

      // A step holds for as long as what it set in motion takes — the waves
      // it shattered in, the rows its gems fell, and then a rest — and the
      // snapshot reports that figure (specs/rules.md).
      const hold = harness.debug.snapshot().stepHold;
      expect(hold).toBeGreaterThan(STEP_SECONDS);
      await harness.advance(Math.ceil(hold / (FRAME_MS / 1000)) + 1);
      expect(harness.state.chainStep).toBeGreaterThanOrEqual(2);

      // And the chain eventually settles with every cell filled.
      await harness.advance(120);
      expect(harness.state.phase).toBe("idle");
      expect(harness.state.board.cells).toHaveLength(GRID_COLS * GRID_ROWS);
    } finally {
      harness.dispose();
    }
  });

  it("reaches the same state from one long frame as from sixty short ones", async () => {
    const run = async (frames: number, stepMs: number): Promise<unknown> => {
      const harness = await createHarness();
      try {
        harness.debug.reset({ seed: 7 });
        startRound(harness);
        harness.debug.requestSwap(0, 0, 1, 0);
        harness.engine.setClock({ delta: () => stepMs });
        await harness.advance(frames);
        const shot = harness.debug.snapshot();
        return {
          rngState: shot.rngState,
          score: shot.score,
          phase: shot.phase,
          board: shot.board.cells.map((cell) => `${cell.kind}${cell.strain}`),
        };
      } finally {
        harness.dispose();
      }
    };
    expect(await run(1, 1000)).toEqual(await run(60, 1000 / 60));
  });

  it("ends the round when the board settles with no legal swap", async () => {
    const harness = await createHarness();
    try {
      // The quiet board carries no productive swap at all, so the round ends
      // as soon as a chain settles on a refill that plants none either. The
      // seed is the one this scenario is written against: the deal is a pure
      // function of `rngState`, so the outcome is exact rather than likely.
      harness.debug.reset({ seed: 1 });
      // The screen alone, not `startRound`: opening a round deals a board, and
      // that deal would draw `rngState` off the seed this scenario is written
      // against before the refill below ever reads it.
      harness.debug.setScreen("playing");
      harness.debug.loadBoard(ONE_RUN);
      harness.debug.requestSwap(
        ONE_RUN_SWAP.a.col,
        ONE_RUN_SWAP.a.row,
        ONE_RUN_SWAP.b.col,
        ONE_RUN_SWAP.b.row,
      );
      await harness.advance(180);
      expect(harness.state.screen).toBe("gameover");
      expect(harness.state.phase).toBe("idle");
      expect(harness.debug.snapshot().legalSwap).toBe(false);
      expect(harness.cues.map((play) => play.cue)).toContain("gameover");
    } finally {
      harness.dispose();
    }
  });
});

describe("the audio bus", () => {
  it("loops one bed on every screen and swaps it with the screen", async () => {
    const harness = await createHarness();
    try {
      await harness.advance(1);
      expect(harness.engine.world.audio.looping("music-title")).toBe(true);
      expect(harness.engine.world.audio.looping("music-play")).toBe(false);

      startRound(harness);
      await harness.advance(1);
      expect(harness.engine.world.audio.looping("music-play")).toBe(true);
      expect(harness.engine.world.audio.looping("music-title")).toBe(false);

      // The play bed carries `levelclear` too, so one of the two sounds on
      // every screen (specs/ui.md).
      harness.debug.loadBoard(ONE_RUN);
      harness.debug.setLevelScore(LEVEL_TARGET_STEP);
      harness.debug.requestSwap(
        ONE_RUN_SWAP.a.col,
        ONE_RUN_SWAP.a.row,
        ONE_RUN_SWAP.b.col,
        ONE_RUN_SWAP.b.row,
      );
      await harness.advance(180);
      expect(harness.state.screen).toBe("levelclear");
      expect(harness.engine.world.audio.looping("music-play")).toBe(true);
      expect(harness.cues.map((play) => play.cue)).toContain("levelup");
    } finally {
      harness.dispose();
    }
  });

  it("plays a cue once per frame however many times its event happened", async () => {
    const harness = await createHarness();
    try {
      // One frame long enough to cross the swap and both of the chain's
      // steps: a build that played a cue per event rather than per frame
      // would sound `clear` twice on it.
      startRound(harness);
      harness.debug.loadBoard(CASCADE);
      harness.debug.requestSwap(
        CASCADE_SWAP.a.col,
        CASCADE_SWAP.a.row,
        CASCADE_SWAP.b.col,
        CASCADE_SWAP.b.row,
      );
      harness.cues.length = 0;
      harness.engine.setClock({ delta: () => 2000 });
      await harness.advance(1);

      expect(harness.state.chainStep).toBe(0);
      const clears = harness.cues.filter((play) => play.cue === "clear");
      expect(clears).toHaveLength(1);
      // The ladder sounds the rung of the deepest step that cleared.
      expect(harness.cues.map((play) => play.cue)).toContain("chain-2");
    } finally {
      harness.dispose();
    }
  });

  it("sounds the landing when a step's gems fell far enough", async () => {
    const harness = await createHarness();
    try {
      // The cascade drops a column three rows, which is past LAND_MIN_ROWS.
      startRound(harness);
      harness.debug.loadBoard(CASCADE);
      harness.debug.requestSwap(
        CASCADE_SWAP.a.col,
        CASCADE_SWAP.a.row,
        CASCADE_SWAP.b.col,
        CASCADE_SWAP.b.row,
      );
      harness.cues.length = 0;
      await harness.advance(SWAP_FRAMES);
      expect(harness.debug.snapshot().lastFall).toBeGreaterThan(LAND_MIN_ROWS);
      expect(harness.cues.map((play) => play.cue)).not.toContain("land");

      await harness.advance(30);
      expect(harness.cues.map((play) => play.cue)).toContain("land");
    } finally {
      harness.dispose();
    }
  });

  it("plays no cue for a pose of the debug surface", async () => {
    const harness = await createHarness();
    try {
      await harness.advance(1);
      startRound(harness);
      harness.cues.length = 0;
      harness.debug.loadBoard(ONE_RUN);
      harness.debug.requestSwap(
        ONE_RUN_SWAP.a.col,
        ONE_RUN_SWAP.a.row,
        ONE_RUN_SWAP.b.col,
        ONE_RUN_SWAP.b.row,
      );
      expect(harness.state.phase).toBe("swapping");
      expect(harness.cues).toEqual([]);
    } finally {
      harness.dispose();
    }
  });
});
