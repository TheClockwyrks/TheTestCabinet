// Facet under the engine, in process.
//
// Every check here builds a real engine over an `@napi-rs/canvas` canvas and a
// `SurfaceMetrics` of its own, so the game runs with no browser and no document
// behind it, and steps it with `engine.advance` against a `ConstantClock`. Keys
// and the pointer are driven by dispatching keyboard-shaped and pointer-shaped
// events at the surface's event target — the same listeners a player's input
// reaches — and what is read back is the game's own state, the debug surface
// `initialize` returned beside it, and the engine's cue events.
//
// Two harnesses, because the produced files matter twice over. The plain one
// runs with no transport at all, so every load fails and the game is exercised
// exactly as a build whose assets went missing: it still plays. The LOADED one
// stubs `fetch` over the committed `public/` tree and `createImageBitmap` over
// `@napi-rs/canvas`, so the engine's own asset path resolves, fetches, and
// decodes the real files this build ships — which is the only way to show that
// the manifest and the committed tree agree.

import { createCanvas, loadImage, type SKRSContext2D } from "@napi-rs/canvas";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  ConstantClock,
  createEngine,
  type Engine,
  type SurfaceMetrics,
} from "@test-cabinet/simple-2d";
import { afterEach, describe, expect, it } from "vitest";
import { assetManifest } from "./assets";
import { ladderCue, MUSIC_PLAY, MUSIC_TITLE } from "./audio";
import {
  BOARD_CX,
  CUES,
  DEFAULT_SEED,
  GRID_COLS,
  GRID_ROWS,
  LAYOUT,
  STAGE_H,
  STAGE_W,
  TITLE_ITEMS,
} from "./constants";
import { cellCenter } from "./core";
import { quietRowsWith } from "./core/fixtures";
import { setScratchCanvasFactory } from "./scratch";
import type { FacetDebugApi } from "./debug";
import { BACKGROUND, game, type FacetState } from "./game";
import type { DeepReadonly } from "ts-essentials";

const FRAME_MS = 1000 / 60;
const PUBLIC = join(import.meta.dirname, "..", "public");

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
  readonly engine: Engine<FacetState, FacetDebugApi>;
  readonly state: DeepReadonly<FacetState>;
  readonly debug: FacetDebugApi;
  readonly ctx: SKRSContext2D;
  readonly played: CuePlay[];
  readonly looped: string[];
  readonly failed: string[];
  tap(code: string): void;
  /** Hold every code down at once, so one frame reads them all. */
  tapTogether(...codes: string[]): void;
  point(
    type: "pointerdown" | "pointermove" | "pointerup",
    x: number,
    y: number,
  ): void;
  pose(operation: (state: DeepReadonly<FacetState>) => FacetState): void;
  dispose(): void;
}

/** The committed `public/` tree, served to the engine's own asset loader. */
function diskFetch(): (url: string) => Promise<Response> {
  return async (url) => {
    const body = await readFile(join(PUBLIC, url));
    return new Response(new Uint8Array(body), { status: 200 });
  };
}

/** `createImageBitmap` over `@napi-rs/canvas`, which the engine decodes with. */
function napiDecoder(): (blob: Blob) => Promise<ImageBitmap> {
  return async (blob) =>
    (await loadImage(
      Buffer.from(await blob.arrayBuffer()),
    )) as unknown as ImageBitmap;
}

const restorers: (() => void)[] = [];

/** Put the real files behind the engine's loader for the life of one test. */
function serveAssets(): void {
  const globals = globalThis as Record<string, unknown>;
  const priorFetch = globals.fetch;
  const priorDecoder = globals.createImageBitmap;
  globals.fetch = diskFetch();
  globals.createImageBitmap = napiDecoder();
  restorers.push(() => {
    globals.fetch = priorFetch;
    globals.createImageBitmap = priorDecoder;
  });
}

