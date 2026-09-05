// Deepcore — the harness this build's own tests run the game through.
//
// Not a test itself: `vitest.config.ts` collects `*.test.ts` alone, so this
// module is shared setup rather than a suite. It stands a REAL engine up over an
// `@napi-rs/canvas` canvas and a `SurfaceMetrics` of its own, with a
// `ConstantClock` so an advance of `n` frames is exactly `n * FRAME_MS` of game
// time. There is no browser and no document behind it: the game runs, draws, and
// is posed exactly as it does in a page.
//
// The produced assets are not loaded here — a Node process has no `fetch` for
// them and no `createImageBitmap` — so every sprite comes back `null` and the
// drawing falls back to code. That is the point: the simulation is what these
// tests are about, and it does not read the drawing at all.
//
// The surface reports the canvas at the design size with a device pixel ratio of
// `1` and no origin, so a dispatched event's client position IS a logical stage
// position and a pixel read needs no conversion either.

import { createCanvas } from "@napi-rs/canvas";
import type { SKRSContext2D } from "@napi-rs/canvas";
import {
  ConstantClock,
  createEngine,
  type Engine,
  type SurfaceMetrics,
} from "@clockwyrks/structured-2d";
import {
  MINER_H,
  MINER_W,
  PLAYABLE_COL_MAX,
  PLAYABLE_COL_MIN,
  STAGE_H,
  STAGE_W,
  TILE,
} from "./constants";
import type { ActionName, CueName } from "./constants";
import { ACTIONS } from "./constants";
import type { DeepcoreDebugApi } from "./debug";
import type { FxEvent } from "./effects";
import { BACKGROUND, DeepcoreState, deepcoreState, game } from "./game";
import type { MoveInput } from "./game";
import { stepGame } from "./simulation";

/** The step every advance takes, in milliseconds. */
export const FRAME_MS = 1000 / 60;

/** A keyboard-shaped event, as the engine's own listener reads one. */
class KeyEvent extends Event {
  readonly code: string;
  readonly repeat = false;

  constructor(type: "keydown" | "keyup", code: string) {
    super(type);
    this.code = code;
  }
}

/** A pointer-shaped event, as the engine's own listener reads one. */
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

/** One cue the engine reported playing. */
export interface CuePlay {
  cue: string;
  gain: number;
}

/** A game standing on a real engine, with the levers a test drives it by. */
export interface Harness {
  readonly engine: Engine<DeepcoreDebugApi>;
  /** The world's live game state. */
  readonly state: DeepcoreState;
  /** The surface `initialize` returned, read back off the engine. */
  readonly debug: DeepcoreDebugApi;
  readonly ctx: SKRSContext2D;
  readonly cues: CuePlay[];
  /** Every `cue:looped` the engine emitted, in order. */
  readonly loops: string[];
  /** Every `cue:stopped` the engine emitted, in order. */
  readonly stops: string[];
  /** Advance a counted number of frames. */
  advance(frames: number): Promise<void>;
  /** Advance far enough to cover `seconds` of game time. */
  seconds(seconds: number): Promise<void>;
  hold(action: ActionName): void;
  release(action: ActionName): void;
  tap(action: ActionName): void;
  click(x: number, y: number): void;
  pixel(x: number, y: number): [number, number, number];
  dispose(): void;
}

/** The first key code bound to an action. */
export function keyFor(action: ActionName): string {
  return ACTIONS[action][0];
}

/** An in-memory storage slot, so the save tests have somewhere to write. */
export function installStorage(): void {
  const held = new Map<string, string>();
  const storage = {
    getItem: (key: string) => held.get(key) ?? null,
    setItem: (key: string, value: string) => {
      held.set(key, value);
    },
    removeItem: (key: string) => {
      held.delete(key);
    },
    clear: () => held.clear(),
    key: (index: number) => [...held.keys()][index] ?? null,
    get length() {
      return held.size;
    },
  };
  Object.defineProperty(globalThis, "localStorage", {
    value: storage,
    configurable: true,
    writable: true,
  });
}

/** Take the storage slot away again, as a browser that blocks site data does. */
export function removeStorage(): void {
  Object.defineProperty(globalThis, "localStorage", {
    value: undefined,
    configurable: true,
    writable: true,
  });
}

