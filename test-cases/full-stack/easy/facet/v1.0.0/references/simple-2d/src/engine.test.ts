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
} from "@clockwyrks/simple-2d";
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
  LEVELCLEAR_ITEMS,
  STAGE_H,
  STAGE_W,
  TITLE_ITEMS,
} from "./constants";
import { cellCenter, targetsFor, type Cell } from "./core";
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
  readonly isPrimary: boolean;
  readonly pointerType: string;

  constructor(
    type: "pointerdown" | "pointermove" | "pointerup",
    x: number,
    y: number,
    pointerType = "mouse",
    isPrimary = true,
  ) {
    super(type);
    this.clientX = x;
    this.clientY = y;
    this.pointerType = pointerType;
    this.isPrimary = isPrimary;
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
    pointerType?: string,
    isPrimary?: boolean,
  ): void;
  /** Take hold of a cell, carry onto another, and let go: one whole move. */
  play(from: Cell, to: Cell, pointerType?: string): void;
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
    point: (type, x, y, pointerType, isPrimary) => {
      events.dispatchEvent(new PointerEvt(type, x, y, pointerType, isPrimary));
    },
    play: (from, to, pointerType) => {
      const [fromX, fromY] = cellCenter(from);
      const [toX, toY] = cellCenter(to);
      events.dispatchEvent(
        new PointerEvt("pointerdown", fromX, fromY, pointerType),
      );
      events.dispatchEvent(
        new PointerEvt("pointermove", toX, toY, pointerType),
      );
      events.dispatchEvent(new PointerEvt("pointerup", toX, toY, pointerType));
    },
    pose: (operation) => {
      engine.apply((state) => operation(state));
    },
    dispose: () => {
      engine.destroy();
    },
  };
}

/**
 * A round begun the way a caller begins one. The surface carries no operation
 * that arranges a whole round at once (specs/instrumentation.md), so the
 * figures a round starts with are written one at a time, a board is dealt, and
 * the playing screen is shown.
 */
function startRound(harness: Harness): void {
  const d = harness.debug;
  harness.pose((state) => d.setScore(state, 0));
  harness.pose((state) => d.setLevel(state, 1));
  harness.pose((state) => d.setLevelScore(state, 0));
  harness.pose((state) => d.setMoveScore(state, 0));
  harness.pose((state) => d.setBestMove(state, 0));
  harness.pose((state) => d.setBestChain(state, 0));
  harness.pose((state) => d.clearSelection(state));
  harness.pose((state) => d.clearOffer(state));
  harness.pose((state) => d.clearRefusal(state));
  harness.pose((state) => d.clearChain(state));
  harness.pose((state) => d.dealBoard(state));
  harness.pose((state) => d.setMenuIndex(state, 0));
  harness.pose((state) => d.setScreen(state, "playing"));
}

/**
 * A round in play with a board of its own posed onto it. A swap asked for off
 * the `playing` screen is not a request at all, and `loadBoard` writes the
 * board and nothing else (specs/instrumentation.md), so the round is begun
 * first and the fixture board written over the one it dealt.
 */
