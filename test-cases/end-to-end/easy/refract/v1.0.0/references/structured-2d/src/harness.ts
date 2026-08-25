// The test harness the build's own suite stands the game up with.
//
// A harness builds a REAL engine over an `@napi-rs/canvas` canvas and a
// `SurfaceMetrics` of its own, so the game runs with no browser and no
// document behind it, and steps it with `engine.advance` against a
// `ConstantClock`. Keys and the pointer are driven by dispatching
// keyboard-shaped and pointer-shaped events at the surface's event target —
// the same listeners a player's input reaches — and what is read back is the
// world's own `RefractState`, the debug surface `initialize` returned, the
// engine's cue events, and the pixels the render produced — the recipe
// `specs/overview.md` states for the build's own tests.
//
// The surface reports the canvas at the design size with a device pixel ratio
// of 1 and no origin, so a dispatched event's client position IS a logical
// stage position, the camera at rest maps world onto logical one to one, and
// a pixel read needs no conversion either.

import { createCanvas, type SKRSContext2D } from "@napi-rs/canvas";
import {
  ConstantClock,
  createEngine,
  type Engine,
  type SurfaceMetrics,
} from "@test-cabinet/structured-2d";
import { cellCenter } from "./board";
import { LAYOUT, STAGE_H, STAGE_W } from "./constants";
import {
  BACKGROUND,
  game,
  refractState,
  type Cell,
  type RefractDebugApi,
  type RefractState,
} from "./game";

export const FRAME_MS = 1000 / 60;

export class KeyEvent extends Event {
  readonly code: string;
  readonly repeat = false;

  constructor(type: "keydown" | "keyup", code: string) {
    super(type);
    this.code = code;
  }
}

export class PointerEvt extends Event {
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

export interface CuePlay {
  cue: string;
  gain: number;
}

export interface Harness {
  readonly engine: Engine<RefractDebugApi>;
  /** The world's live game state. */
  readonly state: RefractState;
  /** The surface `initialize` returned, read back off the engine. */
  readonly debug: RefractDebugApi;
  readonly ctx: SKRSContext2D;
  /** Every `cue:played` the engine emitted, in order. */
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

  // Exactly the options src/main.ts passes, plus the clock and the surface a
  // headless run needs.
  const engine = createEngine({
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

  return {
    engine,
    get state() {
      return refractState(engine.world);
    },
    // Read off the engine rather than built here, so a build that failed to
    // return the surface from `initialize` fails here.
    debug: engine.debug,
    ctx,
    cues,
    tap: (code) => {
      events.dispatchEvent(new KeyEvent("keydown", code));
      events.dispatchEvent(new KeyEvent("keyup", code));
    },
    pointer: dispatchPointer,
    drag: async (cells) => {
      const board = refractState(engine.world).board;
      const centers = cells.map((cell) => cellCenter(cell, board));
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
}