async function createHarness(): Promise<Harness> {
  restorers.push(
    setScratchCanvasFactory(
      (width, height) =>
        createCanvas(width, height).getContext(
          "2d",
        ) as unknown as CanvasRenderingContext2D,
    ),
  );

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
  const engine = createEngine<FacetState, FacetDebugApi>({
    canvas: element,
    width: STAGE_W,
    height: STAGE_H,
    game,
    background: BACKGROUND,
    layout: LAYOUT,
    clock: new ConstantClock(FRAME_MS),
    surface,
  });

  const played: CuePlay[] = [];
  const looped: string[] = [];
  const failed: string[] = [];
  engine.events.on("cue:played", ({ cue, gain }) => played.push({ cue, gain }));
  engine.events.on("cue:looped", ({ cue }) => looped.push(cue));
  engine.events.on("asset:failed", ({ path }) => failed.push(path));

  await engine.initialize();
  restorers.push(() => {
    engine.destroy();
  });

  const key = (code: string): void => {
    events.dispatchEvent(new KeyEvent("keydown", code));
    events.dispatchEvent(new KeyEvent("keyup", code));
  };

  return {
    engine,
    get state() {
      return engine.state;
    },
    get debug() {
      return engine.debug;
    },
    ctx,
    played,
    looped,
    failed,
    tap: key,
    tapTogether: (...codes) => {
      for (const code of codes) key(code);
    },
    point: (type, x, y) => {
      events.dispatchEvent(new PointerEvt(type, x, y));
    },
    pose: (operation) => {
      engine.apply((state) => operation(state));
    },
    dispose: () => {
      engine.destroy();
    },
  };
}

afterEach(() => {
  while (restorers.length > 0) restorers.pop()?.();
});

/**
 * The quiet board with five cells rewritten, so that exactly one swap on it —
 * `(3, 1)` against `(3, 2)` — completes a run, and that run is exactly three
 * rubies. Every other pair on it is barren, which is what the refusal checks
 * below rest on.
 */
function threeInARow(): string[] {
  return quietRowsWith({
    "1,1": "R0",
    "2,1": "R0",
    "3,1": "C0",
    "3,2": "R0",
    "4,1": "B0",
  });
}

/** A pair on that board no rule accepts. */
const BARREN: readonly [number, number, number, number] = [6, 6, 7, 6];

/**
 * A board that chains. The swap `(3, 6)` against `(3, 7)` clears three rubies
 * along the bottom row, and the jades that fall into the gap line up with the
 * jade at `(0, 7)`, so a second step resolves one `STEP_SECONDS` later. Every
 * gem involved is a survivor rather than a refill, so the cascade is a fact of
 * the board rather than of the seed.
 */
function cascade(): string[] {
  return quietRowsWith({
    "0,7": "J0",
    "1,7": "R0",
    "2,7": "R0",
    "3,7": "C0",
    "1,6": "J0",
    "2,6": "J0",
    "3,6": "R0",
  });
}

describe("the engine stands the game up", () => {
  it("opens on the title screen with the whole state present", async () => {
    const harness = await createHarness();
    const snapshot = harness.debug.snapshot(harness.state);

    expect(snapshot.version).toBe(1);
    expect(snapshot.screen).toBe("title");
    expect(snapshot.menuIndex).toBe(0);
    expect(snapshot.board).toEqual({ cols: 0, rows: 0, cells: [] });
    expect(snapshot.score).toBe(0);
    expect(snapshot.level).toBe(1);
    expect(snapshot.levelTarget).toBe(2000);
    expect(snapshot.phase).toBe("idle");
    expect(snapshot.rngState).toBe(DEFAULT_SEED);
    expect(snapshot.simTime).toBe(0);
    expect(snapshot.selection).toBeNull();
    expect(snapshot.refusal).toBeNull();
  });

  it("runs frames, accumulating simulated time on the title screen", async () => {
    const harness = await createHarness();
    await harness.engine.advance(30);

    expect(harness.state.simTime).toBeCloseTo(0.5, 6);
    expect(harness.engine.frame().count).toBe(30);
    expect(harness.state.screen).toBe("title");
  });

  it("loops the title bed on the title screen and swaps it for the play bed", async () => {
    const harness = await createHarness();
    await harness.engine.advance(1);
    expect(harness.looped).toEqual([MUSIC_TITLE]);

    harness.pose((state) => harness.debug.start(state));
    await harness.engine.advance(1);
    expect(harness.looped).toEqual([MUSIC_TITLE, MUSIC_PLAY]);
  });
});

