// Refract under the engine, in process.
//
// Every check here runs the game through a real engine built by the harness
// in `src/harness.ts`: a `@napi-rs/canvas` canvas, a `SurfaceMetrics` of the
// suite's own, and a `ConstantClock` stepped with `engine.advance`. Keys and
// the pointer are driven by dispatching keyboard-shaped and pointer-shaped
// events at the surface's event target — the same listeners a player's input
// reaches, resolved through the player controller the game mode added — and
// what is read back is the world's own `RefractState`, the debug surface
// `initialize` returned, the engine's cue events, and the pixels the render
// produced.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cellCenter } from "./board";
import { CAMPAIGN_BOARDS } from "./campaign";
import { generateBoardWithSolution } from "./cascade";
import {
  CAMPAIGN_LENGTH,
  CUES,
  DEFAULT_SEED,
  LAYOUT,
  STAGE_H,
  STAGE_W,
} from "./constants";
import { game, RefractState } from "./game";
import { createHarness, FRAME_MS, type Harness } from "./harness";
import { CHANNEL_COLOR, rgbOf } from "./theme";
import { createCanvas } from "@napi-rs/canvas";
import { ConstantClock, createEngine } from "@test-cabinet/structured-2d";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

/** The cue names played so far, in order. */
function played(): string[] {
  return h.cues.map((play) => play.cue);
}

// ---- Boot ----------------------------------------------------------------

describe("initialization", () => {
  it("opens on the title screen with the state at rest", () => {
    expect(h.state.screen).toBe("title");
    expect(h.state.mode).toBe("campaign");
    expect(h.state.menuIndex).toBe(0);
    expect(h.state.board).toEqual({ cols: 0, rows: 0, nodes: [] });
    expect(h.state.beams).toEqual([]);
    expect(h.state.tracing).toBeNull();
  });

  it("holds the world's game state as the one RefractState instance", () => {
    expect(h.engine.world.state).toBeInstanceOf(RefractState);
    expect(h.engine.world.state).toBe(h.state);
  });

  it("adds a single player possessing nothing", () => {
    const players = h.engine.world.players();
    expect(players).toHaveLength(1);
    expect(players[0].pawn).toBeNull();
    expect(h.state.players).toHaveLength(1);
  });

  it("accumulates simTime off the clock it was given, on every screen", async () => {
    await h.engine.advance(30);
    expect(h.state.simTime).toBeCloseTo(0.5, 9);
    expect(h.engine.frame().count).toBe(30);
  });

  it("never touches the match phase: screens run on state.screen alone", async () => {
    await h.engine.advance(10);
    expect(h.state.phase).toBe("waiting");
    expect(h.state.elapsed).toBe(0);
  });

  it("refuses an engine without the layout it registers against", async () => {
    const canvas = createCanvas(STAGE_W, STAGE_H);
    const ctx = canvas.getContext("2d");
    const element = Object.assign(canvas, {
      style: {} as CSSStyleDeclaration,
      getContext: () => ctx,
    }) as unknown as HTMLCanvasElement;
    const engine = createEngine({
      canvas: element,
      width: STAGE_W,
      height: STAGE_H,
      game,
      clock: new ConstantClock(FRAME_MS),
      surface: {
        cssWidth: () => STAGE_W,
        cssHeight: () => STAGE_H,
        dpr: () => 1,
        events: () => new EventTarget(),
      },
    });
    await expect(engine.initialize()).rejects.toThrow(LAYOUT);
    engine.destroy();
  });
});

// ---- Menus ---------------------------------------------------------------

