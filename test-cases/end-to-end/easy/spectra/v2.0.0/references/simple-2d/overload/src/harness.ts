/// <reference types="node" />
// This file runs in Node and reads the disk. The project's tsconfig sets
// `types: []` to keep the game's own sources browser-only, so the files that
// need Node's types name them here instead.

// Spectra — the build's own test harness.
//
// Nothing in the shipped game imports this file: it is what `src/**/*.test.ts`
// stands the game up with. Each harness builds a real engine over an
// `@napi-rs/canvas` canvas and a `SurfaceMetrics` of its own, so the game runs with
// no browser and no document behind it, and steps it with `engine.advance` against
// a `ConstantClock`, which makes a duration an exact number of frames. What is read
// back is the game's own state, the debug surface the game returned beside it, the
// engine's cue events, and the pixels the render produced.
//
// The state is a value the engine replaces every frame, so `h.state` reads
// `engine.state` at the moment it is read rather than holding the object
// `initialize` built. A pose takes a state and returns the next one and is driven
// through `engine.apply`; a reading is handed `engine.state`. `h.pose` and
// `h.snapshot` are those two moves, named.
//
// The seeded art is not fetched by default, so the render falls back to the shapes
// it draws in code, which keeps most checks about the game rather than about the
// art. `withSeededArt` stands `fetch` and `createImageBitmap` up over the project's
// own `assets/` directory for the checks whose subject IS the art.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas, loadImage, type SKRSContext2D } from "@napi-rs/canvas";
import {
  ConstantClock,
  createEngine,
  type Engine,
  type SurfaceMetrics,
  type Viewport,
} from "@clockwyrks/simple-2d";
import {
  FORM_CENTER_X,
  LAYOUT,
  PLAYER_BULLET_SPEED,
  STAGE_H,
  STAGE_W,
  START_LIVES,
} from "./constants";
import {
  BACKGROUND,
  game,
  type Band,
  type DroneKind,
  type DronePhase,
  type SpectraDebugApi,
  type SpectraSnapshot,
  type SpectraState,
} from "./game";
import type { DeepReadonly } from "ts-essentials";

/** Frames a second the scripted clock runs at, so a second is 60 frames. */
export const FPS = 60;
const TICK_MS = 1000 / FPS;

/** The project's own asset directory, which the seeded-art shim serves from. */
const ASSET_ROOT = fileURLToPath(new URL("..", import.meta.url));

class KeyEvent extends Event {
  readonly code: string;
  readonly repeat: boolean;

  constructor(type: "keydown" | "keyup", code: string, repeat = false) {
    super(type);
    this.code = code;
    this.repeat = repeat;
  }
}

/** One cue the engine reported playing. */
export interface CuePlay {
  cue: string;
  gain: number;
}

/** Everything a check drives the game through. */
export interface Harness {
  readonly engine: Engine<SpectraState, SpectraDebugApi>;
  readonly state: DeepReadonly<SpectraState>;
  readonly debug: SpectraDebugApi;
  pose(
    transition: (
      state: DeepReadonly<SpectraState>,
      debug: SpectraDebugApi,
    ) => SpectraState,
  ): void;
  snapshot(): SpectraSnapshot;
  readonly cues: CuePlay[];
  readonly assetPaths: string[];
  hold(code: string): void;
  release(code: string): void;
  tap(code: string): void;
  pixel(x: number, y: number): [number, number, number, number];
  average(
    x: number,
    y: number,
    w: number,
    h: number,
  ): [number, number, number, number];
  region(x: number, y: number, w: number, h: number): Uint8ClampedArray;
  advance(seconds: number): Promise<void>;
  frames(count: number): Promise<void>;
  setStep(seconds: number): void;
  dispose(): void;
}

