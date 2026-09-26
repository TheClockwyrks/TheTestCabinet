// The test harness the build's own suite stands the game up with.
//
// A harness builds a REAL engine over an `@napi-rs/canvas` canvas and a
// `SurfaceMetrics` of its own, so the game runs with no browser and no document
// behind it, and steps it with `engine.advance` against a `ConstantClock` whose
// step is one frame. Keys are driven by dispatching keyboard-shaped events at the
// surface's event target — the same listeners a player's input reaches — and what
// is read back is the world's own `SpectraState`, the debug surface `initialize`
// returned, the engine's cue events, and the pixels the render produced.
//
// The surface reports the canvas at the design size with a device pixel ratio of
// 1, so the camera at rest maps world onto logical one to one and a pixel read
// needs no conversion.
//
// THIS HOST HAS NEITHER `createImageBitmap` NOR A `fetch` THAT RESOLVES A
// RELATIVE PATH, so every seeded file arrives as `null` here and the render draws
// the shapes it falls back to. That is deliberate: it is the same path a browser
// with a missing file takes, and it keeps these checks about the game.
// `art.test.ts` covers the seeded-art path by handing `loadArt` a loader of its
// own, so both halves of every draw are exercised without a file system.

import { createCanvas, type SKRSContext2D } from "@napi-rs/canvas";
import {
  ConstantClock,
  createEngine,
  type Engine,
  type SurfaceMetrics,
} from "@clockwyrks/structured-2d";
import { LAYOUT, SHIP_Y, STAGE_H, STAGE_W } from "./constants";
import {
  BACKGROUND,
  game,
  spectraState,
  type SpectraDebugApi,
  type SpectraState,
} from "./game";

/** One advanced frame is one sixtieth of a second of game time. */
export const FRAME_DT = 1 / 60;
export const FRAME_MS = FRAME_DT * 1000;

export class KeyEvent extends Event {
  readonly code: string;
  readonly repeat = false;

  constructor(type: "keydown" | "keyup", code: string) {
    super(type);
    this.code = code;
  }
}

export interface CuePlay {
  cue: string;
  gain: number;
}

export interface Harness {
  readonly engine: Engine<SpectraDebugApi>;
  /** The world's live game state. */
  readonly state: SpectraState;
  /** The surface `initialize` returned, read back off the engine. */
  readonly debug: SpectraDebugApi;
  readonly ctx: SKRSContext2D;
  /** Every `cue:played` the engine emitted, in order. */
  readonly cues: CuePlay[];
  /** Hold a key down, let one up, and press one for a single frame. */
  down(code: string): void;
  up(code: string): void;
  tap(code: string): Promise<void>;
  /** Run `frames` whole frames of `FRAME_DT` each. */
  advance(frames: number): Promise<void>;
  /** Run whole frames covering about `seconds` of game time. */
  seconds(seconds: number): Promise<void>;
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

  return {
    engine,
    get state() {
      return spectraState(engine.world);
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
    advance: (frames) => engine.advance(frames),
    seconds: (span) => engine.advance(Math.max(1, Math.round(span * 60))),
    pixel: (x, y) => {
      const { data } = ctx.getImageData(Math.round(x), Math.round(y), 1, 1);
      return [data[0], data[1], data[2]];
    },
    dispose: () => engine.destroy(),
  };
}

/**
 * The scenario every mechanic test starts from: a live, quiet, empty wave.
 *
 * Empty is safe because a stage clears in the moment the last drone of its wave is
 * DESTROYED, so a wave that never held one never clears; quiet is the three world
 * gates, with which nothing the scenario did not ask for arrives, dives, or costs
 * a life.
 */
export function startPosed(debug: SpectraDebugApi): void {
  debug.reset();
  debug.setWaveEntry(false);
  debug.setDiveLaunching(false);
  debug.setShipContact(false);
  debug.setScreen("inWave");
  debug.setPhase("live");
  debug.setPhaseTimer(0);
  debug.setShipX(640);
  debug.setShipBand("cyan");
  debug.setFireLockout(0);
  debug.setFireCooldown(0);
}

/** The id of the drone the last `addDrone` appended. */
export function lastDroneId(debug: SpectraDebugApi): number {
  const drones = debug.snapshot().drones;
  return drones[drones.length - 1]?.id ?? 0;
}

/** The id of the bullet the last `add*Bullet` appended. */
export function lastBulletId(debug: SpectraDebugApi): number {
  const bullets = debug.snapshot().bullets;
  return bullets[bullets.length - 1]?.id ?? 0;
}

/** Where the ship's hull sits, for a scenario that places something on it. */
export const SHIP_LANE_Y = SHIP_Y;
