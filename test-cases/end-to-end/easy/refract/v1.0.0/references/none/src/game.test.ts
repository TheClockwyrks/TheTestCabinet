// Refract over its own runtime, in process.
//
// Every check here stands the real runtime up over an `@napi-rs/canvas` canvas
// and a `Surface` of the test's own, so the game runs with no browser and no
// document behind it, and steps it with the manual clock — which makes a
// duration an exact number of frames of an exact length. Keys and the pointer
// are driven by dispatching keyboard-shaped and pointer-shaped events at the
// surface's event target — the same listeners a player's input reaches — and
// the game is driven and read back through `window.__refract`, installed
// exactly as `src/main.ts` installs it, so what is exercised is the surface a
// validator calls. What is read back beyond it is the game's own state, the
// cues its update played, and the pixels its render produced.
//
// The runtime itself is checked in `src/runtime.test.ts`; this file is the
// game.

import { createCanvas, type SKRSContext2D } from "@napi-rs/canvas";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cellCenter } from "./board";
import { CUES, DEFAULT_SEED, STAGE_H, STAGE_W } from "./constants";
import { generateBoardWithSolution } from "./cascade";
import {
  REFRACT_HANDLE,
  installDebugApi,
  type RefractWindowApi,
} from "./debug";
import { BACKGROUND, game, type Cell, type RefractState } from "./game";
import { createRuntime, type Game, type Runtime } from "./runtime";
import { CHANNEL_COLOR, rgbOf } from "./theme";
import type { RefractDebugApi } from "./debug";
import type { Surface } from "./viewport";

/** The frame length every check below counts in. */
const TICK = 1 / 60;

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
  muted: boolean;
}

interface Harness {
  readonly runtime: Runtime<RefractState, RefractDebugApi>;
  readonly state: RefractState;
  /** The installed `window.__refract`, read back off the global handle. */
  readonly api: RefractWindowApi;
  readonly ctx: SKRSContext2D;
  readonly cues: CuePlay[];
  /** Run `frames` frames of `TICK` seconds each, through the installed clock. */
  step(frames: number): void;
  apply(pose: (state: RefractState) => RefractState): void;
  tap(code: string): void;
  pointer(
    type: "pointerdown" | "pointermove" | "pointerup",
    x: number,
    y: number,
  ): void;
  /** Press, move along, and release at the given cell centers, one frame per event. */
  drag(cells: readonly Cell[]): void;
  pixel(x: number, y: number): [number, number, number];
  dispose(): void;
}

function createHarness(): Harness {
  const canvas = createCanvas(STAGE_W, STAGE_H);
  const ctx = canvas.getContext("2d");
  const element = Object.assign(canvas, {
    getContext: () => ctx,
  }) as unknown as HTMLCanvasElement;

  const events = new EventTarget();
  // A surface exactly the stage's size at the pointer's origin, so a logical
  // position and a client position coincide and a test aims where a player
  // sees.
  const surface: Surface = {
    cssWidth: () => STAGE_W,
    cssHeight: () => STAGE_H,
    dpr: () => 1,
    origin: () => ({ left: 0, top: 0 }),
    events: () => events,
  };

  // The game, with the one call a check wants to overhear — which cue an
  // event played — written down on its way through. Everything else is
  // untouched, so what runs is the real update against the real runtime.
  const cues: CuePlay[] = [];
  const observed: Game<RefractState, RefractDebugApi> = {
    initialize: (api) => game.initialize(api),
    update: (state, api, dt) =>
      game.update(
        state,
        {
          input: api.input,
          audio: {
            play: (cue) => {
              cues.push({ cue, muted: api.audio.muted() });
              api.audio.play(cue);
            },
            setMuted: (muted) => api.audio.setMuted(muted),
            muted: () => api.audio.muted(),
          },
        },
        dt,
      ),
    render: (state, api) => game.render(state, api),
  };

  // Exactly the wiring src/main.ts does, plus the surface and the silent
  // audio source a headless run needs.
  const runtime = createRuntime<RefractState, RefractDebugApi>({
    canvas: element,
    width: STAGE_W,
    height: STAGE_H,
    game: observed,
    background: BACKGROUND,
    surface,
    // Node has no Web Audio. The bus stays silent; the cues above still record.
    audioContext: () => null,
  });
  runtime.initialize();
  const uninstall = installDebugApi(runtime, runtime.debug);
  // Read back off the global handle rather than held from the install, so a
  // build that failed to publish the surface fails here.
  const api = (globalThis as unknown as Record<string, unknown>)[
    REFRACT_HANDLE
  ] as RefractWindowApi;

  const dispatchPointer = (
    type: "pointerdown" | "pointermove" | "pointerup",
    x: number,
    y: number,
  ): void => {
    events.dispatchEvent(new PointerEvt(type, x, y));
  };
  const step = (frames: number): void => {
    api.advance(frames * TICK, frames);
  };

  return {
    runtime,
    get state() {
      return runtime.state;
    },
    api,
    ctx,
    cues,
    step,
    apply: (pose) => runtime.apply(pose),
    tap: (code) => {
      events.dispatchEvent(new KeyEvent("keydown", code));
      events.dispatchEvent(new KeyEvent("keyup", code));
    },
    pointer: dispatchPointer,
    drag: (cells) => {
      const centers = cells.map((cell) =>
        cellCenter(cell, runtime.state.board),
      );
      dispatchPointer("pointerdown", centers[0][0], centers[0][1]);
      step(1);
      for (const [x, y] of centers.slice(1)) {
        dispatchPointer("pointermove", x, y);
        step(1);
      }
      const last = centers[centers.length - 1];
      dispatchPointer("pointerup", last[0], last[1]);
      step(1);
    },
    pixel: (x, y) => {
      const { data } = ctx.getImageData(Math.round(x), Math.round(y), 1, 1);
      return [data[0], data[1], data[2]];
    },
    dispose: () => {
      uninstall();
      runtime.destroy();
    },
  };
}

