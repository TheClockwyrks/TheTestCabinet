// Fathom — the rig this build's own tests drive the whole game through.
//
// The game is written against the runtime's three small interfaces, so a test
// needs no browser to run it: this module supplies a keyboard whose keys a test
// holds and releases, an audio bus that records what it was asked to play, a
// clock the debug surface can be handed, and a real 2D context from
// `@napi-rs/canvas` for the renderer to draw through.
//
// Scaffolding for `src/**/*.test.ts` alone; nothing the game ships reaches it.

import { createCanvas, type SKRSContext2D } from "@napi-rs/canvas";
import type { Assets } from "./assets";
import { DRIFTER_INTERVAL, TICK_DT } from "./constants";
import type { DebugClock } from "./debug";
import {
  buildRoster,
  createFathom,
  denPredators,
  fillPlankton,
  poseMaze,
  type FathomState,
} from "./game";
import type { PointerSample, PointerSampleType } from "./pointer";
import type { Game, InitApi, TickApi } from "./runtime";

/**
 * Sheets of blank 32 x 32 canvases, one per frame the real sheets carry.
 *
 * The renderer only ever asks a sheet for a frame to draw, so a blank canvas
 * exercises every draw call the real art would without decoding a PNG. The cast
 * is the one place this build treats a `@napi-rs/canvas` surface as the DOM
 * image source the renderer is typed against; the two are compatible in every
 * respect the renderer uses.
 */
export function stubAssets(): Assets {
  const sheet = (frames: number): CanvasImageSource[] =>
    Array.from(
      { length: frames },
      () => createCanvas(32, 32) as unknown as CanvasImageSource,
    );
  return {
    forager: sheet(8),
    lanternjaw: sheet(16),
    gloamfin: sheet(8),
    flarefish: sheet(8),
    drifter: sheet(8),
    trench: sheet(19),
    flareBloom: sheet(8),
  };
}

/** The whole game, driveable tick by tick with no browser under it. */
export interface Harness {
  readonly state: FathomState;
  readonly game: Game<FathomState>;
  /** The clock the debug surface is handed. */
  readonly clock: DebugClock;
  /** Every cue the game asked to play, in order, across the whole run. */
  readonly cues: string[];
  /** Hold an action down, as a key held. */
  hold(action: string): void;
  /** Let an action up. */
  release(action: string): void;
  /** Press and release an action, arming one edge. */
  press(action: string): void;
  /**
   * Deliver one pointer sample at a logical point, as the runtime's pointer
   * layer would. It is read by the next tick and dropped with it.
   */
  point(
    type: PointerSampleType,
    x: number,
    y: number,
    device?: PointerSample["device"],
  ): void;
  /** Run whole ticks. */
  advance(ticks: number): void;
  /** Draw one frame through a real 2D context, at the given interpolation. */
  draw(alpha?: number): void;
  /** Every diagnostic source the game registered, by name. */
  readonly diagnostics: Map<string, () => unknown>;
}

export function harness(): Harness {
  const held = new Set<string>();
  const edges = new Set<string>();
  const bound = new Map<string, readonly string[]>();
  const cues: string[] = [];
  const diagnostics = new Map<string, () => unknown>();
  let muted = false;
  let stepping = true;
  /** What the pointer did this tick, as a check hands it in through `point`. */
  let pointerSamples: PointerSample[] = [];

  const canvas = createCanvas(1280, 720);
  const ctx = canvas.getContext("2d") as unknown as CanvasRenderingContext2D;

  const initApi: InitApi = {
    input: { register: (name, keys) => void bound.set(name, keys) },
    audio: { define: () => undefined },
    diagnostics: {
      register: (name, source) => void diagnostics.set(name, source),
    },
  };

  const tickApi: TickApi = {
    input: {
      value: (name) => (held.has(name) ? 1 : 0),
      pressed: (name) => {
        if (!edges.has(name)) return false;
        edges.delete(name);
        return true;
      },
      pointer: () => pointerSamples,
    },
    audio: {
      play: (cue) => void cues.push(cue),
      setMuted: (next) => {
        muted = next;
      },
      muted: () => muted,
    },
  };

  const game = createFathom(stubAssets());
  const state = game.initialize(initApi);

  function advance(ticks: number): void {
    for (let i = 0; i < ticks; i += 1) {
      game.tick(state, tickApi, TICK_DT);
      // Edges and pointer samples are news for exactly one tick, as they are
      // under the runtime.
      edges.clear();
      pointerSamples = [];
    }
  }

  return {
    state,
    game,
    cues,
    diagnostics,
    clock: {
      autoStep: () => stepping,
      setAutoStep: (enabled) => {
        stepping = enabled;
      },
      advance,
    },
    hold(action) {
      if (!held.has(action)) edges.add(action);
      held.add(action);
    },
    release(action) {
      held.delete(action);
    },
    press(action) {
      edges.add(action);
    },
    point(type, x, y, device = "mouse") {
      pointerSamples.push({ type, x, y, device });
    },
    advance,
    draw(alpha = 0) {
      game.render(state, { ctx, alpha });
    },
  };
}

/** A blank 2D context of the stage's size, for a test that draws directly. */
export function stageContext(): {
  ctx: CanvasRenderingContext2D;
  read(x: number, y: number): [number, number, number, number];
} {
  const canvas = createCanvas(1280, 720);
  const ctx = canvas.getContext("2d") as SKRSContext2D;
  return {
    ctx: ctx as unknown as CanvasRenderingContext2D,
    read(x, y) {
      const d = ctx.getImageData(x, y, 1, 1).data;
      return [d[0], d[1], d[2], d[3]];
    },
  };
}

/**
 * Pose a whole board fixture: the layout loaded, a plankton on every corridor
 * tile, the fog back to unrevealed, the forager at rest on the layout's resting
 * tile, and the current depth's roster back in the den unreleased.
 *
 * The debugging surface has no operation that arranges all of that at once, and
 * it should not: a caller of `window.__fathom` says each of those things in its
 * own call and gets nothing it did not ask for. This is scaffolding for the
 * build's own tests, where the setup is not the thing under test.
 */
export function poseBoard(state: FathomState, rows: readonly string[]): void {
  poseMaze(state, rows);
  state.fog.reset();
  fillPlankton(state);
  state.forager.placeOn(state.maze.start.col, state.maze.start.row);
  state.desired = null;
  state.drifters = [];
  state.waves = [];
  state.ink.clear();
  state.effects.clear();
  state.drifterTimer = DRIFTER_INTERVAL;
  buildRoster(state);
  denPredators(state);
}

/** Turn every creature's mind off, holding each exactly where it stands. */
export function stillCreatures(state: FathomState): void {
  for (const p of state.predators) p.mind = false;
  for (const d of state.drifters) d.mind = false;
}