describe("the menus", () => {
  it("enters the campaign select from the first title item", async () => {
    h.tap("Enter");
    await h.engine.advance(1);
    expect(h.state.screen).toBe("select");
    expect(h.state.mode).toBe("campaign");
  });

  it("starts cascade from the second item", async () => {
    h.tap("ArrowDown");
    await h.engine.advance(1);
    h.tap("Space");
    await h.engine.advance(1);
    expect(h.state.screen).toBe("playing");
    expect(h.state.mode).toBe("cascade");
    expect(h.state.tier).toBe(1);
  });

  it("wraps the title highlight and consumes each press exactly once", async () => {
    h.tap("ArrowUp");
    await h.engine.advance(10);
    expect(h.state.menuIndex).toBe(2);
  });

  it("opens how-to-play and returns with back", async () => {
    h.tap("KeyS");
    await h.engine.advance(1);
    h.tap("KeyS");
    await h.engine.advance(1);
    h.tap("Enter");
    await h.engine.advance(1);
    expect(h.state.screen).toBe("howto");
    h.tap("Escape");
    await h.engine.advance(1);
    expect(h.state.screen).toBe("title");
    expect(h.state.menuIndex).toBe(0);
  });
});

// ---- The select grid -----------------------------------------------------

describe("the select grid", () => {
  beforeEach(async () => {
    h.tap("Enter");
    await h.engine.advance(1);
  });

  it("moves the highlight with wrapping rows and columns", async () => {
    h.tap("ArrowLeft");
    await h.engine.advance(1);
    expect(h.state.selectIndex).toBe(5); // wrapped within the top row
    h.tap("ArrowUp");
    await h.engine.advance(1);
    expect(h.state.selectIndex).toBe(23); // wrapped to the bottom row
    h.tap("ArrowDown");
    await h.engine.advance(1);
    expect(h.state.selectIndex).toBe(5);
  });

  it("refuses to enter a locked board", async () => {
    h.tap("ArrowRight");
    await h.engine.advance(1);
    h.tap("Enter");
    await h.engine.advance(1);
    expect(h.state.screen).toBe("select");
    expect(h.state.selectIndex).toBe(1);
  });

  it("enters board 1 and leaves back to the grid with beams discarded", async () => {
    h.tap("Enter");
    await h.engine.advance(1);
    expect(h.state.screen).toBe("playing");
    expect(h.state.boardIndex).toBe(0);

    await h.drag([
      { col: 1, row: 0 },
      { col: 2, row: 0 },
    ]);
    expect(h.state.beams[0].cells).toHaveLength(2);

    h.tap("Escape");
    await h.engine.advance(1);
    expect(h.state.screen).toBe("select");
    h.tap("Enter");
    await h.engine.advance(1);
    expect(h.state.beams[0].cells).toEqual([]);
  });
});

// ---- Playing, through the pointer ----------------------------------------