describe("the keyboard drives the menus", () => {
  it("moves the highlight and wraps at both ends", async () => {
    const harness = await createHarness();
    harness.tap("ArrowDown");
    await harness.engine.advance(1);
    expect(harness.state.menuIndex).toBe(1);

    harness.tap("ArrowDown");
    await harness.engine.advance(1);
    expect(harness.state.menuIndex).toBe(0);

    harness.tap("ArrowUp");
    await harness.engine.advance(1);
    expect(harness.state.menuIndex).toBe(TITLE_ITEMS.length - 1);
  });

  it("acts on every action armed in one frame, in order", async () => {
    // A move and a confirm arriving between two repaints must both take: the
    // engine discards an edge left unconsumed at the end of the frame, so a
    // build that acted on one action per frame would swallow the confirm.
    const harness = await createHarness();
    harness.tapTogether("ArrowDown", "Enter");
    await harness.engine.advance(1);
    expect(harness.state.screen).toBe("howto");

    harness.tap("Escape");
    await harness.engine.advance(1);
    expect(harness.state.screen).toBe("title");
    expect(harness.state.menuIndex).toBe(0);
  });

  it("starts a round from PLAY, dealt through the game's own code", async () => {
    const harness = await createHarness();
    harness.tap("Enter");
    await harness.engine.advance(1);

    const snapshot = harness.debug.snapshot(harness.state);
    expect(snapshot.screen).toBe("playing");
    expect(snapshot.board.cols).toBe(GRID_COLS);
    expect(snapshot.board.rows).toBe(GRID_ROWS);
    expect(snapshot.board.cells).toHaveLength(GRID_COLS * GRID_ROWS);
    expect(snapshot.board.cells.every((cell) => cell.cut === "plain")).toBe(
      true,
    );
    expect(snapshot.legalSwap).toBe(true);
    expect(snapshot.cursor).toEqual({ col: 0, row: 0 });
  });

  it("pauses and resumes with the pause key, holding the board", async () => {
    const harness = await createHarness();
    harness.pose((state) => harness.debug.start(state));
    const board = harness.debug.snapshot(harness.state).board;

    harness.tap("KeyP");
    await harness.engine.advance(1);
    expect(harness.state.screen).toBe("paused");

    await harness.engine.advance(30);
    harness.tap("KeyP");
    await harness.engine.advance(1);
    expect(harness.state.screen).toBe("playing");
    expect(harness.debug.snapshot(harness.state).board).toEqual(board);
  });

  it("moves the cursor with the arrows and clamps it at the edges", async () => {
    const harness = await createHarness();
    harness.pose((state) => harness.debug.start(state));

    harness.tap("ArrowUp");
    await harness.engine.advance(1);
    expect(harness.state.cursor).toEqual({ col: 0, row: 0 });

    harness.tapTogether("ArrowRight", "ArrowDown");
    await harness.engine.advance(1);
    expect(harness.state.cursor).toEqual({ col: 1, row: 1 });
  });

  it("toggles the engine's mute bit and mirrors it into the state", async () => {
    const harness = await createHarness();
    expect(harness.state.muted).toBe(false);

    harness.tap("KeyM");
    await harness.engine.advance(1);
    expect(harness.state.muted).toBe(true);

    harness.tap("KeyM");
    await harness.engine.advance(1);
    expect(harness.state.muted).toBe(false);
  });
});

