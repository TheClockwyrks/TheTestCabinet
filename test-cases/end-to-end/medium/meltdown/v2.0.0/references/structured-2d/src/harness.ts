// The test harness the build's own suite stands the game up with.
//
// A harness builds a REAL engine over an `@napi-rs/canvas` canvas and a
// `SurfaceMetrics` of its own, so the game runs with no browser and no document
// behind it, and steps it with `engine.advance` against a `ConstantClock`. Keys
// and the pointer are driven by dispatching keyboard-shaped and pointer-shaped
// events at the surface's event target — the same listeners a player's input
// reaches — and what is read back is the world's own `MeltdownState`, the debug
// surface `initialize` returned, the engine's cue events, and the pixels the
// render produced.
//
// The surface reports the canvas at the design size with a device pixel ratio
// of 1 and no origin, so a dispatched event's client position IS a logical
// stage position, the camera at rest maps world onto logical one to one, and a
// pixel read needs no conversion either.

import { createCanvas, type SKRSContext2D } from "@napi-rs/canvas";
import {
  ConstantClock,
  createEngine,
  type Engine,
  type SurfaceMetrics,
} from "@clockwyrks/structured-2d";
import { LAYOUT, STAGE_H, STAGE_W } from "./constants";
import {
  BACKGROUND,
  game,
  meltdownState,
  type MeltdownDebugApi,
  type MeltdownState,
} from "./game";

/** The frame size the suite steps at unless a test builds its own clock. */
export const TICK_MS = 1000 / 120;

/** A keyboard-shaped event the engine's own listener reads. */
export class KeyEvent extends Event {
  readonly code: string;
  readonly repeat: boolean;

  constructor(type: "keydown" | "keyup", code: string, repeat = false) {
    super(type);
    this.code = code;
    this.repeat = repeat;
  }
}

/** A pointer-shaped event the engine's own listener reads. */
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

/** One cue the engine reported playing. */
export interface CuePlay {
  cue: string;
  gain: number;
}

/** What a test drives the build through. */
export interface Harness {
  readonly engine: Engine<MeltdownDebugApi>;
  /** The world's live game state. */
  readonly state: MeltdownState;
  /** The surface `initialize` returned, read back off the engine. */
  readonly debug: MeltdownDebugApi;
  readonly ctx: SKRSContext2D;
  /** Every `cue:played` the engine emitted, in order. */
  readonly cues: CuePlay[];
  /** Press and release one key, as one press edge. */
  tap(code: string): void;
  /** Hold a key down without releasing it. */
  keyDown(code: string, repeat?: boolean): void;
  keyUp(code: string): void;
  pointer(
    type: "pointerdown" | "pointermove" | "pointerup",
    x: number,
    y: number,
  ): void;
  /** A press and release at one point, one frame apart. */
  press(x: number, y: number): Promise<void>;
  pixel(x: number, y: number): [number, number, number];
  dispose(): void;
}

/** Stand the whole game up headless. */
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
    clock: new ConstantClock(TICK_MS),
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
      return meltdownState(engine.world);
    },
    // Read off the engine rather than built here, so a build that failed to
    // return the surface from `initialize` fails at the first test.
    debug: engine.debug,
    ctx,
    cues,
    tap: (code) => {
      events.dispatchEvent(new KeyEvent("keydown", code));
      events.dispatchEvent(new KeyEvent("keyup", code));
    },
    keyDown: (code, repeat = false) => {
      events.dispatchEvent(new KeyEvent("keydown", code, repeat));
    },
    keyUp: (code) => {
      events.dispatchEvent(new KeyEvent("keyup", code));
    },
    pointer: dispatchPointer,
    press: async (x, y) => {
      dispatchPointer("pointerdown", x, y);
      await engine.advance(1);
      dispatchPointer("pointerup", x, y);
      await engine.advance(1);
    },
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
 * Advance an exact interval of game time, divided into `frames` equal frames.
 *
 * The clock is the engine's, so a measurement states the frame size it was
 * taken at rather than inheriting one: every rate in this game is per second
 * and integrated against the frame's delta, so an interval reaches the same
 * state however it was divided, beyond the drift a change in step size
 * explains.
 */
export async function stepSeconds(
  harness: Harness,
  seconds: number,
  frames = 1,
): Promise<void> {
  harness.engine.setClock(new ConstantClock((seconds / frames) * 1000));
  await harness.engine.advance(frames);
  harness.engine.setClock(new ConstantClock(TICK_MS));
}

/**
 * A run posed on an empty, quiet floor: the mode and difficulty named, the
 * rosters empty, the routes at their open lengths, and the run's own release of
 * surge held off so a scenario that spends game time is not invaded by a wave.
 */
export function startRun(
  harness: Harness,
  mode: MeltdownState["mode"] = "containment",
  difficulty: MeltdownState["difficulty"] = "medium",
): void {
  const { debug } = harness;
  debug.reset();
  debug.setMode(mode);
  debug.setDifficulty(difficulty);
  debug.clearTowers();
  debug.clearSurge();
  debug.setScreen("playing");
  debug.setPhase("building");
  debug.setWave(1);
  debug.setBuildTimer(15);
  debug.setWavePending(0);
  debug.setWaveSpawning(false);
  const snapshot = debug.snapshot();
  debug.setMoney(snapshot.startMoney);
  debug.setLives(snapshot.startLives);
  debug.setScore(0);
  debug.setSelected(null);
  debug.setHoverShop(null);
  debug.setArmed(null);
  debug.setSpeed(1);
}

/** Add one tower and return the id the roster's last entry carries. */
export function poseTower(
  harness: Harness,
  type: Parameters<MeltdownDebugApi["addTower"]>[0],
  col: number,
  row: number,
  rotation = 0,
): number {
  harness.debug.addTower(type, col, row, rotation);
  const towers = harness.debug.snapshot().towers;
  return towers[towers.length - 1].id;
}

/** A tower whose guns are held off, so its thermal model runs alone. */
export function poseIdleTower(
  harness: Harness,
  type: Parameters<MeltdownDebugApi["addTower"]>[0],
  col: number,
  row: number,
  rotation = 0,
  heat = 0,
): number {
  const id = poseTower(harness, type, col, row, rotation);
  harness.debug.setTowerFiring(id, false);
  harness.debug.setTowerHeat(id, heat);
  return id;
}

/** A tower at a heat that cannot drift, so a combat reading is exact. */
export function posePinnedTower(
  harness: Harness,
  type: Parameters<MeltdownDebugApi["addTower"]>[0],
  col: number,
  row: number,
  heat: number,
  rotation = 0,
): number {
  const id = poseTower(harness, type, col, row, rotation);
  harness.debug.setTowerThermal(id, false);
  harness.debug.setTowerHeat(id, heat);
  return id;
}

/** A stationary, effectively unkillable target on one tile. */
export function poseTarget(
  harness: Harness,
  type: Parameters<MeltdownDebugApi["addUnit"]>[0],
  x: number,
  y: number,
  hp = 1e6,
): number {
  harness.debug.addUnit(type, "left");
  const surge = harness.debug.snapshot().surge;
  const id = surge[surge.length - 1].id;
  harness.debug.setUnitPosition(id, x, y);
  harness.debug.setUnitMotion(id, false);
  harness.debug.setUnitMaxHp(id, hp);
  harness.debug.setUnitHp(id, hp);
  return id;
}
