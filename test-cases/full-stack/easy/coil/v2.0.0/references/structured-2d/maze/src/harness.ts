// The test harness the build's own suite stands the game up with.
//
// A harness builds a REAL engine over an `@napi-rs/canvas` canvas and a
// `SurfaceMetrics` of its own, so the game runs with no browser and no document
// behind it, and steps it with `engine.advance` against a `ConstantClock`. Keys
// are driven by dispatching keyboard-shaped events at the surface's event target
// — the same listener a player's key reaches — and what is read back is the
// world's own `CoilState`, the debug surface `initialize` returned, the engine's
// cue events, and the pixels the render produced.
//
// The surface reports the canvas at the design size with a device pixel ratio of
// 1 and no origin, so the camera at rest maps world onto logical one to one and a
// pixel read needs no conversion.
//
// Nothing in this process can fetch or decode an image, so every produced file
// fails to load here. That is deliberate: the suite runs against a build whose
// assets are unavailable, which is the check that such a build still initializes,
// still ticks, still takes input, and still draws a board. The one place the real
// artwork matters, `src/render.test.ts`, loads it off disk itself.

import { createCanvas, type SKRSContext2D } from "@napi-rs/canvas";
import {
  ConstantClock,
  createEngine,
  type Engine,
  type SurfaceMetrics,
} from "@test-cabinet/structured-2d";
import { cellX, cellY } from "./board";
import { CELL, LAYOUT, STAGE_H, STAGE_W, type Cell } from "./constants";
import {
  BACKGROUND,
  coilState,
  game,
  type CoilDebugApi,
  type CoilState,
} from "./game";

/** The frame the harness runs at when a test does not name an interval. */
export const FRAME_MS = 1000 / 60;

export class KeyEvent extends Event {
  readonly code: string;
  readonly repeat: boolean;

  constructor(type: "keydown" | "keyup", code: string, repeat = false) {
    super(type);
    this.code = code;
    this.repeat = repeat;
  }
}

export interface Harness {
  readonly engine: Engine<CoilDebugApi>;
  /** The world's live game state. */
  readonly state: CoilState;
  /** The surface `initialize` returned, read back off the engine. */
  readonly debug: CoilDebugApi;
  readonly ctx: SKRSContext2D;
  /** Every cue the engine played, looped, and stopped, in order. */
  readonly cues: string[];
  readonly loops: string[];
  readonly stops: string[];
  /** Press a key and let it up, arming one edge for the next frame. */
  tap(code: string, repeat?: boolean): void;
  /** Run `frames` frames of the default cadence. */
  step(frames: number): Promise<void>;
  /**
   * Run `seconds` of game time, delivered in `frames` equal frames, so a test
   * states the interval it means rather than counting frames of a fixed clock.
   * The default cadence is restored afterwards.
   */
  advance(seconds: number, frames?: number): Promise<void>;
  /** The pixel at the center of `cell`, as red, green and blue. */
  pixel(cell: Cell): [number, number, number];
  dispose(): void;
}

/** A canvas the engine can render through, and the context to read it back. */
export function canvasOf(): {
  element: HTMLCanvasElement;
  ctx: SKRSContext2D;
} {
  const canvas = createCanvas(STAGE_W, STAGE_H);
  const ctx = canvas.getContext("2d");
  const element = Object.assign(canvas, {
    style: {} as CSSStyleDeclaration,
    getContext: () => ctx,
  }) as unknown as HTMLCanvasElement;
  return { element, ctx };
}

/** A surface reporting the design size at a device pixel ratio of 1. */
export function surfaceOf(events: EventTarget): SurfaceMetrics {
  return {
    cssWidth: () => STAGE_W,
    cssHeight: () => STAGE_H,
    dpr: () => 1,
    events: () => events,
  };
}

export async function createHarness(): Promise<Harness> {
  const { element, ctx } = canvasOf();
  const events = new EventTarget();

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
    surface: surfaceOf(events),
  });

  const cues: string[] = [];
  const loops: string[] = [];
  const stops: string[] = [];
  engine.events.on("cue:played", ({ cue }) => cues.push(cue));
  engine.events.on("cue:looped", ({ cue }) => loops.push(cue));
  engine.events.on("cue:stopped", ({ cue }) => stops.push(cue));

  await engine.initialize();

  return {
    engine,
    get state() {
      return coilState(engine.world);
    },
    // Read off the engine rather than built here, so a build that failed to
    // return the surface from `initialize` fails here.
    debug: engine.debug,
    ctx,
    cues,
    loops,
    stops,
    tap: (code, repeat = false) => {
      events.dispatchEvent(new KeyEvent("keydown", code, repeat));
      events.dispatchEvent(new KeyEvent("keyup", code));
    },
    step: (frames) => engine.advance(frames),
    advance: async (seconds, frames = 1) => {
      engine.setClock(new ConstantClock((seconds * 1000) / frames));
      await engine.advance(frames);
      engine.setClock(new ConstantClock(FRAME_MS));
    },
    pixel: (cell) => {
      const { data } = ctx.getImageData(
        Math.round(cellX(cell.col) + CELL / 2),
        Math.round(cellY(cell.row) + CELL / 2),
        1,
        1,
      );
      return [data[0]!, data[1]!, data[2]!];
    },
    dispose: () => engine.destroy(),
  };
}