function poseRound(harness: Harness, rows: string[]): void {
  startRound(harness);
  harness.pose((state) => harness.debug.loadBoard(state, rows));
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

/**
 * A board whose one productive swap — `(3, 2)` against `(4, 2)` — completes a
 * VERTICAL run of three rubies down the top of column `3`. R9 then refills that
 * column's three emptied cells from above the board, so the step's longest fall
 * is three rows, which is past `LAND_MIN_ROWS` and therefore audible.
 */
function tallFall(): string[] {
  return quietRowsWith({
    "3,0": "R0",
    "3,1": "R0",
    "3,2": "C0",
    "4,2": "R0",
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
    expect(snapshot.offer).toBeNull();
    expect(snapshot.refusal).toBeNull();
    expect(snapshot.armedTarget).toBeNull();
    expect(snapshot.targets.map((target) => target.id)).toEqual([
      "menu-0",
      "menu-1",
    ]);
    expect(snapshot.pointer.device).toBe("mouse");
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

    startRound(harness);
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
    // `back` puts a player who came in to read the rules back on the item they
    // came in through, rather than at the top of the menu.
    expect(harness.state.menuIndex).toBe(TITLE_ITEMS.indexOf("HOW TO PLAY"));
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
    // The whole board is dealt in from above, so every stone traveled.
    expect(
      snapshot.board.cells.every((cell) => cell.fell >= cell.row + 1),
    ).toBe(true);
  });

  it("pauses and resumes with the pause key, holding the board", async () => {
    const harness = await createHarness();
    startRound(harness);
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

  it("raises and drops the pause menu with one Escape, which fires both", async () => {
    // `Escape` is bound to `pause` AND to `back`, and the two act on screens
    // that do not overlap, so one key does the right thing on every screen.
    const harness = await createHarness();
    startRound(harness);

    harness.tap("Escape");
    await harness.engine.advance(1);
    expect(harness.state.screen).toBe("paused");

    harness.tap("Escape");
    await harness.engine.advance(1);
    expect(harness.state.screen).toBe("playing");
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

describe("a move played on a posed board", () => {
  it("resolves a chain and plays the cues the frames raised", async () => {
    const harness = await createHarness();
    poseRound(harness, threeInARow());
    harness.played.length = 0;

    // Take hold of a stone, carry it onto its neighbor, and let go.
    harness.play({ col: 3, row: 2 }, { col: 3, row: 1 });
    await harness.engine.advance(1);

    const accepted = harness.debug.snapshot(harness.state);
    expect(accepted.phase).toBe("swapping");
    expect(accepted.selection).toBeNull();
    expect(accepted.offer).toBeNull();
    // Nothing has shattered while the two stones are still travelling.
    expect(accepted.lastCleared).toBe(0);

    const cues = harness.played.map((play) => play.cue);
    expect(cues).toContain(CUES.select);
    expect(cues).toContain(CUES.swap);

    harness.played.length = 0;
    await harness.engine.advance(30);

    const snapshot = harness.debug.snapshot(harness.state);
    expect(snapshot.lastCleared).toBe(3);
    expect(snapshot.lastPoints).toBe(30);
    expect(snapshot.score).toBe(30);
    const after = harness.played.map((play) => play.cue);
    expect(after).toContain(CUES.clear);
    // The clear sounds the ladder rung for the step's multiplier, which is 1.
    expect(after).toContain(ladderCue(1));
  });

  it("plays nothing where the hold is carried back where it started", async () => {
    const harness = await createHarness();
    poseRound(harness, threeInARow());
    const before = harness.debug.snapshot(harness.state).board;

    const [fromX, fromY] = cellCenter({ col: 3, row: 2 });
    const [toX, toY] = cellCenter({ col: 3, row: 1 });
    harness.point("pointerdown", fromX, fromY);
    harness.point("pointermove", toX, toY);
    await harness.engine.advance(1);
    expect(harness.state.offer).toEqual({ col: 3, row: 1 });

    harness.point("pointermove", fromX, fromY);
    harness.point("pointerup", fromX, fromY);
    await harness.engine.advance(1);

    const snapshot = harness.debug.snapshot(harness.state);
    expect(snapshot.offer).toBeNull();
    expect(snapshot.phase).toBe("idle");
    expect(snapshot.board).toEqual(before);
  });

  it("refuses a barren swap, marks both cells, and lets the mark expire", async () => {
    const harness = await createHarness();
    poseRound(harness, threeInARow());
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

  it("plays the refusal cue when a frame refuses the move", async () => {
    const harness = await createHarness();
    poseRound(harness, threeInARow());
    harness.played.length = 0;
    harness.play({ col: 6, row: 6 }, { col: 7, row: 6 });
    await harness.engine.advance(1);

    expect(harness.played.map((play) => play.cue)).toContain(CUES.refuse);
  });

  it("climbs the ladder as the chain runs on", async () => {
    const harness = await createHarness();
    poseRound(harness, cascade());
    harness.pose((state) => harness.debug.requestSwap(state, 3, 6, 3, 7));
    harness.played.length = 0;

    // The pose put the swap in motion and played no cue; both steps of the
    // chain belong to frames, so both rungs sound, the lower one first.
    await harness.engine.advance(120);
    const cues = harness.played.map((play) => play.cue);
    expect(cues).toContain(CUES.clear);
    expect(cues.indexOf(ladderCue(1))).toBeGreaterThanOrEqual(0);
    expect(cues.indexOf(ladderCue(2))).toBeGreaterThan(
      cues.indexOf(ladderCue(1)),
    );

    const snapshot = harness.debug.snapshot(harness.state);
    expect(snapshot.score).toBe(90);
    expect(snapshot.phase).toBe("idle");
    // The move is the whole chain, and the level was measured by it.
    expect(snapshot.bestMove).toBe(90);
    expect(snapshot.bestChain).toBe(2);
  });

  it("sounds the landing of a long fall", async () => {
    const harness = await createHarness();
    poseRound(harness, tallFall());
    harness.pose((state) => harness.debug.requestSwap(state, 3, 2, 4, 2));
    harness.played.length = 0;

    // Three cells cleared down the top of one column: the whole of that gap is
    // refilled from off the board, which is a fall worth hearing.
    await harness.engine.advance(120);
    expect(harness.played.map((play) => play.cue)).toContain(CUES.land);
  });

  it("ends a level onto its own screen without dealing anything", async () => {
    const harness = await createHarness();
    poseRound(harness, threeInARow());
    harness.pose((state) => harness.debug.setLevelScore(state, 1990));
    const board = harness.debug.snapshot(harness.state).board;
    harness.pose((state) => harness.debug.requestSwap(state, 3, 1, 3, 2));
    harness.played.length = 0;
    await harness.engine.advance(120);

    const cleared = harness.debug.snapshot(harness.state);
    expect(cleared.screen).toBe("levelclear");
    expect(cleared.menuIndex).toBe(0);
    // The level is not advanced and no board is dealt: the screen reports what
    // the level was worth, and CONTINUE is what opens the next one.
    expect(cleared.level).toBe(1);
    expect(cleared.levelScore).toBe(2020);
    expect(cleared.bestChain).toBe(1);
    expect(cleared.bestMove).toBe(30);
    expect(cleared.board).not.toEqual(board);
    expect(harness.played.map((play) => play.cue)).toContain(CUES.levelUp);

    // CONTINUE is the first item, and the pointer takes it like any other.
    const [first] = targetsFor("levelclear");
    expect(LEVELCLEAR_ITEMS[0]).toBe("CONTINUE");
    harness.point("pointerdown", first.x + first.w / 2, first.y + first.h / 2);
    harness.point("pointerup", first.x + first.w / 2, first.y + first.h / 2);
    await harness.engine.advance(1);

    const next = harness.debug.snapshot(harness.state);
    expect(next.screen).toBe("playing");
    expect(next.level).toBe(2);
    expect(next.levelScore).toBe(0);
    expect(next.levelTarget).toBe(4000);
    expect(next.bestChain).toBe(0);
    expect(next.bestMove).toBe(0);
    // `score` counts only what this round actually scored, and carries across.
    expect(next.score).toBe(30);
    expect(next.legalSwap).toBe(true);
  });

  it("settles the chain and refills every cell", async () => {
    const harness = await createHarness();
    poseRound(harness, threeInARow());
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
  it("takes hold on a press, offers on a carry, and plays on the release", async () => {
    const harness = await createHarness();
    poseRound(harness, threeInARow());

    const [fromX, fromY] = cellCenter({ col: 3, row: 2 });
    const [toX, toY] = cellCenter({ col: 3, row: 1 });
    harness.point("pointerdown", fromX, fromY);
    await harness.engine.advance(1);
    expect(harness.state.selection).toEqual({ col: 3, row: 2 });
    expect(harness.state.pointer.down).toBe(true);

    harness.point("pointermove", toX, toY);
    await harness.engine.advance(1);
    expect(harness.state.offer).toEqual({ col: 3, row: 1 });
    // Nothing has reached the move rules while the hold is still on.
    expect(harness.state.phase).toBe("idle");

    harness.point("pointerup", toX, toY);
    await harness.engine.advance(1);
    expect(harness.state.pointer.down).toBe(false);
    expect(harness.state.phase).toBe("swapping");

    await harness.engine.advance(30);
    expect(harness.debug.snapshot(harness.state).lastCleared).toBe(3);
  });

  it("plays the board from a finger exactly as from a mouse", async () => {
    const harness = await createHarness();
    poseRound(harness, threeInARow());
    harness.play({ col: 3, row: 2 }, { col: 3, row: 1 }, "touch");
    await harness.engine.advance(30);

    const snapshot = harness.debug.snapshot(harness.state);
    expect(snapshot.pointer.device).toBe("touch");
    expect(snapshot.lastCleared).toBe(3);
  });

  it("acts on the primary pointer alone", async () => {
    const harness = await createHarness();
    poseRound(harness, threeInARow());
    const [x, y] = cellCenter({ col: 3, row: 2 });
    // A second finger resting on the screen changes nothing.
    harness.point("pointerdown", x, y, "touch", false);
    await harness.engine.advance(1);
    expect(harness.state.selection).toBeNull();
  });

  it("works a screen's targets by press and release", async () => {
    const harness = await createHarness();
    const [, second] = targetsFor("title");
    const cx = second.x + second.w / 2;
    const cy = second.y + second.h / 2;

    harness.point("pointermove", cx, cy);
    await harness.engine.advance(1);
    expect(harness.state.menuIndex).toBe(1);

    harness.point("pointerdown", cx, cy);
    await harness.engine.advance(1);
    expect(harness.state.armedTarget).toBe("menu-1");

    harness.point("pointerup", cx, cy);
    await harness.engine.advance(1);
    expect(harness.state.screen).toBe("howto");
    expect(harness.state.armedTarget).toBeNull();

    // And the `back` control on how-to-play leaves it again.
    const [back] = targetsFor("howto");
    harness.point("pointerdown", back.x + back.w / 2, back.y + back.h / 2);
    harness.point("pointerup", back.x + back.w / 2, back.y + back.h / 2);
    await harness.engine.advance(1);
    expect(harness.state.screen).toBe("title");
    // `back` from how-to-play puts the highlight back on the item it came in
    // through, which is the second.
    expect(harness.state.menuIndex).toBe(TITLE_ITEMS.indexOf("HOW TO PLAY"));
  });

  it("reads where a release landed, not where the last move did", async () => {
    // A release carries a position of its own. A press on a menu row that is
    // let go somewhere else takes nothing, and the highlight the press moved
    // stands.
    const harness = await createHarness();
    const [first] = targetsFor("title");
    harness.point("pointerdown", first.x + first.w / 2, first.y + first.h / 2);
    harness.point("pointerup", 20, 20);
    await harness.engine.advance(1);
    expect(harness.state.screen).toBe("title");
    expect(harness.state.armedTarget).toBeNull();

    // And on the board, a hold let go over a neighbor plays that move even
    // where no move sample was delivered between the press and the release.
    poseRound(harness, threeInARow());
    const [fromX, fromY] = cellCenter({ col: 3, row: 2 });
    const [toX, toY] = cellCenter({ col: 3, row: 1 });
    harness.point("pointerdown", fromX, fromY);
    harness.point("pointerup", toX, toY);
    await harness.engine.advance(30);
    expect(harness.debug.snapshot(harness.state).lastCleared).toBe(3);
  });

  it("leaves the board through the pause control without taking a stone", async () => {
    const harness = await createHarness();
    poseRound(harness, threeInARow());
    const [pause] = targetsFor("playing");
    harness.point("pointerdown", pause.x + pause.w / 2, pause.y + pause.h / 2);
    harness.point("pointerup", pause.x + pause.w / 2, pause.y + pause.h / 2);
    await harness.engine.advance(1);

    expect(harness.state.screen).toBe("paused");
    expect(harness.state.selection).toBeNull();
  });

  it("ignores a press that lands on no cell", async () => {
    const harness = await createHarness();
    poseRound(harness, threeInARow());
    const before = harness.debug.snapshot(harness.state);

    harness.point("pointerdown", 20, 20);
    await harness.engine.advance(1);
    expect(harness.state.selection).toBeNull();
    expect(harness.state.pointer.down).toBe(true);
    expect(harness.debug.snapshot(harness.state).board).toEqual(before.board);
  });

  it("reads a sweep sample by sample rather than as its last position", async () => {
    // All three samples land in one input frame, so the carry is only seen if
    // the frame resolves them in arrival order.
    const harness = await createHarness();
    poseRound(harness, threeInARow());
    harness.play({ col: 3, row: 2 }, { col: 3, row: 1 });
    await harness.engine.advance(1);

    expect(harness.state.phase).toBe("swapping");
    await harness.engine.advance(30);
    expect(harness.debug.snapshot(harness.state).lastCleared).toBe(3);
  });

  it("mirrors the pointer position and its device into the state every frame", async () => {
    const harness = await createHarness();
    harness.point("pointermove", BOARD_CX, 200, "pen");
    await harness.engine.advance(1);
    expect(harness.state.pointer).toEqual({
      x: BOARD_CX,
      y: 200,
      down: false,
      device: "pen",
    });
  });
});

describe("the simulation is deterministic", () => {
  /** A round from a known seed, advanced as `frames` frames of `stepMs`. */
  async function play(stepMs: number, frames: number): Promise<FacetState> {
    const harness = await createHarness();
    harness.engine.setClock(new ConstantClock(stepMs));
    harness.pose((state) => harness.debug.reset(state, { seed: 7 }));
    poseRound(harness, threeInARow());
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
      startRound(harness);
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
    // decode a `.wav` into, so those nineteen fail and fall back.
    expect(harness.failed.filter((path) => !path.startsWith("audio/"))).toEqual(
      [],
    );
    expect(harness.failed).toHaveLength(19);
    const manifest = assetManifest();
    const total =
      Object.keys(manifest.images).length +
      Object.keys(manifest.systems).length;
    expect(total).toBe(89);
    await harness.engine.advance(1);
    expect(harness.state.screen).toBe("title");
  });

  it("keep the game playable when not one of them arrives", async () => {
    const harness = await createHarness();
    // Nothing was served, so every load failed and every cue fell back.
    expect(harness.failed.length).toBeGreaterThan(100);

    poseRound(harness, threeInARow());
    harness.pose((state) => harness.debug.requestSwap(state, 3, 1, 3, 2));
    await harness.engine.advance(120);

    expect(harness.debug.snapshot(harness.state).score).toBe(30);
    expect(harness.debug.snapshot(harness.state).phase).toBe("idle");
  });

  it("draws a frame of the real board without throwing", async () => {
    serveAssets();
    const harness = await createHarness();
    startRound(harness);
    await harness.engine.advance(2);

    // The board's own area carries paint, so the stones really drew.
    const [x, y] = cellCenter({ col: 0, row: 0 });
    const pixel = harness.ctx.getImageData(x, y, 1, 1).data;
    expect(pixel[3]).toBeGreaterThan(0);
  });
});
