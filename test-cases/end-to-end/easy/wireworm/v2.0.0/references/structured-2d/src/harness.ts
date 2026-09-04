// The test harness the build's own suite stands the game up with.
//
// A harness builds a REAL engine over an `@napi-rs/canvas` canvas and a
// `SurfaceMetrics` of its own, so the game runs with no browser and no document
// behind it, and steps it with `engine.advance` against a `ConstantClock` whose
// step is one frame. Keys are driven by dispatching keyboard-shaped events at
// the surface's event target — the same listeners a player's input reaches — and
// what is read back is the world's own `WirewormState`, the debug surface
// `initialize` returned, the engine's cue events, and the pixels the render
// produced.
//
// The surface reports the canvas at the design size with a device pixel ratio of
// 1 and no origin, so the camera at rest maps world onto logical one to one and
// a pixel read needs no conversion.
//
// This host has neither `createImageBitmap` nor a `fetch` that resolves a
// relative path, so every seeded frame arrives as `null` here and the render
// draws the shapes it falls back to. That is deliberate: it is the same path a
// browser with a missing file takes, and it keeps these checks about the game.
// `render.test.ts` covers the sprite path by handing `loadArt` a loader of its
// own, so both halves of every draw are exercised without a file system.

import { createCanvas, type SKRSContext2D } from "@napi-rs/canvas";
import {
  ConstantClock,
  createEngine,
  type Engine,
  type SurfaceMetrics,
} from "@test-cabinet/structured-2d";
import { LAYOUT, STAGE_H, STAGE_W } from "./constants";
import {
  BACKGROUND,
  game,
  wirewormState,
  type WirewormDebugApi,
  type WirewormState,
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
  readonly engine: Engine<WirewormDebugApi>;
  /** The world's live game state. */
  readonly state: WirewormState;
  /** The surface `initialize` returned, read back off the engine. */
  readonly debug: WirewormDebugApi;
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
      return wirewormState(engine.world);
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
    seconds: (seconds) => engine.advance(Math.max(1, Math.round(seconds * 60))),
    pixel: (x, y) => {
      const { data } = ctx.getImageData(Math.round(x), Math.round(y), 1, 1);
      return [data[0], data[1], data[2]];
    },
    dispose: () => engine.destroy(),
  };
}

/**
 * The scenario every mechanic test starts from: live play on an empty, quiet
 * board. Empty is safe because a level clears on the step in which the last of
 * its segments is REMOVED, so a board that never held one never clears; quiet is
 * the three world gates, with which nothing the scenario did not ask for
 * arrives, enters, or costs a life.
 */
export function startPlaying(debug: WirewormDebugApi): void {
  debug.clearNodes();
  debug.clearWorms();
  debug.clearFoes();
  debug.clearBolts();
  debug.setFoeSpawning(false);
  debug.setWormEntry(false);
  debug.setCursorContact(false);
  debug.setScreen("playing");
  debug.setPhase("active");
  debug.setPhaseTimer(0);
  debug.setLevel(1);
  debug.setCursor(640, 688);
  debug.setCursorInvulnerable(0);
  debug.setFireCooldown(0);
}

/** A worm of `length` segments laid leftwards from its head on `(c, r)`. */
export function poseWorm(
  debug: WirewormDebugApi,
  c: number,
  r: number,
  length = 1,
): number {
  debug.addWorm(c, r);
  const worms = debug.snapshot().worms;
  const id = worms[worms.length - 1]?.id ?? 0;
  for (let index = 1; index < length; index += 1) {
    debug.appendSegment(id, c - index, r);
  }
  return id;
}