/** Stand a fresh engine up over the game and resolve once it has initialized. */
export async function createHarness(): Promise<Harness> {
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

  // Exactly the options `src/main.ts` passes, plus the clock and the surface a
  // headless run needs.
  const engine = createEngine({
    canvas: element,
    width: STAGE_W,
    height: STAGE_H,
    game,
    background: BACKGROUND,
    clock: new ConstantClock(FRAME_MS),
    surface,
  });

  const cues: CuePlay[] = [];
  const loops: string[] = [];
  const stops: string[] = [];
  engine.events.on("cue:played", ({ cue, gain }) => cues.push({ cue, gain }));
  engine.events.on("cue:looped", ({ cue }) => loops.push(cue));
  engine.events.on("cue:stopped", ({ cue }) => stops.push(cue));

  await engine.initialize();

  return {
    engine,
    get state() {
      return deepcoreState(engine.world);
    },
    // Read off the engine rather than built here, so a build that failed to hand
    // its surface over would fail at once.
    debug: engine.debug,
    ctx,
    cues,
    loops,
    stops,
    advance: (frames) => engine.advance(frames),
    seconds: (span) => engine.advance(Math.round((span * 1000) / FRAME_MS)),
    hold: (action) => {
      events.dispatchEvent(new KeyEvent("keydown", keyFor(action)));
    },
    release: (action) => {
      events.dispatchEvent(new KeyEvent("keyup", keyFor(action)));
    },
    tap: (action) => {
      events.dispatchEvent(new KeyEvent("keydown", keyFor(action)));
      events.dispatchEvent(new KeyEvent("keyup", keyFor(action)));
    },
    click: (x, y) => {
      events.dispatchEvent(new PointerEvt("pointerdown", x, y));
      events.dispatchEvent(new PointerEvt("pointerup", x, y));
    },
    pixel: (x, y) => {
      const { data } = ctx.getImageData(Math.round(x), Math.round(y), 1, 1);
      return [data[0], data[1], data[2]];
    },
    dispose: () => engine.destroy(),
  };
}

// ---- Scenes -------------------------------------------------------------

/** An emptied mine on the in-mine screen, which every posed scene starts from. */
export function openScene(h: Harness): void {
  h.debug.reset();
  h.debug.clearMine();
  h.debug.setScreen("in-mine");
}

/** Lay a floor of plain rock across the playable width of one row. */
export function layFloor(h: Harness, row: number): void {
  for (let col = PLAYABLE_COL_MIN; col <= PLAYABLE_COL_MAX; col += 1) {
    h.debug.setTile(col, row, "rock");
  }
}

/** Stand the miner on top of the cell `(col, row)`, centered on its column. */
export function standOn(h: Harness, col: number, row: number): void {
  h.debug.setMinerPosition(
    col * TILE + (TILE - MINER_W) / 2,
    row * TILE - MINER_H,
  );
  h.debug.setMinerVelocity(0, 0);
}

/** Put the miner's box at a world position, at rest. */
export function placeAt(h: Harness, x: number, y: number): void {
  h.debug.setMinerPosition(x, y);
  h.debug.setMinerVelocity(0, 0);
}

/** The world y a miner standing on top of `row` rests its box at. */
export function feetOn(row: number): number {
  return row * TILE - MINER_H;
}

// ---- Posing a state without an engine ------------------------------------

/**
 * A state with no loaded assets, on the in-mine screen over an empty mine.
 *
 * A rule that never reads the drawing can be exercised over one of these
 * directly, with no engine and no canvas: build one, run the rule, and read what
 * it left. The state is the world's game state class, constructed outside a
 * world — nothing in this build reads the `world` the framework would have
 * assigned it. The frame's own tests still go through the engine.
 */
export function bareState(): DeepcoreState {
  const state = new DeepcoreState();
  state.screen = "in-mine";
  return state;
}

/** Put the miner's box at a world position, at rest. */
export function posedAt(state: DeepcoreState, x: number, y: number): void {
  state.miner.x = x;
  state.miner.y = y;
  state.miner.vx = 0;
  state.miner.vy = 0;
}

/** What a run of frames over a bare state left behind, output queues included. */
export interface StateRun {
  state: DeepcoreState;
  fx: FxEvent[];
  cues: CueName[];
  loops: string[];
}

/**
 * Run `seconds` of game time in `frames` whole frames, with no engine in the way.
 *
 * The queues a frame raises are drained as they are raised, which is how a check
 * reads what each frame asked to sound or to spark without a canvas and an audio
 * bus taking part — and reads it once per raise rather than once per frame it
 * stayed queued.
 */
export function runFrames(
  state: DeepcoreState,
  seconds: number,
  frames: number,
): StateRun {
  const step = seconds / frames;
  const fx: FxEvent[] = [];
  const cues: CueName[] = [];
  const loops = new Set<string>();
  for (let i = 0; i < frames; i += 1) {
    state.loops.clear();
    stepGame(state, step);
    fx.push(...state.fx);
    state.fx.length = 0;
    cues.push(...state.cues);
    state.cues.length = 0;
    for (const loop of state.loops) loops.add(loop);
  }
  return { state, fx, cues, loops: [...loops] };
}

/**
 * Run one transition over a state and return the state it left.
 *
 * The state is a live object, so this mutates the one it is given rather than
 * producing a second: a check that wants a before and an after reads the before
 * off the state first.
 */
export function posing(
  state: DeepcoreState,
  apply: (d: DeepcoreState) => void,
): DeepcoreState {
  apply(state);
  return state;
}

/** Hold a set of actions for the frames that follow. */
export function holding(
  state: DeepcoreState,
  input: Partial<MoveInput>,
): DeepcoreState {
  state.input = {
    left: false,
    right: false,
    down: false,
    thrust: false,
    ...input,
  };
  return state;
}