describe("drawing a beam with the pointer", () => {
  beforeEach(() => {
    h.debug.loadBoard(["TtT", ".1."]);
  });

  it("grows and unwinds node by node as the samples arrive", async () => {
    const [x0, y0] = cellCenter({ col: 0, row: 0 }, h.state.board);
    const [x1, y1] = cellCenter({ col: 1, row: 0 }, h.state.board);
    h.pointer("pointerdown", x0, y0);
    await h.engine.advance(1);
    expect(h.state.tracing).toEqual({ channel: "triangle" });

    h.pointer("pointermove", x1, y1);
    await h.engine.advance(1);
    expect(h.state.beams[0].cells).toHaveLength(2);
    expect(played()).toEqual([CUES.connect]);

    h.pointer("pointermove", x0, y0);
    await h.engine.advance(1);
    expect(h.state.beams[0].cells).toHaveLength(1);
    expect(played()).toEqual([CUES.connect, CUES.retract]);

    h.pointer("pointerup", x0, y0);
    await h.engine.advance(1);
    expect(h.state.tracing).toBeNull();
    expect(h.state.beams[0].cells).toEqual([]);
  });

  it("resolves a whole sweep delivered inside one frame, in arrival order", async () => {
    const centers = [
      { col: 0, row: 0 },
      { col: 1, row: 0 },
      { col: 2, row: 0 },
    ].map((cell) => cellCenter(cell, h.state.board));
    h.pointer("pointerdown", centers[0][0], centers[0][1]);
    h.pointer("pointermove", centers[1][0], centers[1][1]);
    h.pointer("pointermove", centers[2][0], centers[2][1]);
    await h.engine.advance(1);
    expect(h.state.beams[0].cells).toHaveLength(3);
    // Two segments connected in the frame, one connect cue for the batch.
    expect(played()).toEqual([CUES.connect, CUES.channelComplete]);
  });

  it("refuses a move the limits forbid and leaves the trace live", async () => {
    h.debug.loadBoard(["TtT", "SsS"]);
    const [x0, y0] = cellCenter({ col: 0, row: 0 }, h.state.board);
    const [x1, y1] = cellCenter({ col: 1, row: 1 }, h.state.board);
    h.pointer("pointerdown", x0, y0);
    await h.engine.advance(1);
    h.pointer("pointermove", x1, y1); // square's lens: refused
    await h.engine.advance(1);
    expect(h.state.beams[0].cells).toEqual([{ col: 0, row: 0 }]);
    expect(h.state.tracing).toEqual({ channel: "triangle" });
    expect(played()).toEqual([]);
  });

  it("mirrors the pointer into the state every frame", async () => {
    h.pointer("pointermove", 333, 222);
    await h.engine.advance(1);
    expect(h.state.pointer).toEqual({
      x: 333,
      y: 222,
      down: false,
      device: "mouse",
    });
  });

  it("plays channel-complete when a beam closes without solving", async () => {
    await h.drag([
      { col: 0, row: 0 },
      { col: 1, row: 0 },
      { col: 2, row: 0 },
    ]);
    expect(h.state.screen).toBe("playing"); // the crystal is still open
    expect(played()).toEqual([
      CUES.connect,
      CUES.connect,
      CUES.channelComplete,
    ]);
  });

  it("clears every beam with the R key and plays the clear cue once", async () => {
    await h.drag([
      { col: 0, row: 0 },
      { col: 1, row: 0 },
    ]);
    h.cues.length = 0;
    h.tap("KeyR");
    await h.engine.advance(1);
    expect(h.state.beams[0].cells).toEqual([]);
    expect(played()).toEqual([CUES.clear]);

    // With nothing to remove, the cue does not play again.
    h.tap("KeyR");
    await h.engine.advance(1);
    expect(played()).toEqual([CUES.clear]);
  });
});

// ---- Solving -------------------------------------------------------------

describe("solving a campaign board", () => {
  it("walks board 1 to solved and onward to board 2", async () => {
    h.tap("Enter");
    await h.engine.advance(1);
    h.tap("Enter");
    await h.engine.advance(1);
    expect(h.state.screen).toBe("playing");

    h.cues.length = 0;
    // Board 1's solution, drawn as a player would.
    await h.drag([
      { col: 1, row: 0 },
      { col: 2, row: 0 },
      { col: 1, row: 1 },
      { col: 0, row: 1 },
      { col: 1, row: 2 },
      { col: 2, row: 2 },
      { col: 2, row: 1 },
    ]);
    expect(h.state.screen).toBe("solved");
    expect(h.state.solvedBoards).toEqual([0]);
    expect(h.state.unlockedCount).toBe(2);
    expect(played()).toContain(CUES.solved);
    expect(played()).toContain(CUES.channelComplete);

    // The release after the solve began nothing; the beams stayed as drawn.
    expect(h.state.beams[0].cells).toHaveLength(7);
    expect(h.state.tracing).toBeNull();

    h.tap("Enter"); // NEXT BOARD
    await h.engine.advance(1);
    expect(h.state.screen).toBe("playing");
    expect(h.state.boardIndex).toBe(1);
    expect(h.state.beams[0].cells).toEqual([]);
  });

  it("solves board 1 posed through the debug surface, via the pointer operations", () => {
    // The whole scenario runs with no frame advanced: each operation takes
    // effect immediately, through the same per-sample path a drag feeds.
    h.debug.loadBoard(CAMPAIGN_BOARDS[0]);
    h.cues.length = 0;
    const route = [
      { col: 1, row: 0 },
      { col: 2, row: 0 },
      { col: 1, row: 1 },
      { col: 0, row: 1 },
      { col: 1, row: 2 },
      { col: 2, row: 2 },
      { col: 2, row: 1 },
    ];
    const centers = route.map((cell) => cellCenter(cell, h.state.board));
    h.debug.pointerDown(centers[0][0], centers[0][1]);
    for (const [x, y] of centers.slice(1)) h.debug.pointerMove(x, y);
    h.debug.pointerUp();

    expect(h.state.screen).toBe("solved");
    expect(h.debug.snapshot().solved).toBe(true);
    expect(played()).toContain(CUES.solved);
  });
});

