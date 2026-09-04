// Refract under the engine, in process.
//
// Every check here builds a real engine over an `@napi-rs/canvas` canvas and a
// `SurfaceMetrics` of its own, so the game runs with no browser and no
// document behind it, and steps it with `engine.advance` against a
// `ConstantClock`. Keys and the pointer are driven by dispatching
// keyboard-shaped and pointer-shaped events at the surface's event target —
// the same listeners a player's input reaches — and what is read back is the
// game's own state, the debug surface `initialize` returned beside it, the
// engine's cue events, and the pixels the render produced.

import { createCanvas, type SKRSContext2D } from "@napi-rs/canvas";
import {
  ConstantClock,
  createEngine,
  type Engine,
  type SurfaceMetrics,
} from "@test-cabinet/simple-2d";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cellCenter } from "./board";
import { CUES, LAYOUT, STAGE_H, STAGE_W } from "./constants";
import { generateBoardWithSolution } from "./cascade";
import { DEFAULT_SEED } from "./constants";
import type { RefractDebugApi } from "./debug";
import { BACKGROUND, game, type Cell, type RefractState } from "./game";
import { CHANNEL_COLOR, rgbOf } from "./theme";
import type { DeepReadonly } from "ts-essentials";

const FRAME_MS = 1000 / 60;

class KeyEvent extends Event {
  readonly code: string;
  readonly repeat = false;

  constructor(type: "keydown" | "keyup", code: string) {
    super(type);
    this.code = code;
  }
}

class PointerEvt extends Event {
  readonly clientX: number;
  readonly clientY: number;
  readonly isPrimary = true;

  constructor(
    type: "pointerdown" | "pointermove" | "pointerup",
    x: number,
    y: number,
  ) {
    super(type);
    this.clientX = x;
    this.clientY = y;
  }
}

interface CuePlay {
  cue: string;
  gain: number;
}

interface Harness {
  readonly engine: Engine<RefractState, RefractDebugApi>;
  readonly state: DeepReadonly<RefractState>;
  readonly debug: RefractDebugApi;
  readonly ctx: SKRSContext2D;
  readonly cues: CuePlay[];
  tap(code: string): void;
  pointer(
    type: "pointerdown" | "pointermove" | "pointerup",
    x: number,
    y: number,
  ): void;
  /** Press, move along, and release at the given cell centers, one frame per event. */
  drag(cells: readonly Cell[]): Promise<void>;
  pixel(x: number, y: number): [number, number, number];
  dispose(): void;
}