let h: Harness;

beforeEach(() => {
  h = createHarness();
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

  it("publishes the surface on window.__refract, versioned", () => {
    expect(h.api).toBeDefined();
    expect(h.api.version).toBe(1);
    expect(h.api.snapshot().screen).toBe("title");
  });

  it("accumulates simTime off the clock it is driven by, on every screen", () => {
    h.step(30);
    expect(h.state.simTime).toBeCloseTo(0.5, 9);
    expect(h.runtime.frame().count).toBe(30);
  });

  it("reaches the same state however an interval is divided into frames", () => {
    h.api.loadBoard(["TtT"]);
    h.api.advance(1, 1);
    const single = h.api.snapshot().simTime;
    h.api.advance(1, 60);
    expect(h.api.snapshot().simTime - single).toBeCloseTo(single, 9);
  });
});

// ---- Menus ---------------------------------------------------------------

describe("the menus", () => {
  it("enters the campaign select from the first title item", () => {
    h.tap("Enter");
    h.step(1);
    expect(h.state.screen).toBe("select");
    expect(h.state.mode).toBe("campaign");
  });

  it("starts cascade from the second item", () => {
    h.tap("ArrowDown");
    h.step(1);
    h.tap("Space");
    h.step(1);
    expect(h.state.screen).toBe("playing");
    expect(h.state.mode).toBe("cascade");
    expect(h.state.tier).toBe(1);
  });

  it("wraps the title highlight and consumes each press exactly once", () => {
    h.tap("ArrowUp");
    h.step(10);
    expect(h.state.menuIndex).toBe(2);
  });

  it("opens how-to-play and returns with back", () => {
    h.tap("KeyS");
    h.step(1);
    h.tap("KeyS");
    h.step(1);
    h.tap("Enter");
    h.step(1);
    expect(h.state.screen).toBe("howto");
    h.tap("Escape");
    h.step(1);
    expect(h.state.screen).toBe("title");
    expect(h.state.menuIndex).toBe(0);
  });
});

// ---- The select grid -----------------------------------------------------

describe("the select grid", () => {
  beforeEach(() => {
    h.tap("Enter");
    h.step(1);
  });

  it("moves the highlight with wrapping rows and columns", () => {
    h.tap("ArrowLeft");
    h.step(1);
    expect(h.state.selectIndex).toBe(5); // wrapped within the top row
    h.tap("ArrowUp");
    h.step(1);
    expect(h.state.selectIndex).toBe(23); // wrapped to the bottom row
    h.tap("ArrowDown");
    h.step(1);
    expect(h.state.selectIndex).toBe(5);
  });

  it("refuses to enter a locked board", () => {
    h.tap("ArrowRight");
    h.step(1);
    h.tap("Enter");
    h.step(1);
    expect(h.state.screen).toBe("select");
    expect(h.state.selectIndex).toBe(1);
  });

  it("enters board 1 and leaves back to the grid with beams discarded", () => {
    h.tap("Enter");
    h.step(1);
    expect(h.state.screen).toBe("playing");
    expect(h.state.boardIndex).toBe(0);

    h.drag([
      { col: 2, row: 1 },
      { col: 1, row: 0 },
    ]);
    expect(h.state.beams[0].cells).toHaveLength(2);

    h.tap("Escape");
    h.step(1);
    expect(h.state.screen).toBe("select");
    h.tap("Enter");
    h.step(1);
    expect(h.state.beams[0].cells).toEqual([]);
  });
});

