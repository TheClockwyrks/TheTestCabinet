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
// The surface reports the canvas at the design size with a device pixel ratio of 1
// and no origin, so the camera at rest maps world onto logical one to one and a
// pixel read needs no conversion.
//
// Node has neither `createImageBitmap` nor a `fetch` that resolves a relative
// path, so the seeded art would not arrive and the game would draw its fallbacks.
// `installAssetHost` supplies both from the files on disk, so a headless run draws
// the same picture a browser does.

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createCanvas, loadImage, type SKRSContext2D } from "@napi-rs/canvas";
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

/** One `drawImage`: the source handed over, and the box it landed in. */
export interface Blit {
  source: unknown;
  x: number;
  y: number;
  width: number;
  height: number;
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
  /**
   * Every string the game has drawn through `fillText`, in order.
   *
   * The spy is installed before the engine is built, because the engine's
   * draw-command recorder wraps the context once and caches a wrapper per method
   * name — so a spy installed later would be seen for one frame and then dropped.
   * A test empties the list rather than replacing it.
   */
  readonly texts: string[];
  /**
   * Every image the game has blitted: the source it was handed and the box it
   * was drawn into, in the stage's own logical units.
   */
  readonly blits: Blit[];
  /** Hold a key down, let one up, and press one for a single frame. */
  down(code: string): void;
  up(code: string): void;
  tap(code: string): Promise<void>;
  /** Run `frames` whole frames of `FRAME_DT` each. */
  advance(frames: number): Promise<void>;
  /** Run whole frames covering about `seconds` of game time. */
  seconds(seconds: number): Promise<void>;
  /** Run frames until `ready` holds, or give up after `limit` of them. */
  until(ready: () => boolean, limit: number): Promise<boolean>;
  pixel(x: number, y: number): [number, number, number];
  dispose(): void;
}

/**
 * Teach this process to fetch a relative asset path off disk and to decode an
 * image, which is what a browser gives the engine's asset loader for free.
 */
export function installAssetHost(): void {
  const host = globalThis as unknown as {
    createImageBitmap?: (blob: Blob) => Promise<ImageBitmap>;
    fetch: typeof fetch;
  };

  if (host.createImageBitmap === undefined) {
    host.createImageBitmap = async (blob: Blob): Promise<ImageBitmap> => {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      return (await loadImage(bytes)) as unknown as ImageBitmap;
    };
  }

  const root = new URL("../", import.meta.url);
  const upstream = host.fetch;
  host.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = typeof input === "string" ? input : String(input);
    if (/^[a-z][a-z0-9+.-]*:/i.test(path)) return upstream(input, init);
    const bytes = await readFile(fileURLToPath(new URL(path, root)));
    return new Response(new Uint8Array(bytes), { status: 200 });
  };
}

export async function createHarness(): Promise<Harness> {
  installAssetHost();

  const canvas = createCanvas(STAGE_W, STAGE_H);
  const ctx = canvas.getContext("2d");
  const element = Object.assign(canvas, {
    style: {} as CSSStyleDeclaration,
    getContext: () => ctx,
  }) as unknown as HTMLCanvasElement;

  // Installed before `createEngine`, so the recorder's own wrapper is built over
  // it and every frame's text reaches the list.
  const texts: string[] = [];
  const spied = ctx as unknown as {
    fillText: (value: string, x: number, y: number) => void;
  };
  const drawText = spied.fillText.bind(spied);
  spied.fillText = (value, x, y) => {
    texts.push(String(value));
    drawText(value, x, y);
  };

  const blits: Blit[] = [];
  const blitter = ctx as unknown as {
    drawImage: (...args: unknown[]) => void;
  };
  const drawImage = blitter.drawImage.bind(blitter);
  blitter.drawImage = (...args: unknown[]) => {
    const box = args.length >= 9 ? args.slice(5) : args.slice(1);
    blits.push({
      source: args[0],
      x: Number(box[0]),
      y: Number(box[1]),
      width: Number(box[2] ?? 0),
      height: Number(box[3] ?? 0),
    });
    drawImage(...args);
  };

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

  const advance = (frames: number): Promise<void> => engine.advance(frames);

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
    texts,
    blits,
    down: (code) => events.dispatchEvent(new KeyEvent("keydown", code)),
    up: (code) => events.dispatchEvent(new KeyEvent("keyup", code)),
    tap: async (code) => {
      events.dispatchEvent(new KeyEvent("keydown", code));
      await advance(1);
      events.dispatchEvent(new KeyEvent("keyup", code));
      await advance(1);
    },
    advance,
    seconds: (value) => advance(Math.max(1, Math.round(value * 60))),
    until: async (ready, limit) => {
      for (let frame = 0; frame < limit; frame += 1) {
        if (ready()) return true;
        await advance(1);
      }
      return ready();
    },
    pixel: (x, y) => {
      const { data } = ctx.getImageData(Math.round(x), Math.round(y), 1, 1);
      return [data[0], data[1], data[2]];
    },
    dispose: () => engine.destroy(),
  };
}

/**
 * The scenario every mechanic test starts from: an empty, quiet live wave, posed
 * through the debug surface exactly as a caller would.
 */
export function startPosed(debug: SpectraDebugApi): void {
  debug.reset();
  debug.clearDrones();
  debug.clearPlayerBullets();
  debug.clearEnemyBullets();
  debug.clearBursts();
  debug.setWaveEntry(false);
  debug.setDiveLaunching(false);
  debug.setShipContact(false);
  debug.setScreen("inWave");
  debug.setPhase("live");
  debug.setPhaseTimer(0);
  debug.setStage(1);
  debug.setShipX(640);
  debug.setShipBand("cyan");
  debug.setFireLockout(0);
  debug.setFireCooldown(0);
  debug.setResonance(0);
  debug.setInversion(0);
  debug.setDiveClock(0);
}

/** The id of the drone the surface last appended. */
export function lastDroneId(debug: SpectraDebugApi): number {
  const { drones } = debug.snapshot();
  return drones[drones.length - 1]?.id ?? 0;
}

/** The id of the bullet the surface last appended. */
export function lastBulletId(debug: SpectraDebugApi): number {
  const { bullets } = debug.snapshot();
  return bullets[bullets.length - 1]?.id ?? 0;
}
