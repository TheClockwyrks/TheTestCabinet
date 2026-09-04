// The test harness the build's own suite stands the game up with.
//
// It builds a REAL engine over an `@napi-rs/canvas` canvas and a
// `SurfaceMetrics` of its own, so the game runs with no browser and no document
// behind it, and steps it with `engine.advance` against a `ConstantClock` whose
// step is exactly one of Shatter's ticks — so one advanced frame is one tick and
// `advance(n)` is `n` ticks of game time.
//
// Keys are driven by dispatching keyboard-shaped events at the surface's event
// target, which is the same listener a player's key reaches. What is read back
// is the world's own `ShatterState`, the debug surface `initialize` returned, the
// engine's cue events, and the pixels the render produced.
//
// The surface reports the canvas at the design size with a device pixel ratio of
// `1` and no origin, so the camera at rest maps world onto logical one to one and
// a pixel read needs no conversion.

import { createCanvas, type SKRSContext2D } from "@napi-rs/canvas";
import {
  ConstantClock,
  createEngine,
  type Engine,
  type SurfaceMetrics,
} from "@test-cabinet/structured-2d";
import {
  FIELD_H,
  FIELD_W,
  LAYOUT,
  SAFE_X,
  SAFE_Y,
  START_LIVES,
  TICK_HZ,
} from "./constants";
import {
  BACKGROUND,
  game,
  shatterState,
  type ShatterDebugApi,
  type ShatterState,
} from "./game";

/** One advanced frame is one whole simulation tick. */
export const TICK_MS = 1000 / TICK_HZ;

/** How many whole ticks cover `seconds` of game time. */
export function ticksFor(seconds: number): number {
  return Math.round(seconds * TICK_HZ);
}

/** A keyboard-shaped event the engine's own listener reads. */
export class KeyEvent extends Event {
  readonly code: string;
  readonly repeat = false;

  constructor(type: "keydown" | "keyup", code: string) {
    super(type);
    this.code = code;
  }
}

/** One cue the engine reported playing. */
export interface CuePlay {
  cue: string;
  gain: number;
}

export interface Harness {
  readonly engine: Engine<ShatterDebugApi>;
  /** The world's live game state. */
  readonly state: ShatterState;
  /** The surface `initialize` returned, read back off the engine. */
  readonly debug: ShatterDebugApi;
  readonly ctx: SKRSContext2D;
  /** Every `cue:played` the engine emitted, in order. */
  readonly cues: CuePlay[];
  /** Hold a key down, let one up, and press one for a single tick. */
  down(code: string): void;
  up(code: string): void;
  tap(code: string): Promise<void>;
  /** Run `ticks` whole ticks. */
  advance(ticks: number): Promise<void>;
  /** Run the whole ticks covering `seconds` of game time. */
  seconds(seconds: number): Promise<void>;
  pixel(x: number, y: number): [number, number, number];
  dispose(): void;
}

/** Stand the game up headless, at the logical design size. */
export async function createHarness(): Promise<Harness> {
  const canvas = createCanvas(FIELD_W, FIELD_H);
  const ctx = canvas.getContext("2d");
  const element = Object.assign(canvas, {
    style: {} as CSSStyleDeclaration,
    getContext: () => ctx,
  }) as unknown as HTMLCanvasElement;

  const events = new EventTarget();
  const surface: SurfaceMetrics = {
    cssWidth: () => FIELD_W,
    cssHeight: () => FIELD_H,
    dpr: () => 1,
    events: () => events,
  };

  // Exactly the options `src/main.ts` passes, plus the clock and the surface a
  // headless run needs.
  const engine = createEngine({
    canvas: element,
    width: FIELD_W,
    height: FIELD_H,
    game,
    background: BACKGROUND,
    layout: LAYOUT,
    clock: new ConstantClock(TICK_MS),
    surface,
  });

  const cues: CuePlay[] = [];
  engine.events.on("cue:played", ({ cue, gain }) => {
    cues.push({ cue, gain });
  });

  await engine.initialize();

  return {
    engine,
    get state() {
      return shatterState(engine.world);
    },
    // Read off the engine rather than built here, so a build that failed to
    // return the surface from `initialize` fails here.
    debug: engine.debug,
    ctx,
    cues,
    down: (code) => events.dispatchEvent(new KeyEvent("keydown", code)),
    up: (code) => events.dispatchEvent(new KeyEvent("keyup", code)),
    tap: async (code) => {
      events.dispatchEvent(new KeyEvent("keydown", code));
      await engine.advance(1);
      events.dispatchEvent(new KeyEvent("keyup", code));
      await engine.advance(1);
    },
    advance: (ticks) => engine.advance(ticks),
    seconds: (seconds) => engine.advance(ticksFor(seconds)),
    pixel: (x, y) => {
      const { data } = ctx.getImageData(Math.round(x), Math.round(y), 1, 1);
      return [data[0], data[1], data[2]];
    },
    dispose: () => {
      engine.destroy();
    },
  };
}

/**
 * The scenario every mechanic test starts from: live play on an empty, quiet
 * field.
 *
 * Empty is safe because a wave clears on the tick the last rock is DESTROYED, so
 * a field that never held one never clears; quiet is the two world gates and the
 * ship's contact gate, with which nothing the scenario did not ask for arrives,
 * spawns or costs a life.
 */
export function startPlaying(debug: ShatterDebugApi): void {
  debug.clearRocks();
  debug.clearBullets();
  debug.clearEnemyBullets();
  debug.clearTorpedoes();
  debug.removeSaucer();

  debug.setWaveSpawning(false);
  debug.setSaucerSpawning(false);
  debug.setShipCollision(false);

  debug.setScreen("playing");
  debug.setMenuIndex(0);
  debug.setScore(0);
  debug.setLives(START_LIVES);
  debug.setWave(1);
  debug.setWaveBanner(0);

  debug.setShipPosition(SAFE_X, SAFE_Y);
  debug.setShipVelocity(0, 0);
  debug.setShipInvuln(0);
  debug.setFireCooldown(0);
  debug.setTorpedoCharge(1);
}

/** Add a rock of `size` at `(x, y)` drifting at `(vx, vy)`, and return its id. */
export function poseRock(
  debug: ShatterDebugApi,
  size: "large" | "medium" | "small",
  x: number,
  y: number,
  vx = 0,
  vy = 0,
): number {
  debug.addRock(size, x, y);
  const rocks = debug.snapshot().rocks;
  const id = rocks[rocks.length - 1].id;
  debug.setRockVelocity(id, vx, vy);
  return id;
}