describe("a swap on a posed board", () => {
  it("resolves a chain and plays the cues the frame raised", async () => {
    const harness = await createHarness();
    harness.pose((state) => harness.debug.loadBoard(state, threeInARow()));
    harness.played.length = 0;

    // The cursor's cell and then its neighbor: exactly a player's two presses.
    harness.pose((state) => harness.debug.setCursor(state, 3, 2));
    harness.tap("Enter");
    await harness.engine.advance(1);
    expect(harness.state.selection).toEqual({ col: 3, row: 2 });
    expect(harness.played.map((play) => play.cue)).toContain(CUES.select);

    harness.pose((state) => harness.debug.setCursor(state, 3, 1));
    harness.played.length = 0;
    harness.tap("Enter");
    await harness.engine.advance(1);

    const snapshot = harness.debug.snapshot(harness.state);
    expect(snapshot.lastCleared).toBe(3);
    expect(snapshot.lastPoints).toBe(30);
    expect(snapshot.score).toBe(30);
    expect(snapshot.phase).toBe("resolving");
    expect(snapshot.selection).toBeNull();

    const cues = harness.played.map((play) => play.cue);
    expect(cues).toContain(CUES.swap);
    expect(cues).toContain(CUES.clear);
    // The clear sounds the ladder rung for the step's multiplier, which is 1.
    expect(cues).toContain(ladderCue(1));
  });

  it("refuses a barren swap, marks both cells, and lets the mark expire", async () => {
    const harness = await createHarness();
    harness.pose((state) => harness.debug.loadBoard(state, threeInARow()));
    harness.played.length = 0;

    harness.pose((state) => harness.debug.requestSwap(state, ...BARREN));
    await harness.engine.advance(1);
    expect(harness.debug.snapshot(harness.state).refusal).toEqual({
      a: { col: 6, row: 6 },
      b: { col: 7, row: 6 },
    });
    expect(harness.played.map((play) => play.cue)).not.toContain(CUES.refuse);

    // The mark stands for REFUSAL_SECONDS of game time and then clears.
    await harness.engine.advance(20);
    expect(harness.state.refusal).toBeNull();
  });

  it("plays the refusal cue when a frame refuses the swap", async () => {
    const harness = await createHarness();
    harness.pose((state) => harness.debug.loadBoard(state, threeInARow()));
    harness.pose((state) => harness.debug.setCursor(state, 6, 6));
    harness.tap("Enter");
    await harness.engine.advance(1);
    harness.pose((state) => harness.debug.setCursor(state, 7, 6));
    harness.played.length = 0;
    harness.tap("Enter");
    await harness.engine.advance(1);

    expect(harness.played.map((play) => play.cue)).toContain(CUES.refuse);
  });

  it("climbs the ladder as the chain runs on", async () => {
    const harness = await createHarness();
    harness.pose((state) => harness.debug.loadBoard(state, cascade()));
    harness.pose((state) => harness.debug.requestSwap(state, 3, 6, 3, 7));
    harness.played.length = 0;

    // The swap's own step was resolved by the pose, which plays no cue; the
    // step the fall sets off belongs to a frame, and sounds the second rung.
    await harness.engine.advance(60);
    const cues = harness.played.map((play) => play.cue);
    expect(cues).toContain(CUES.clear);
    expect(cues).toContain(ladderCue(2));
    expect(cues).not.toContain(ladderCue(1));

    const snapshot = harness.debug.snapshot(harness.state);
    expect(snapshot.score).toBe(90);
    expect(snapshot.phase).toBe("idle");
  });

  it("completes a level, banks the score, and deals a fresh board", async () => {
    const harness = await createHarness();
    harness.pose((state) => harness.debug.loadBoard(state, threeInARow()));
    harness.pose((state) => harness.debug.setLevelScore(state, 1990));
    harness.pose((state) => harness.debug.requestSwap(state, 3, 1, 3, 2));
    harness.played.length = 0;
    await harness.engine.advance(60);

    const snapshot = harness.debug.snapshot(harness.state);
    expect(snapshot.level).toBe(2);
    expect(snapshot.levelScore).toBe(0);
    expect(snapshot.levelTarget).toBe(4000);
    // `levelScore` is its own figure: 1990 banked plus the step's 30 crossed
    // the target, while `score` counts only what this round actually scored.
    expect(snapshot.score).toBe(30);
    expect(snapshot.legalSwap).toBe(true);
    expect(harness.played.map((play) => play.cue)).toContain(CUES.levelUp);
  });

  it("settles the chain and refills every cell", async () => {
    const harness = await createHarness();
    harness.pose((state) => harness.debug.loadBoard(state, threeInARow()));
    harness.pose((state) => harness.debug.requestSwap(state, 3, 1, 3, 2));
    await harness.engine.advance(60);

    const snapshot = harness.debug.snapshot(harness.state);
    expect(snapshot.phase).toBe("idle");
    expect(snapshot.chainStep).toBe(0);
    expect(snapshot.stepTimer).toBe(0);
    expect(snapshot.board.cells).toHaveLength(GRID_COLS * GRID_ROWS);
    expect(
      snapshot.board.cells.every(
        (cell) => cell.kind !== null || cell.cut === "prism",
      ),
    ).toBe(true);
  });
});