/** Stand a real engine up over a headless canvas and initialize the game. */
export async function createHarness(): Promise<Harness> {
  const canvas = createCanvas(STAGE_W, STAGE_H);
  const ctx = canvas.getContext("2d");
  const element = Object.assign(canvas, {
    style: {} as CSSStyleDeclaration,
    getContext: () => ctx as SKRSContext2D,
  }) as unknown as HTMLCanvasElement;

  const events = new EventTarget();
  const surface: SurfaceMetrics = {
    cssWidth: () => STAGE_W,
    cssHeight: () => STAGE_H,
    dpr: () => 1,
    events: () => events,
  };

  // Exactly the options `src/main.ts` passes, plus the clock and the surface a
  // headless run needs.
  const engine = createEngine<SpectraState, SpectraDebugApi>({
    canvas: element,
    width: STAGE_W,
    height: STAGE_H,
    game,
    background: BACKGROUND,
    layout: LAYOUT,
    clock: new ConstantClock(TICK_MS),
    surface,
  });

  // Subscribed before any game code runs, so what the game asked its loader for is
  // visible whether or not this host could serve it.
  const assetPaths: string[] = [];
  engine.events.on("asset:failed", ({ path }) => assetPaths.push(path));
  engine.events.on("asset:loaded", ({ path }) => assetPaths.push(path));
  const cues: CuePlay[] = [];
  engine.events.on("cue:played", ({ cue, gain }) => cues.push({ cue, gain }));

  await engine.initialize();

  const dispatch = (type: "keydown" | "keyup", code: string): void => {
    events.dispatchEvent(new KeyEvent(type, code));
  };
  // Read off the engine rather than built here: `initialize` returns the surface
  // beside the state, so reaching it this way is what makes that return
  // load-bearing.
  const debug = engine.debug;

  return {
    engine,
    get state() {
      return engine.state;
    },
    debug,
    pose: (transition) => {
      engine.apply((s) => transition(s, debug));
    },
    snapshot: () => debug.snapshot(engine.state),
    cues,
    assetPaths,
    hold: (code) => dispatch("keydown", code),
    release: (code) => dispatch("keyup", code),
    tap: (code) => {
      dispatch("keydown", code);
      dispatch("keyup", code);
    },
    pixel: (x, y) => {
      const view: Viewport = engine.viewport();
      const { data } = ctx.getImageData(
        Math.round(view.offsetX + x * view.scale),
        Math.round(view.offsetY + y * view.scale),
        1,
        1,
      );
      return [
        data[0] as number,
        data[1] as number,
        data[2] as number,
        data[3] as number,
      ];
    },
    average: (x, y, w, h) => {
      const view: Viewport = engine.viewport();
      const { data } = ctx.getImageData(
        Math.round(view.offsetX + x * view.scale),
        Math.round(view.offsetY + y * view.scale),
        Math.max(1, Math.round(w * view.scale)),
        Math.max(1, Math.round(h * view.scale)),
      );
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      const pixels = data.length / 4;
      for (let i = 0; i < data.length; i += 4) {
        r += data[i] as number;
        g += data[i + 1] as number;
        b += data[i + 2] as number;
        a += data[i + 3] as number;
      }
      return [r / pixels, g / pixels, b / pixels, a / pixels];
    },
    region: (x, y, w, h) => {
      const view: Viewport = engine.viewport();
      return ctx.getImageData(
        Math.round(view.offsetX + x * view.scale),
        Math.round(view.offsetY + y * view.scale),
        Math.max(1, Math.round(w * view.scale)),
        Math.max(1, Math.round(h * view.scale)),
      ).data as unknown as Uint8ClampedArray;
    },
    advance: (seconds) => engine.advance(Math.round(seconds * FPS)),
    frames: (count) => engine.advance(count),
    setStep: (seconds) => {
      engine.setClock(new ConstantClock(seconds * 1000));
    },
    dispose: () => engine.destroy(),
  };
}

type Fetcher = typeof globalThis.fetch;
type Bitmapper = typeof globalThis.createImageBitmap;

/**
 * Serve the project's own `assets/` directory to the engine's loader, and report
 * the call that puts the two globals back.
 *
 * The loader reaches for `fetch` and `createImageBitmap`, and a vitest process has
 * no page for a relative URL to resolve against, so both are stood up over the file
 * system here.
 */
export function installSeededArt(): () => void {
  const host = globalThis as unknown as {
    fetch: Fetcher;
    createImageBitmap: Bitmapper;
  };
  const realFetch = host.fetch;
  const realBitmap = host.createImageBitmap;

  host.fetch = (async (url: string): Promise<Response> =>
    new Response(readFileSync(join(ASSET_ROOT, url)))) as unknown as Fetcher;
  host.createImageBitmap = (async (blob: Blob): Promise<unknown> =>
    loadImage(await blob.arrayBuffer())) as unknown as Bitmapper;

  return () => {
    host.fetch = realFetch;
    host.createImageBitmap = realBitmap;
  };
}

/** The last entry of a list, which is where the surface appends what it adds. */
export function last<T>(list: readonly T[]): T {
  return list[list.length - 1] as T;
}

/** The distance between two sampled colours, out of a possible 441. */
export function rgbDistance(
  a: readonly [number, number, number, number],
  b: readonly [number, number, number, number],
): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** What `poseDrone` may set beyond the position and the kind. */
export interface DroneOptions {
  band?: Band;
  phase?: DronePhase;
  slotX?: number;
  slotY?: number;
  bandClock?: number;
  shellAlive?: boolean;
  charge?: number;
  travel?: boolean;
  oscillation?: boolean;
  fire?: boolean;
}

/**
 * An empty, quiet live wave at `stage`.
 *
 * Empty is safe because a stage clears on the moment its last drone is destroyed,
 * so a wave that never held one never clears. Quiet is the three world gates: with
 * the wave's entry, the assault's dive launching and the ship's contact test all
 * off, nothing a check did not ask for arrives, launches or costs a life.
 */
