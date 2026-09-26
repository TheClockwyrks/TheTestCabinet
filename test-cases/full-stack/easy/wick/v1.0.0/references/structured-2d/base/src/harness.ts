// The test harness the build's own suite stands the game up with.
//
// A harness builds a real engine over an `@napi-rs/canvas` canvas and a
// `SurfaceMetrics` of its own, so the game runs with no browser and no
// document behind it, and steps it with `engine.advance` against a
// `ConstantClock` of one tick per frame. Keys, the pointer, and the wheel are
// driven by dispatching keyboard-, pointer-, and wheel-shaped events at the
// surface's event target, the same listeners a player's mouse and keyboard
// reach, and what is read back is the world's own
// `WickState`, the debug surface `initialize` returned, the engine's cue
// events, and the pixels the render produced.
//
// The surface reports the canvas at the design size with a device pixel
// ratio of 1 and no origin, so logical units and device pixels coincide and
// a pixel read needs no conversion, and a dispatched event's client position
// is read as the stage point of the same numbers.
//
// Nothing in this process can fetch or decode an image or a sound, so every
// produced file fails to load here. That is deliberate: the suite runs
// against a build whose assets are unavailable, which is the check that such
// a build still initializes, still ticks, still takes input, and still draws
// a legible night (`specs/assets.md`).

import { createCanvas, type SKRSContext2D } from "@napi-rs/canvas";
import {
  ConstantClock,
  createEngine,
  type Engine,
  type SurfaceMetrics,
} from "@clockwyrks/structured-2d";
import { STAGE_H, STAGE_W, TICK_HZ } from "./constants";
import {
  BACKGROUND,
  game,
  wickState,
  type WickDebugApi,
  type WickState,
} from "./game";

/** The frame the harness runs at: one whole tick per frame. */
export const FRAME_MS = 1000 / TICK_HZ;

export class KeyEvent extends Event {
  readonly code: string;
  readonly repeat: boolean;

  constructor(type: "keydown" | "keyup", code: string, repeat = false) {
    super(type);
    this.code = code;
    this.repeat = repeat;
  }
}

/** A pointer-shaped event carrying the fields the engine reads. */
export class PointEvent extends Event {
  readonly clientX: number;
  readonly clientY: number;
  readonly button: number;
  readonly buttons: number;

  constructor(
    type: "pointerdown" | "pointermove" | "pointerup",
    x: number,
    y: number,
    buttons = 0,
  ) {
    super(type);
    this.clientX = x;
    this.clientY = y;
    this.button = 0;
    this.buttons = buttons;
  }
}

/** A wheel-shaped event, its travel in CSS pixels down the page. */
export class ScrollEvent extends Event {
  readonly deltaX = 0;
  readonly deltaY: number;
  readonly deltaMode = 0;

  constructor(deltaY: number) {
    super("wheel");
    this.deltaY = deltaY;
  }
}

export interface Harness {
  readonly engine: Engine<WickDebugApi>;
  /** The world's live game state. */
  readonly state: WickState;
  /** The surface `initialize` returned, read back off the engine. */
  readonly debug: WickDebugApi;
  readonly ctx: SKRSContext2D;
  /** Every cue the engine played, looped, and stopped, in order. */
  readonly cues: string[];
  readonly loops: string[];
  readonly stops: string[];
  /** Press a key down, arming one edge for the next frame. */
  press(code: string): void;
  /** Let a key up. */
  release(code: string): void;
  /** Press a key and let it up, arming one edge for the next frame. */
  tap(code: string, repeat?: boolean): void;
  /** Move the pointer to the stage point `(x, y)`. */
  hover(x: number, y: number): void;
  /** Click the primary button at the stage point `(x, y)`. */
  click(x: number, y: number): void;
  /** Turn the wheel `travel` units down the stage. */
  scroll(travel: number): void;
  /** Run `frames` frames, each worth exactly one tick. */
  step(frames: number): Promise<void>;
  /** The pixel at the stage point `(x, y)`, as red, green and blue. */
  pixel(x: number, y: number): [number, number, number];
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
    layout: "dpad-4",
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
      return wickState(engine.world);
    },
    // Read off the engine rather than built here, so a build that failed to
    // return the surface from `initialize` fails here.
    debug: engine.debug,
    ctx,
    cues,
    loops,
    stops,
    press: (code) => {
      events.dispatchEvent(new KeyEvent("keydown", code));
    },
    release: (code) => {
      events.dispatchEvent(new KeyEvent("keyup", code));
    },
    tap: (code, repeat = false) => {
      events.dispatchEvent(new KeyEvent("keydown", code, repeat));
      events.dispatchEvent(new KeyEvent("keyup", code));
    },
    hover: (x, y) => {
      events.dispatchEvent(new PointEvent("pointermove", x, y));
    },
    click: (x, y) => {
      events.dispatchEvent(new PointEvent("pointerdown", x, y, 1));
      events.dispatchEvent(new PointEvent("pointerup", x, y));
    },
    scroll: (travel) => {
      events.dispatchEvent(new ScrollEvent(travel));
    },
    step: (frames) => engine.advance(frames),
    pixel: (x, y) => {
      const { data } = ctx.getImageData(Math.round(x), Math.round(y), 1, 1);
      return [data[0]!, data[1]!, data[2]!];
    },
    dispose: () => engine.destroy(),
  };
}