describe("solving a cascade board", () => {
  it("counts the solve and hands the player the next generated board", async () => {
    h.tap("ArrowDown");
    await h.engine.advance(1);
    h.tap("Enter");
    await h.engine.advance(1);
    expect(h.state.mode).toBe("cascade");

    // The board the sequence opened with is the one the seed dictates, so its
    // carved solution is known.
    const expected = generateBoardWithSolution(DEFAULT_SEED, 1);
    expect(h.state.board).toEqual(expected.board);
    for (const route of expected.solution) {
      await h.drag(route);
    }
    expect(h.state.screen).toBe("solved");
    expect(h.state.solvedCount).toBe(1);
    expect(h.state.rngState).toBe(expected.rngState);

    h.tap("Enter"); // NEXT BOARD
    await h.engine.advance(1);
    expect(h.state.screen).toBe("playing");
    expect(h.state.beams.every((beam) => beam.cells.length === 0)).toBe(true);
  });
});

// ---- Audio ---------------------------------------------------------------

describe("mute", () => {
  it("toggles the engine's mute bit from any screen and mirrors it", async () => {
    h.tap("KeyM");
    await h.engine.advance(1);
    expect(h.engine.world.audio.muted()).toBe(true);
    expect(h.state.muted).toBe(true);
    h.tap("KeyM");
    await h.engine.advance(1);
    expect(h.state.muted).toBe(false);
  });

  it("keeps playing cues silently while muted", async () => {
    h.tap("KeyM");
    await h.engine.advance(1);
    h.debug.loadBoard(["TtT"]);
    h.cues.length = 0;
    await h.drag([
      { col: 0, row: 0 },
      { col: 1, row: 0 },
    ]);
    expect(played()).toEqual([CUES.connect]);
    expect(h.cues[0].gain).toBe(0);
  });
});

// ---- Rendering -----------------------------------------------------------

describe("rendering", () => {
  it("fills a lens with its channel's hue at its cell center", async () => {
    h.debug.loadBoard(["TtT"]);
    await h.engine.advance(1);
    const [x, y] = cellCenter({ col: 1, row: 0 }, h.state.board);
    expect(h.pixel(x, y)).toEqual(rgbOf(CHANNEL_COLOR.triangle));
  });

  it("draws a beam connecting the centers of the cells it links", async () => {
    h.debug.loadBoard(["TtT"]);
    h.debug.trace([
      { col: 0, row: 0 },
      { col: 1, row: 0 },
    ]);
    await h.engine.advance(1);
    const [x0, y] = cellCenter({ col: 0, row: 0 }, h.state.board);
    const [x1] = cellCenter({ col: 1, row: 0 }, h.state.board);
    expect(h.pixel((x0 + x1) / 2, y)).toEqual(rgbOf(CHANNEL_COLOR.triangle));
  });

  it("reads the state and writes nothing back", async () => {
    h.debug.loadBoard(["T1T", "S.S"]);
    const before = h.debug.snapshot();
    await h.engine.advance(1); // a frame renders both layers
    const after = h.debug.snapshot();
    // The frame advanced the clock and nothing else.
    expect(after).toEqual({
      ...before,
      simTime: before.simTime + FRAME_MS / 1000,
    });
  });

  it("draws every screen without error", async () => {
    // title (already shown), howto, select, playing, solved, complete.
    h.tap("KeyS");
    await h.engine.advance(1);
    h.tap("KeyS");
    await h.engine.advance(1);
    h.tap("Enter");
    await h.engine.advance(1);
    expect(h.state.screen).toBe("howto");
    h.tap("Escape");
    await h.engine.advance(1);
    h.tap("Enter");
    await h.engine.advance(1);
    expect(h.state.screen).toBe("select");

    h.debug.loadBoard(["TtT"]);
    h.debug.trace([
      { col: 0, row: 0 },
      { col: 1, row: 0 },
      { col: 2, row: 0 },
    ]);
    expect(h.state.screen).toBe("solved");
    await h.engine.advance(1);

    h.debug.loadBoard(["TtT"]);
    h.state.screen = "complete";
    await h.engine.advance(1);
    expect(h.state.screen).toBe("complete");
  });
});

