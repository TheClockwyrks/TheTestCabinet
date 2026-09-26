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
// renderer draws its fallbacks. That is the point: the simulation is what these
// tests are about, and it does not read the renderer at all.

import { createCanvas } from "@napi-rs/canvas";
import type { SKRSContext2D } from "@napi-rs/canvas";
import {
  ConstantClock,
  createEngine,
  type Engine,
  type SurfaceMetrics,
} from "@clockwyrks/simple-2d";
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
import { noAssets } from "./assets";
import { commit, draft } from "./state";
import type { Draft } from "./state";
import { BACKGROUND, createInitialState, game } from "./game";
import type { MoveInput } from "./game";
import { stepGame } from "./simulation";
import type { FxEvent } from "./effects";
import type { DeepcoreState } from "./game";
import type { DeepReadonly } from "ts-essentials";

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
  readonly engine: Engine<DeepcoreState, DeepcoreDebugApi>;
  readonly state: DeepReadonly<DeepcoreState>;
  readonly debug: DeepcoreDebugApi;
  readonly ctx: SKRSContext2D;
  readonly cues: CuePlay[];
  readonly loops: string[];
  /** Apply one debug pose, as `engine.apply` does. */
  pose(
    op: (
      debug: DeepcoreDebugApi,
      state: DeepReadonly<DeepcoreState>,
    ) => DeepcoreState,
  ): void;
  /** Advance a counted number of frames. */
  advance(frames: number): Promise<void>;
  /** Advance far enough to cover `seconds` of game time. */
  seconds(seconds: number): Promise<void>;
  hold(action: ActionName): void;
  release(action: ActionName): void;
  tap(action: ActionName): void;
  click(x: number, y: number): void;
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
  const engine = createEngine<DeepcoreState, DeepcoreDebugApi>({
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
  engine.events.on("cue:played", ({ cue, gain }) => cues.push({ cue, gain }));
  engine.events.on("cue:looped", ({ cue }) => loops.push(cue));

  await engine.initialize();

  return {
    engine,
    get state() {
      return engine.state;
    },
    // Read off the engine rather than built here, so a build that failed to hand
    // its surface over would fail at once.
    debug: engine.debug,
    ctx,
    cues,
    loops,
    pose(op) {
      engine.apply((state) => op(engine.debug, state));
    },
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
    dispose: () => engine.destroy(),
  };
}

// ---- Scenes -------------------------------------------------------------

/** An emptied mine on the in-mine screen, which every posed scene starts from. */
export function openScene(h: Harness): void {
  h.pose((debug, state) => debug.reset(state));
  h.pose((debug, state) => debug.clearMine(state));
  h.pose((debug, state) => debug.setScreen(state, "in-mine"));
}

/** Lay a floor of plain rock across the playable width of one row. */
export function layFloor(h: Harness, row: number): void {
  for (let col = PLAYABLE_COL_MIN; col <= PLAYABLE_COL_MAX; col += 1) {
    h.pose((debug, state) => debug.setTile(state, col, row, "rock"));
  }
}

/** Stand the miner on top of the cell `(col, row)`, centered on its column. */
export function standOn(h: Harness, col: number, row: number): void {
  h.pose((debug, state) =>
    debug.setMinerPosition(
      state,
      col * TILE + (TILE - MINER_W) / 2,
      row * TILE - MINER_H,
    ),
  );
  h.pose((debug, state) => debug.setMinerVelocity(state, 0, 0));
}

/** Put the miner's box at a world position, at rest. */
export function placeAt(h: Harness, x: number, y: number): void {
  h.pose((debug, state) => debug.setMinerPosition(state, x, y));
  h.pose((debug, state) => debug.setMinerVelocity(state, 0, 0));
}

/** The world y a miner standing on top of `row` rests its box at. */
export function feetOn(row: number): number {
  return row * TILE - MINER_H;
}

// ---- Posing a state without an engine ------------------------------------

/**
 * A state with no loaded assets, on the in-mine screen over an empty mine.
 *
 * A rule that never reads the renderer can be exercised over one of these
 * directly, with no engine and no canvas: open a draft, run the rule, and read
 * the state it leaves. The frame's own tests still go through the engine.
 */
export function bareState(): DeepcoreState {
  const state = createInitialState(noAssets());
  return inDraft(state, (d) => {
    d.screen = "in-mine";
  });
}

/** Run one transition over a draft of `state` and return what it leaves. */
export function inDraft(
  state: DeepReadonly<DeepcoreState>,
  apply: (d: Draft) => void,
): DeepcoreState {
  const d = draft(state);
  apply(d);
  return commit(d);
}

/** Put the miner's box at a world position, at rest, in a draft. */
export function posedAt(d: Draft, x: number, y: number): void {
  d.miner.x = x;
  d.miner.y = y;
  d.miner.vx = 0;
  d.miner.vy = 0;
}

/** What a run of frames over a draft left behind, output queues included. */
export interface DraftRun {
  state: DeepcoreState;
  fx: FxEvent[];
  cues: CueName[];
  loops: string[];
}

/**
 * Run `seconds` of game time in `frames` whole frames, over drafts, with no
 * engine in the way.
 *
 * The queues a frame raises are collected as they are raised, which is how a
 * check reads what the frame asked to sound or to spark without a canvas and an
 * audio bus taking part.
 */
export function runFrames(
  state: DeepReadonly<DeepcoreState>,
  seconds: number,
  frames: number,
): DraftRun {
  const step = seconds / frames;
  const fx: FxEvent[] = [];
  const cues: CueName[] = [];
  const loops = new Set<string>();
  let current: DeepcoreState = commit(draft(state));
  for (let i = 0; i < frames; i += 1) {
    const d = draft(current);
    stepGame(d, step);
    fx.push(...d.fx);
    cues.push(...d.cues);
    for (const loop of d.loops) loops.add(loop);
    // Both queues are drained before the draft closes, exactly as the engine's
    // own `update` drains them once it has played the frame. A helper that left
    // them in place would carry every cue into the state the next frame opens
    // on and hand a check the same cue once per frame that followed it.
    d.fx.length = 0;
    d.cues.length = 0;
    current = commit(d);
  }
  return { state: current, fx, cues, loops: [...loops] };
}

/** Hold a set of actions for the frames that follow, in a draft. */
export function holding(
  state: DeepReadonly<DeepcoreState>,
  input: Partial<MoveInput>,
): DeepcoreState {
  return inDraft(state, (d) => {
    d.input = {
      left: false,
      right: false,
      down: false,
      thrust: false,
      ...input,
    };
  });
}