export function startPosed(h: Harness, stage = 1): void {
  h.pose((s, d) => d.clearDrones(s));
  h.pose((s, d) => d.clearPlayerBullets(s));
  h.pose((s, d) => d.clearEnemyBullets(s));
  h.pose((s, d) => d.clearBursts(s));
  h.pose((s, d) => d.setWaveEntry(s, false));
  h.pose((s, d) => d.setDiveLaunching(s, false));
  h.pose((s, d) => d.setShipContact(s, false));
  h.pose((s, d) => d.setScreen(s, "inWave"));
  h.pose((s, d) => d.setPhase(s, "live"));
  h.pose((s, d) => d.setPhaseTimer(s, 0));
  h.pose((s, d) => d.setStage(s, stage));
  h.pose((s, d) => d.setShipX(s, FORM_CENTER_X));
  h.pose((s, d) => d.setShipBand(s, "cyan"));
  h.pose((s, d) => d.setFireLockout(s, 0));
  h.pose((s, d) => d.setFireCooldown(s, 0));
  h.pose((s, d) => d.setResonance(s, 0));
  h.pose((s, d) => d.setInversion(s, 0));
  h.pose((s, d) => d.setLives(s, START_LIVES));
  h.pose((s, d) => d.setScore(s, 0));
  h.pose((s, d) => d.setExtraLifeAwarded(s, false));
  h.pose((s, d) => d.setDiveClock(s, 0));
}

/** Place one drone, field by field, and report its id. */
export function poseDrone(
  h: Harness,
  kind: DroneKind,
  x: number,
  y: number,
  options: DroneOptions = {},
): number {
  h.pose((s, d) => d.addDrone(s, kind, x, y));
  const id = last(h.snapshot().drones).id;
  if (options.band !== undefined) {
    h.pose((s, d) => d.setDroneBand(s, id, options.band as Band));
  }
  if (options.phase !== undefined) {
    h.pose((s, d) => d.setDronePhase(s, id, options.phase as DronePhase));
  }
  if (options.slotX !== undefined || options.slotY !== undefined) {
    h.pose((s, d) =>
      d.setDroneSlot(s, id, options.slotX ?? x, options.slotY ?? y),
    );
  }
  if (options.bandClock !== undefined) {
    h.pose((s, d) => d.setDroneBandClock(s, id, options.bandClock as number));
  }
  if (options.shellAlive !== undefined) {
    h.pose((s, d) => d.setDroneShell(s, id, options.shellAlive as boolean));
  }
  if (options.charge !== undefined) {
    h.pose((s, d) => d.setDroneCharge(s, id, options.charge as number));
  }
  // Every faculty is off unless the check asks for it, so a posed drone is a prop.
  h.pose((s, d) => d.setDroneTravel(s, id, options.travel ?? false));
  h.pose((s, d) => d.setDroneOscillation(s, id, options.oscillation ?? false));
  h.pose((s, d) => d.setDroneFire(s, id, options.fire ?? false));
  return id;
}

/** The drone with that id, as the snapshot reports it, or `undefined`. */
export function droneOf(
  h: Harness,
  id: number,
): SpectraSnapshot["drones"][number] | undefined {
  return h.snapshot().drones.find((drone) => drone.id === id);
}

/** Every one of the player's bullets in flight. */
export function playerBullets(h: Harness): SpectraSnapshot["bullets"] {
  return h.snapshot().bullets.filter((bullet) => bullet.friendly);
}

/** Every enemy bullet in flight. */
export function enemyBullets(h: Harness): SpectraSnapshot["bullets"] {
  return h.snapshot().bullets.filter((bullet) => !bullet.friendly);
}

/**
 * Put one of the player's bullets `gap` units below `(x, y)` and run it into
 * whatever stands there.
 */
export async function fireAt(
  h: Harness,
  x: number,
  y: number,
  band: Band,
  gap = 40,
): Promise<void> {
  h.pose((s, d) => d.addPlayerBullet(s, x, y + gap, band));
  await h.advance((gap + 20) / PLAYER_BULLET_SPEED);
}

/**
 * Open the stage's own wave, built by the game rather than posed.
 *
 * The stage-intro hold is run out in one frame, which is the one moment
 * `specs/stages.md` builds a wave in, so what stands on the field afterwards is
 * the wave the game itself made.
 */
export async function startStage(h: Harness, stage: number): Promise<void> {
  h.pose((s, d) => d.setStage(s, stage));
  h.pose((s, d) => d.setScreen(s, "stageIntro"));
  h.pose((s, d) => d.setPhase(s, "live"));
  h.pose((s, d) => d.setPhaseTimer(s, 0));
  await h.frames(1);
}