// ---- The screens after a solve -------------------------------------------

describe("the solved and complete screens", () => {
  /** Board 1 solved through the keyboard-and-pointer path. */
  async function solveBoardOne(): Promise<void> {
    h.tap("Enter");
    await h.engine.advance(1);
    h.tap("Enter");
    await h.engine.advance(1);
    await h.drag([
      { col: 1, row: 0 },
      { col: 2, row: 0 },
      { col: 1, row: 1 },
      { col: 0, row: 1 },
      { col: 1, row: 2 },
      { col: 2, row: 2 },
      { col: 2, row: 1 },
    ]);
    expect(h.state.screen).toBe("solved");
  }

  it("replays the same board from the second choice", async () => {
    await solveBoardOne();
    h.tap("ArrowDown");
    await h.engine.advance(1);
    h.tap("Enter"); // REPLAY
    await h.engine.advance(1);
    expect(h.state.screen).toBe("playing");
    expect(h.state.boardIndex).toBe(0);
    expect(h.state.beams[0].cells).toEqual([]);
    expect(h.state.solvedBoards).toEqual([0]);
  });

  it("returns to the grid with back, highlight on the solved board", async () => {
    await solveBoardOne();
    h.tap("Escape");
    await h.engine.advance(1);
    expect(h.state.screen).toBe("select");
    expect(h.state.selectIndex).toBe(0);
  });

  it("restarts cascade from its solved menu without reseeding", async () => {
    h.debug.startMode("cascade");
    const expected = generateBoardWithSolution(DEFAULT_SEED, 1);
    for (const route of expected.solution) {
      await h.drag(route);
    }
    expect(h.state.screen).toBe("solved");
    const before = h.state.rngState;

    h.tap("ArrowDown");
    await h.engine.advance(1);
    h.tap("Enter"); // RESTART
    await h.engine.advance(1);
    expect(h.state.screen).toBe("playing");
    expect(h.state.solvedCount).toBe(0);
    expect(h.state.tier).toBe(1);
    expect(h.state.rngState).not.toBe(before);
  });

  it("leaves cascade's solved screen to the title with back", async () => {
    h.debug.startMode("cascade");
    const expected = generateBoardWithSolution(DEFAULT_SEED, 1);
    for (const route of expected.solution) {
      await h.drag(route);
    }
    h.tap("Escape");
    await h.engine.advance(1);
    expect(h.state.screen).toBe("title");
    expect(h.state.menuIndex).toBe(0);
  });

  it("offers the grid and the title from the complete screen", async () => {
    // The complete screen is reached by the solve that leaves no board
    // unsolved; pose the 23 others as solved and win the last for real.
    h.state.solvedBoards = Array.from({ length: 23 }, (_, index) => index);
    h.state.unlockedCount = CAMPAIGN_LENGTH;
    h.debug.loadBoard(["TtT"]);
    h.state.boardIndex = 23;
    h.debug.trace([
      { col: 0, row: 0 },
      { col: 1, row: 0 },
      { col: 2, row: 0 },
    ]);
    await h.engine.advance(1);
    expect(h.state.screen).toBe("complete");
    expect(h.state.solvedBoards).toHaveLength(CAMPAIGN_LENGTH);

    h.tap("ArrowDown");
    await h.engine.advance(1);
    h.tap("Enter"); // BACK TO TITLE
    await h.engine.advance(1);
    expect(h.state.screen).toBe("title");

    // Every board stays unlocked and solved afterward.
    h.tap("Enter");
    await h.engine.advance(1);
    expect(h.state.screen).toBe("select");
    expect(h.state.unlockedCount).toBe(CAMPAIGN_LENGTH);
  });

  it("leaves the board to the title with back during cascade play", async () => {
    h.debug.startMode("cascade");
    h.tap("Escape");
    await h.engine.advance(1);
    expect(h.state.screen).toBe("title");
  });
});