async function createHarness(): Promise<Harness> {
  const canvas = createCanvas(STAGE_W, STAGE_H);
  const ctx = canvas.getContext("2d");
  const element = Object.assign(canvas, {
    style: {} as CSSStyleDeclaration,
    getContext: () => ctx,
  }) as unknown as HTMLCanvasElement;

  const events = new EventTarget();
  const surface: SurfaceMetrics = {
    cssWidth: () => STAGE_W,
    cssHeight: () => STAGE_H,
    dpr: () => 1,
    events: () => events,
  };

  // Exactly the options src/main.ts passes, plus the clock and the surface a
  // headless run needs.
  const engine = createEngine<RefractState, RefractDebugApi>({
    canvas: element,
    width: STAGE_W,
    height: STAGE_H,
    game,
    background: BACKGROUND,
    layout: LAYOUT,
    clock: new ConstantClock(FRAME_MS),
    surface,
  });

  const cues: CuePlay[] = [];
  engine.events.on("cue:played", ({ cue, gain }) => cues.push({ cue, gain }));

  await engine.initialize();

  const dispatchPointer = (
    type: "pointerdown" | "pointermove" | "pointerup",
    x: number,
    y: number,
  ): void => {
    events.dispatchEvent(new PointerEvt(type, x, y));
  };

  const harness: Harness = {
    engine,
    get state() {
      return engine.state;
    },
    // Read off the engine rather than built here, so a build that failed to
    // return the surface beside its state fails here.
    debug: engine.debug,
    ctx,
    cues,
    tap: (code) => {
      events.dispatchEvent(new KeyEvent("keydown", code));
      events.dispatchEvent(new KeyEvent("keyup", code));
    },
    pointer: dispatchPointer,
    drag: async (cells) => {
      const centers = cells.map((cell) => cellCenter(cell, engine.state.board));
      dispatchPointer("pointerdown", centers[0][0], centers[0][1]);
      await engine.advance(1);
      for (const [x, y] of centers.slice(1)) {
        dispatchPointer("pointermove", x, y);
        await engine.advance(1);
      }
      const last = centers[centers.length - 1];
      dispatchPointer("pointerup", last[0], last[1]);
      await engine.advance(1);
    },
    pixel: (x, y) => {
      const { data } = ctx.getImageData(Math.round(x), Math.round(y), 1, 1);
      return [data[0], data[1], data[2]];
    },
    dispose: () => engine.destroy(),
  };
  return harness;
}

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
    expect(h.state.beams).toEqual([]);
    expect(h.state.tracing).toBeNull();
  });

  it("accumulates simTime off the clock it was given, on every screen", async () => {
    await h.engine.advance(30);
    expect(h.state.simTime).toBeCloseTo(0.5, 9);
    expect(h.engine.frame().count).toBe(30);
  });

  it("refuses an engine without the layout it registers against", async () => {
    const canvas = createCanvas(STAGE_W, STAGE_H);
    const ctx = canvas.getContext("2d");
    const element = Object.assign(canvas, {
      style: {} as CSSStyleDeclaration,
      getContext: () => ctx,
    }) as unknown as HTMLCanvasElement;
    const engine = createEngine<RefractState, RefractDebugApi>({
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
    // The title remembers the entry that led away (specs/ui.md).
    expect(h.state.menuIndex).toBe(2);
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
    h.engine.apply((s) => h.debug.loadBoard(s, ["TtT", ".1."]));
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
    expect(h.state.muted).toBe(true);
    h.tap("KeyM");
    await h.engine.advance(1);
    expect(h.state.muted).toBe(false);
  });

  it("keeps playing cues silently while muted", async () => {
    h.tap("KeyM");
    await h.engine.advance(1);
    h.engine.apply((s) => h.debug.loadBoard(s, ["TtT"]));
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
    h.engine.apply((s) => h.debug.loadBoard(s, ["TtT"]));
    await h.engine.advance(1);
    const [x, y] = cellCenter({ col: 1, row: 0 }, h.state.board);
    expect(h.pixel(x, y)).toEqual(rgbOf(CHANNEL_COLOR.triangle));
  });

  it("draws a beam connecting the centers of the cells it links", async () => {
    h.engine.apply((s) => h.debug.loadBoard(s, ["TtT"]));
    h.engine.apply((s) =>
      h.debug.trace(s, [
        { col: 0, row: 0 },
        { col: 1, row: 0 },
      ]),
    );
    await h.engine.advance(1);
    const [x0, y] = cellCenter({ col: 0, row: 0 }, h.state.board);
    const [x1] = cellCenter({ col: 1, row: 0 }, h.state.board);
    expect(h.pixel((x0 + x1) / 2, y)).toEqual(rgbOf(CHANNEL_COLOR.triangle));
  });

  it("changes nothing about the state", async () => {
    h.engine.apply((s) => h.debug.loadBoard(s, ["T1T", "S.S"]));
    await h.engine.advance(1);
    const before = JSON.stringify(h.debug.snapshot(h.engine.state));
    game.render(h.engine.state, {
      ctx: h.ctx as unknown as CanvasRenderingContext2D,
      frame: () => h.engine.frame(),
      viewport: () => h.engine.viewport(),
    });
    expect(JSON.stringify(h.debug.snapshot(h.engine.state))).toBe(before);
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
    // Back on the title with HOW TO PLAY highlighted (specs/ui.md); one more
    // down wraps the highlight onto CAMPAIGN.
    h.tap("KeyS");
    await h.engine.advance(1);
    h.tap("Enter");
    await h.engine.advance(1);
    expect(h.state.screen).toBe("select");

    h.engine.apply((s) => h.debug.loadBoard(s, ["TtT"]));
    h.engine.apply((s) =>
      h.debug.trace(s, [
        { col: 0, row: 0 },
        { col: 1, row: 0 },
        { col: 2, row: 0 },
      ]),
    );
    expect(h.state.screen).toBe("solved");
    await h.engine.advance(1);

    h.engine.apply((s) => ({
      ...h.debug.loadBoard(s, ["TtT"]),
      screen: "complete" as const,
    }));
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
    h.engine.apply((s) => h.debug.startMode(s, "cascade"));
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
    h.engine.apply((s) => h.debug.startMode(s, "cascade"));
    const expected = generateBoardWithSolution(DEFAULT_SEED, 1);
    for (const route of expected.solution) {
      await h.drag(route);
    }
    h.tap("Escape");
    await h.engine.advance(1);
    expect(h.state.screen).toBe("title");
    // Cascade's screens return to the title on CASCADE (specs/modes/cascade.md).
    expect(h.state.menuIndex).toBe(1);
  });

  it("offers the grid and the title from the complete screen", async () => {
    // The complete screen is reached by the solve that leaves no board
    // unsolved; pose the 23 others as solved and win the last for real.
    h.engine.apply((s) => ({
      ...s,
      solvedBoards: Array.from({ length: 23 }, (_, index) => index),
      unlockedCount: 24,
    }));
    h.engine.apply((s) => h.debug.loadBoard(s, ["TtT"]));
    h.engine.apply((s) => ({ ...s, boardIndex: 23 }));
    h.engine.apply((s) =>
      h.debug.trace(s, [
        { col: 0, row: 0 },
        { col: 1, row: 0 },
        { col: 2, row: 0 },
      ]),
    );
    await h.engine.advance(1);
    expect(h.state.screen).toBe("complete");
    expect(h.state.solvedBoards).toHaveLength(24);

    h.tap("ArrowDown");
    await h.engine.advance(1);
    h.tap("Enter"); // BACK TO TITLE
    await h.engine.advance(1);
    expect(h.state.screen).toBe("title");

    // Every board stays unlocked and solved afterward.
    h.tap("Enter");
    await h.engine.advance(1);
    expect(h.state.screen).toBe("select");
    expect(h.state.unlockedCount).toBe(24);
  });

  it("leaves the board to the title with back during cascade play", async () => {
    h.engine.apply((s) => h.debug.startMode(s, "cascade"));
    h.tap("Escape");
    await h.engine.advance(1);
    expect(h.state.screen).toBe("title");
  });
});