describe("the pointer plays the board", () => {
  it("selects on a press and swaps on a drag onto the neighbor", async () => {
    const harness = await createHarness();
    harness.pose((state) => harness.debug.loadBoard(state, threeInARow()));

    const [fromX, fromY] = cellCenter({ col: 3, row: 2 });
    const [toX, toY] = cellCenter({ col: 3, row: 1 });
    harness.point("pointerdown", fromX, fromY);
    await harness.engine.advance(1);
    expect(harness.state.selection).toEqual({ col: 3, row: 2 });
    expect(harness.state.pointer.down).toBe(true);

    harness.point("pointermove", toX, toY);
    await harness.engine.advance(1);
    expect(harness.state.selection).toBeNull();
    expect(harness.debug.snapshot(harness.state).lastCleared).toBe(3);

    harness.point("pointerup", toX, toY);
    await harness.engine.advance(1);
    expect(harness.state.pointer.down).toBe(false);
  });

  it("ignores a press that lands on no cell", async () => {
    const harness = await createHarness();
    harness.pose((state) => harness.debug.loadBoard(state, threeInARow()));
    const before = harness.debug.snapshot(harness.state);

    harness.point("pointerdown", 20, 20);
    await harness.engine.advance(1);
    expect(harness.state.selection).toBeNull();
    expect(harness.state.pointer.down).toBe(true);
    expect(harness.debug.snapshot(harness.state).board).toEqual(before.board);
  });

  it("reads a sweep sample by sample rather than as its last position", async () => {
    // Both samples land in one input frame, so the drag is only seen if the
    // frame resolves them in arrival order.
    const harness = await createHarness();
    harness.pose((state) => harness.debug.loadBoard(state, threeInARow()));
    const [fromX, fromY] = cellCenter({ col: 3, row: 2 });
    const [toX, toY] = cellCenter({ col: 3, row: 1 });

    harness.point("pointerdown", fromX, fromY);
    harness.point("pointermove", toX, toY);
    await harness.engine.advance(1);

    expect(harness.debug.snapshot(harness.state).lastCleared).toBe(3);
  });

  it("mirrors the pointer position into the state every frame", async () => {
    const harness = await createHarness();
    harness.point("pointermove", BOARD_CX, 200);
    await harness.engine.advance(1);
    expect(harness.state.pointer).toEqual({
      x: BOARD_CX,
      y: 200,
      down: false,
    });
  });
});

describe("the simulation is deterministic", () => {
  /** A round from a known seed, advanced as `frames` frames of `stepMs`. */
  async function play(stepMs: number, frames: number): Promise<FacetState> {
    const harness = await createHarness();
    harness.engine.setClock(new ConstantClock(stepMs));
    harness.pose((state) => harness.debug.reset(state, { seed: 7 }));
    harness.pose((state) => harness.debug.start(state));
    harness.pose((state) => harness.debug.loadBoard(state, threeInARow()));
    harness.pose((state) => harness.debug.requestSwap(state, 3, 1, 3, 2));
    await harness.engine.advance(frames);
    return harness.state as FacetState;
  }

  it("reaches the same state however the interval was divided", async () => {
    const coarse = await play(1000, 1);
    const fine = await play(1000 / 60, 60);

    expect(coarse.rngState).toBe(fine.rngState);
    expect(coarse.score).toBe(fine.score);
    expect(coarse.board).toEqual(fine.board);
    expect(coarse.phase).toBe(fine.phase);
    expect(coarse.simTime).toBeCloseTo(fine.simTime, 6);
  });

  it("replays a seeded deal exactly", async () => {
    const deal = async (): Promise<FacetState> => {
      const harness = await createHarness();
      harness.pose((state) => harness.debug.reset(state, { seed: 99 }));
      harness.pose((state) => harness.debug.start(state));
      return harness.state as FacetState;
    };

    expect((await deal()).board).toEqual((await deal()).board);
  });
});

describe("the produced files", () => {
  it("all load through the engine's own asset path", async () => {
    serveAssets();
    const harness = await createHarness();

    // Every image and system the manifest names arrived. The sounds are the
    // one thing that cannot: Node has no `AudioContext` for the engine to
    // decode a `.wav` into, so those eighteen fail and fall back.
    expect(harness.failed.filter((path) => !path.startsWith("audio/"))).toEqual(
      [],
    );
    expect(harness.failed).toHaveLength(18);
    const manifest = assetManifest();
    const total =
      Object.keys(manifest.images).length +
      Object.keys(manifest.systems).length;
    expect(total).toBe(88);
    await harness.engine.advance(1);
    expect(harness.state.screen).toBe("title");
  });

  it("keep the game playable when not one of them arrives", async () => {
    const harness = await createHarness();
    // Nothing was served, so every load failed and every cue fell back.
    expect(harness.failed.length).toBeGreaterThan(100);

    harness.pose((state) => harness.debug.loadBoard(state, threeInARow()));
    harness.pose((state) => harness.debug.requestSwap(state, 3, 1, 3, 2));
    await harness.engine.advance(60);

    expect(harness.debug.snapshot(harness.state).score).toBe(30);
    expect(harness.debug.snapshot(harness.state).phase).toBe("idle");
  });

  it("draws a frame of the real board without throwing", async () => {
    serveAssets();
    const harness = await createHarness();
    harness.pose((state) => harness.debug.start(state));
    await harness.engine.advance(2);

    // The board's own area carries paint, so the stones really drew.
    const [x, y] = cellCenter({ col: 0, row: 0 });
    const pixel = harness.ctx.getImageData(x, y, 1, 1).data;
    expect(pixel[3]).toBeGreaterThan(0);
  });
});
