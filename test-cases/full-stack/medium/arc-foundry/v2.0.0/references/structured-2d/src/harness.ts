// The test harness the build's own suite stands the game up with.
//
// A harness builds a REAL engine over an `@napi-rs/canvas` canvas and a `SurfaceMetrics`
// of its own, so the game runs with no browser and no document behind it, and steps it
// with `engine.advance` against a `ConstantClock`. Keys and the pointer are driven by
// dispatching keyboard-shaped and pointer-shaped events at the surface's event target —
// the same listeners a player's input reaches — and what is read back is the world's own
// `FoundryState`, the debug surface `initialize` returned, the engine's cue events, and
// the pixels the render produced.
//
// The surface reports the canvas at the design size with a device pixel ratio of 1 and
// no origin, so a dispatched event's client position IS a logical stage position, the
// camera at rest maps world onto logical one to one, and a pixel read needs no
// conversion either.
//
// THE PRODUCED FILES DO NOT RESOLVE with no page behind the loader, so a harness run is
// exactly the case this build's fallbacks are for: every sprite is drawn from its own
// geometry and every cue plays its declared shape rather than its clip. That the game is
// fully playable that way is itself worth checking.

import { createCanvas, type SKRSContext2D } from "@napi-rs/canvas";
import {
  ConstantClock,
  createEngine,
  type Engine,
  type SurfaceMetrics,
} from "@test-cabinet/structured-2d";
import { LAYOUT, STAGE_H, STAGE_W } from "./constants";
import { BACKGROUND, game, type FoundryDebugApi } from "./game";
import { foundryState, type FoundryState } from "./state";

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
  readonly engine: Engine<FoundryDebugApi>;
  /** The world's live game state. */
  readonly state: FoundryState;
  /** The surface `initialize` returned, read back off the engine. */
  readonly debug: FoundryDebugApi;
  readonly ctx: SKRSContext2D;
  /** Every `cue:played` the engine emitted, in order. */
  readonly cues: CuePlay[];
  tap(code: string): void;
  hold(code: string): void;
  release(code: string): void;
  pointer(
    type: "pointerdown" | "pointermove" | "pointerup",
    x: number,
    y: number,
  ): void;
  /** A press and a release at one point, with the frame that resolves the press. */
  press(x: number, y: number): Promise<void>;
  step(frames?: number): Promise<void>;
  dispose(): void;
}

/** The center of a reported control, where a press activates it. */
export function center(c: {
  x: number;
  y: number;
  w: number;
  h: number;
}): [number, number] {
  return [c.x + c.w / 2, c.y + c.h / 2];
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

  // Exactly the options src/main.ts passes, plus the clock and the surface a headless
  // run needs.
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

  const dispatch = (
    type: "pointerdown" | "pointermove" | "pointerup",
    x: number,
    y: number,
  ): void => {
    events.dispatchEvent(new PointerEvt(type, x, y));
  };

  return {
    engine,
    get state() {
      return foundryState(engine.world);
    },
    // Read off the engine rather than built here, so a build that failed to return the
    // surface from `initialize` fails here.
    debug: engine.debug,
    ctx,
    cues,
    tap: (code) => {
      events.dispatchEvent(new KeyEvent("keydown", code));
      events.dispatchEvent(new KeyEvent("keyup", code));
    },
    hold: (code) => events.dispatchEvent(new KeyEvent("keydown", code)),
    release: (code) => events.dispatchEvent(new KeyEvent("keyup", code)),
    pointer: dispatch,
    press: async (x, y) => {
      dispatch("pointermove", x, y);
      dispatch("pointerdown", x, y);
      await engine.advance(1);
      dispatch("pointerup", x, y);
    },
    step: async (frames = 1) => {
      await engine.advance(frames);
    },
    dispose: () => engine.destroy(),
  };
}
