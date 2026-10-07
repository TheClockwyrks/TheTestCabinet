// The two benches the build's own suite stands the game up on.
//
// `Bench` is the RULES alone: the world's game state, and the two calls the
// rules make outward (`src/host.ts`), with the cues and effects they raise
// recorded rather than played. Nothing of the engine is involved, so a test that
// is about the editor, the simulation, or the debug surface poses a machine and
// reads it back in microseconds. `OrreryState` is plain data whose framework
// half — `world`, `players`, `phase`, `elapsed` — no rule of Orrery reads, so a
// state built here behaves exactly as the one the engine builds.
//
// `createHarness` is the WHOLE GAME: a real engine over an `@napi-rs/canvas`
// canvas and a `SurfaceMetrics` of its own, so the game runs with no browser
// and no document behind it, stepped with `engine.advance` against a
// `ConstantClock` of one tick per frame. Keys are driven by dispatching
// keyboard-shaped events at the surface's event target — the same listener a
// player's key reaches — and what is read back is the world's own
// `OrreryState`, the debug surface `initialize` returned, the engine's cue
// events, and the pixels the render produced.
//
// The surface reports the canvas at the design size with a device pixel ratio
// of 1 and no origin, so the camera at rest maps world onto logical one to one
// and a pixel read needs no conversion.
//
// Nothing in this process can fetch or decode an image, so every produced file
// fails to load here. That is deliberate: the suite runs against a build whose
// assets are unavailable, which is the check that such a build still
// initializes, still ticks, still takes input, and still draws a legible field
// (specs/assets.md).

import { createCanvas, type SKRSContext2D } from "@napi-rs/canvas";
import {
  ConstantClock,
  createEngine,
  type Engine,
  type SurfaceMetrics,
} from "@clockwyrks/structured-2d";
import { STAGE_H, STAGE_W, type CueName } from "./constants";
import type { ParticleSystemName } from "./figures";
import type { EffectEvent, OrreryHost } from "./host";
import type { StagePoint } from "./motion";
import { BACKGROUND, game } from "./game";
import type { OrreryDebugApi } from "./debug";
import { OrreryState, orreryState } from "./state";

// ---- The rules alone ------------------------------------------------------

/**
 * The game's rules with no engine under them: the live state, and the cues and
 * effects the rules raised since the last drain.
 */
export class Bench implements OrreryHost {
  readonly state = new OrreryState();
  /** The cues raised since the last `drainCues`, in the order they were asked. */
  readonly cues: CueName[] = [];
  /** The effects raised since the last `drainEffects`. */
  readonly effects: EffectEvent[] = [];
  private mutedBit = false;

  cue(cue: CueName): void {
    this.cues.push(cue);
  }

  effect(system: ParticleSystemName, at: StagePoint): void {
    this.effects.push({ system, at: { x: at.x, y: at.y } });
  }

  muted(): boolean {
    return this.mutedBit;
  }

  toggleMute(): void {
    this.mutedBit = !this.mutedBit;
  }

  /** Take the cues raised since the last call, clearing the record. */
  drainCues(): CueName[] {
    return this.cues.splice(0, this.cues.length);
  }

  /** Take the effects raised since the last call, clearing the record. */
  drainEffects(): EffectEvent[] {
    return this.effects.splice(0, this.effects.length);
  }
}

// ---- The whole game -------------------------------------------------------

/** The frame the harness runs at: one whole tick per frame. */
export const FRAME_MS = 1000 / 60;

/** A keyboard-shaped event, dispatched at the surface the engine listens on. */
export class KeyEvent extends Event {
  readonly code: string;
  readonly repeat: boolean;

  constructor(type: "keydown" | "keyup", code: string, repeat = false) {
    super(type);
    this.code = code;
    this.repeat = repeat;
  }
}

/** A pointer-shaped event, dispatched the same way. */
export class PointerEventShape extends Event {
  readonly clientX: number;
  readonly clientY: number;
  readonly pointerId = 1;
  readonly isPrimary = true;
  readonly button = 0;
  readonly buttons: number;
  readonly pointerType = "mouse";

  constructor(
    type: "pointerdown" | "pointermove" | "pointerup",
    x: number,
    y: number,
  ) {
    super(type);
    this.clientX = x;
    this.clientY = y;
    this.buttons = type === "pointerup" ? 0 : 1;
  }
}

export interface Harness {
  readonly engine: Engine<OrreryDebugApi>;
  /** The world's live game state. */
  readonly state: OrreryState;
  /** The surface `initialize` returned, read back off the engine. */
  readonly debug: OrreryDebugApi;
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
  /** Report a pointer press, move, or release at a logical stage position. */
  pointer(
    type: "pointerdown" | "pointermove" | "pointerup",
    x: number,
    y: number,
  ): void;
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

/** What a harness may be built over beyond the defaults. */
export interface HarnessOptions {
  /**
   * How much simulated time one frame is worth, in milliseconds. The default is
   * one sixtieth of a second, the frame a player gets; a check that has to
   * cover a long run gives itself a coarser one, and reaches exactly the same
   * state, because a run advances by whole cycles however the time was divided
   * (specs/instrumentation.md "A render-free core").
   */
  frameMs?: number;
}

export async function createHarness(
  options: HarnessOptions = {},
): Promise<Harness> {
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
    clock: new ConstantClock(options.frameMs ?? FRAME_MS),
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
      return orreryState(engine.world);
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
    pointer: (type, x, y) => {
      events.dispatchEvent(new PointerEventShape(type, x, y));
    },
    step: (frames) => engine.advance(frames),
    pixel: (x, y) => {
      const { data } = ctx.getImageData(Math.round(x), Math.round(y), 1, 1);
      return [data[0]!, data[1]!, data[2]!];
    },
    dispose: () => engine.destroy(),
  };
}