// ---- Playing, through the pointer ----------------------------------------

describe("drawing a beam with the pointer", () => {
  beforeEach(() => {
    h.api.loadBoard(["TtT", ".1."]);
  });

  it("grows and unwinds node by node as the samples arrive", () => {
    const [x0, y0] = cellCenter({ col: 0, row: 0 }, h.state.board);
    const [x1, y1] = cellCenter({ col: 1, row: 0 }, h.state.board);
    h.pointer("pointerdown", x0, y0);
    h.step(1);
    expect(h.state.tracing).toEqual({ channel: "triangle" });

    h.pointer("pointermove", x1, y1);
    h.step(1);
    expect(h.state.beams[0].cells).toHaveLength(2);
    expect(played()).toEqual([CUES.connect]);

    h.pointer("pointermove", x0, y0);
    h.step(1);
    expect(h.state.beams[0].cells).toHaveLength(1);
    expect(played()).toEqual([CUES.connect, CUES.retract]);

    h.pointer("pointerup", x0, y0);
    h.step(1);
    expect(h.state.tracing).toBeNull();
    expect(h.state.beams[0].cells).toEqual([]);
  });

  it("resolves a whole sweep delivered inside one frame, in arrival order", () => {
    const centers = [
      { col: 0, row: 0 },
      { col: 1, row: 0 },
      { col: 2, row: 0 },
    ].map((cell) => cellCenter(cell, h.state.board));
    h.pointer("pointerdown", centers[0][0], centers[0][1]);
    h.pointer("pointermove", centers[1][0], centers[1][1]);
    h.pointer("pointermove", centers[2][0], centers[2][1]);
    h.step(1);
    expect(h.state.beams[0].cells).toHaveLength(3);
  });

  it("mirrors the pointer into the state every frame", () => {
    h.pointer("pointermove", 333, 222);
    h.step(1);
    expect(h.state.pointer).toEqual({ x: 333, y: 222, down: false });
  });

  it("plays channel-complete when a beam closes without solving", () => {
    h.drag([
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

  it("clears every beam with the R key and plays the clear cue once", () => {
    h.drag([
      { col: 0, row: 0 },
      { col: 1, row: 0 },
    ]);
    h.cues.length = 0;
    h.tap("KeyR");
    h.step(1);
    expect(h.state.beams[0].cells).toEqual([]);
    expect(played()).toEqual([CUES.clear]);

    // With nothing to remove, the cue does not play again.
    h.tap("KeyR");
    h.step(1);
    expect(played()).toEqual([CUES.clear]);
  });
});

// ---- Solving -------------------------------------------------------------

describe("solving a campaign board", () => {
  it("walks board 1 to solved and onward to board 2", () => {
    h.tap("Enter");
    h.step(1);
    h.tap("Enter");
    h.step(1);
    expect(h.state.screen).toBe("playing");

    h.cues.length = 0;
    // Board 1's solution, drawn as a player would.
    h.drag([
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
    h.step(1);
    expect(h.state.screen).toBe("playing");
    expect(h.state.boardIndex).toBe(1);
    expect(h.state.beams[0].cells).toEqual([]);
  });
});

describe("solving a cascade board", () => {
  it("counts the solve and hands the player the next generated board", () => {
    h.tap("ArrowDown");
    h.step(1);
    h.tap("Enter");
    h.step(1);
    expect(h.state.mode).toBe("cascade");

    // The board the sequence opened with is the one the seed dictates, so its
    // carved solution is known.
    const expected = generateBoardWithSolution(DEFAULT_SEED, 1);
    expect(h.state.board).toEqual(expected.board);
    for (const route of expected.solution) {
      h.drag(route);
    }
    expect(h.state.screen).toBe("solved");
    expect(h.state.solvedCount).toBe(1);
    expect(h.state.rngState).toBe(expected.rngState);

    h.tap("Enter"); // NEXT BOARD
    h.step(1);
    expect(h.state.screen).toBe("playing");
    expect(h.state.beams.every((beam) => beam.cells.length === 0)).toBe(true);
  });
});

// ---- The installed surface, driven as a validator would --------------------

describe("window.__refract, driven end to end", () => {
  it("poses, traces, snapshots, and resets through the game's own rules", () => {
    h.api.setAutoStep(false);
    h.api.reset({ seed: 5 });
    h.api.loadBoard(["T2T", "S.S"]);
    h.api.trace([
      { col: 0, row: 0 },
      { col: 1, row: 0 },
      { col: 2, row: 0 },
    ]);
    h.api.trace([
      { col: 0, row: 1 },
      { col: 2, row: 1 },
    ]);
    // (0,1) to (2,1) is not adjacent: R1 refused the segment, the trace added
    // nothing, and the release left square's beam empty.
    let snapshot = h.api.snapshot();
    expect(snapshot.beams.square?.cells).toEqual([]);
    expect(snapshot.solved).toBe(false);

    h.api.trace([
      { col: 0, row: 1 },
      { col: 1, row: 0 },
      { col: 2, row: 1 },
    ]);
    snapshot = h.api.snapshot();
    expect(snapshot.solved).toBe(true);
    expect(snapshot.screen).toBe("solved");
    const crystal = snapshot.board.nodes.find(
      (node) => node.kind === "crystal",
    );
    expect(crystal).toMatchObject({ charges: 2, spent: 2 });

    h.api.reset();
    snapshot = h.api.snapshot();
    expect(snapshot.screen).toBe("title");
    expect(snapshot.simTime).toBe(0);
    h.api.setAutoStep(true);
  });

  it("startMode(cascade) reruns the identical sequence for the same seed", () => {
    h.api.setAutoStep(false);
    h.api.reset({ seed: 11 });
    h.api.startMode("cascade");
    const first = h.api.snapshot().board;

    h.api.reset({ seed: 11 });
    h.api.startMode("cascade");
    expect(h.api.snapshot().board).toEqual(first);
    h.api.setAutoStep(true);
  });

  it("keeps the pointer poses subject to every limit", () => {
    h.api.loadBoard(["TtT", "SsS"]);
    h.api.trace([
      { col: 0, row: 0 },
      { col: 1, row: 1 }, // square's lens: refused
      { col: 1, row: 0 },
      { col: 2, row: 0 },
    ]);
    const snapshot = h.api.snapshot();
    expect(snapshot.beams.triangle?.complete).toBe(true);
    expect(snapshot.beams.triangle?.cells).toHaveLength(3);
  });
});

// ---- Audio ---------------------------------------------------------------

describe("mute", () => {
  it("toggles the runtime's mute bit from any screen and mirrors it", () => {
    h.tap("KeyM");
    h.step(1);
    expect(h.state.muted).toBe(true);
    h.tap("KeyM");
    h.step(1);
    expect(h.state.muted).toBe(false);
  });

  it("keeps playing cues silently while muted", () => {
    h.tap("KeyM");
    h.step(1);
    h.api.loadBoard(["TtT"]);
    h.cues.length = 0;
    h.drag([
      { col: 0, row: 0 },
      { col: 1, row: 0 },
    ]);
    expect(played()).toEqual([CUES.connect]);
    expect(h.cues[0].muted).toBe(true);
  });
});

// ---- Rendering -----------------------------------------------------------

describe("rendering", () => {
  it("fills a lens with its channel's hue at its cell center", () => {
    h.api.loadBoard(["TtT"]);
    h.step(1);
    const [x, y] = cellCenter({ col: 1, row: 0 }, h.state.board);
    expect(h.pixel(x, y)).toEqual(rgbOf(CHANNEL_COLOR.triangle));
  });

  it("draws a beam connecting the centers of the cells it links", () => {
    h.api.loadBoard(["TtT"]);
    h.api.trace([
      { col: 0, row: 0 },
      { col: 1, row: 0 },
    ]);
    h.step(1);
    const [x0, y] = cellCenter({ col: 0, row: 0 }, h.state.board);
    const [x1] = cellCenter({ col: 1, row: 0 }, h.state.board);
    expect(h.pixel((x0 + x1) / 2, y)).toEqual(rgbOf(CHANNEL_COLOR.triangle));
  });

  it("changes nothing about the state", () => {
    h.api.loadBoard(["T1T", "S.S"]);
    h.step(1);
    const before = JSON.stringify(h.api.snapshot());
    game.render(h.state, {
      ctx: h.ctx as unknown as CanvasRenderingContext2D,
    });
    expect(JSON.stringify(h.api.snapshot())).toBe(before);
  });

  it("draws every screen without error", () => {
    // title (already shown), howto, select, playing, solved, complete.
    h.tap("KeyS");
    h.step(1);
    h.tap("KeyS");
    h.step(1);
    h.tap("Enter");
    h.step(1);
    expect(h.state.screen).toBe("howto");
    h.tap("Escape");
    h.step(1);
    h.tap("Enter");
    h.step(1);
    expect(h.state.screen).toBe("select");

    h.api.loadBoard(["TtT"]);
    h.api.trace([
      { col: 0, row: 0 },
      { col: 1, row: 0 },
      { col: 2, row: 0 },
    ]);
    expect(h.state.screen).toBe("solved");
    h.step(1);

    h.api.loadBoard(["TtT"]);
    h.apply((s) => ({ ...s, screen: "complete" as const }));
    h.step(1);
    expect(h.state.screen).toBe("complete");
  });
});

// ---- The screens after a solve -------------------------------------------

describe("the solved and complete screens", () => {
  /** Board 1 solved through the keyboard-and-pointer path. */
  function solveBoardOne(): void {
    h.tap("Enter");
    h.step(1);
    h.tap("Enter");
    h.step(1);
    h.drag([
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

  it("replays the same board from the second choice", () => {
    solveBoardOne();
    h.tap("ArrowDown");
    h.step(1);
    h.tap("Enter"); // REPLAY
    h.step(1);
    expect(h.state.screen).toBe("playing");
    expect(h.state.boardIndex).toBe(0);
    expect(h.state.beams[0].cells).toEqual([]);
    expect(h.state.solvedBoards).toEqual([0]);
  });

  it("returns to the grid with back, highlight on the solved board", () => {
    solveBoardOne();
    h.tap("Escape");
    h.step(1);
    expect(h.state.screen).toBe("select");
    expect(h.state.selectIndex).toBe(0);
  });

  it("restarts cascade from its solved menu without reseeding", () => {
    h.api.startMode("cascade");
    const expected = generateBoardWithSolution(DEFAULT_SEED, 1);
    for (const route of expected.solution) {
      h.drag(route);
    }
    expect(h.state.screen).toBe("solved");
    const before = h.state.rngState;

    h.tap("ArrowDown");
    h.step(1);
    h.tap("Enter"); // RESTART
    h.step(1);
    expect(h.state.screen).toBe("playing");
    expect(h.state.solvedCount).toBe(0);
    expect(h.state.tier).toBe(1);
    expect(h.state.rngState).not.toBe(before);
  });

  it("leaves cascade's solved screen to the title with back", () => {
    h.api.startMode("cascade");
    const expected = generateBoardWithSolution(DEFAULT_SEED, 1);
    for (const route of expected.solution) {
      h.drag(route);
    }
    h.tap("Escape");
    h.step(1);
    expect(h.state.screen).toBe("title");
    expect(h.state.menuIndex).toBe(0);
  });

  it("offers the grid and the title from the complete screen", () => {
    // The complete screen is reached by the solve that leaves no board
    // unsolved; pose the 23 others as solved and win the last for real.
    h.apply((s) => ({
      ...s,
      solvedBoards: Array.from({ length: 23 }, (_, index) => index),
      unlockedCount: 24,
    }));
    h.api.loadBoard(["TtT"]);
    h.apply((s) => ({ ...s, boardIndex: 23 }));
    h.api.trace([
      { col: 0, row: 0 },
      { col: 1, row: 0 },
      { col: 2, row: 0 },
    ]);
    h.step(1);
    expect(h.state.screen).toBe("complete");
    expect(h.state.solvedBoards).toHaveLength(24);

    h.tap("ArrowDown");
    h.step(1);
    h.tap("Enter"); // BACK TO TITLE
    h.step(1);
    expect(h.state.screen).toBe("title");

    // Every board stays unlocked and solved afterward.
    h.tap("Enter");
    h.step(1);
    expect(h.state.screen).toBe("select");
    expect(h.state.unlockedCount).toBe(24);
  });

  it("leaves the board to the title with back during cascade play", () => {
    h.api.startMode("cascade");
    h.tap("Escape");
    h.step(1);
    expect(h.state.screen).toBe("title");
  });
});
