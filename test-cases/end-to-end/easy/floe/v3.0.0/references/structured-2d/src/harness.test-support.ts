// The harness the build's own suite stands the game up with.
//
// It builds a REAL engine over an `@napi-rs/canvas` canvas and a
// `SurfaceMetrics` of its own, so the game runs with no browser and no document
// behind it, and steps it with `engine.advance` against a `ConstantClock` whose
// step is exactly one simulation tick — which makes a duration a tick count and
// the arithmetic asserted in a test the arithmetic `specs/` names. Keys are
// driven by dispatching keyboard-shaped events at the surface's event target, the
// same listeners a player's input reaches. What is read back is the world's own
// `FloeState`, its tagged actors, the debug surface `initialize` returned, the
// engine's cue events, and the pixels the pipeline produced.
//
// The surface reports the canvas at the design size with a device pixel ratio of
// `1` and no origin, so the camera at rest maps world onto logical one to one and
// a pixel read needs no conversion.
//
// Node has neither `createImageBitmap` nor a `fetch` that resolves a relative
// path, so the seeded art would not arrive and the game would draw its
// fallbacks. `installAssetHost` supplies both from the files on disk, so a
// headless run draws the same picture a browser does.
//
// Reading a file needs Node's own types, and the project's `tsconfig.json`
// declares no global type packages, so this file asks for the one it needs. The
// declaration is scoped to this module, which is the only one that reads the disk;
// nothing the game ships touches Node.

/// <reference types="node" />

import { createCanvas, loadImage, type SKRSContext2D } from "@napi-rs/canvas";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  ConstantClock,
  createEngine,
  type Engine,
  type SurfaceMetrics,
} from "@test-cabinet/structured-2d";
import { LAYOUT, STAGE_H, STAGE_W, TICK_DT, TICK_HZ } from "./constants";
import {
  BACKGROUND,
  floeState,
  game,
  type FloeDebugApi,
  type FloeSnapshotShape,
  type FloeState,
} from "./game";

/** One frame is one simulation tick, so `advance(n)` runs exactly `n` ticks. */
export const FRAME_MS = TICK_DT * 1000;

/**
 * How many whole ticks a frame carries while `waitFor` waits out a cadence the
 * specification measures in seconds. The same ticks run either way; only the
 * pictures between them are skipped.
 */
export const WAIT_TICKS_PER_FRAME = 10;

/** A keyboard-shaped event, which is all the engine's listeners read. */
export class KeyEvent extends Event {
  readonly code: string;
  readonly repeat = false;

  constructor(type: "keydown" | "keyup", code: string) {
    super(type);
    this.code = code;
  }
}

/** One `cue:played` the engine emitted. */
export interface CuePlay {
  cue: string;
  gain: number;
}

export interface Harness {
  readonly engine: Engine<FloeDebugApi>;
  /** The world's live game state. */
  readonly state: FloeState;
  /** The surface `initialize` returned, read back off the engine. */
  readonly debug: FloeDebugApi;
  readonly ctx: SKRSContext2D;
  /** Every `cue:played` the engine emitted, in order. */
  readonly cues: CuePlay[];
  /** Every asset the engine failed to load, as `path: reason`. */
  readonly assetFailures: string[];
  snapshot(): FloeSnapshotShape;
  /** Hold a key down, let one up, and press one for a single tick. */
  down(code: string): void;
  up(code: string): void;
  tap(code: string): Promise<void>;
  /** Run `ticks` whole simulation ticks. */
  step(ticks: number): Promise<void>;
  /** Run ticks until `ready` holds, or give up after `limit` of them. */
  until(ready: () => boolean, limit: number): Promise<boolean>;
  /**
   * Run until `ready` holds, or until `seconds` of game time have passed, in
   * frames of many ticks each, so waiting out a long cadence costs a picture
   * every tenth of a second rather than one per tick. It leaves one tick a frame
   * behind it, so what follows reads tick by tick again.
   */
  waitFor(ready: () => boolean, seconds: number): Promise<boolean>;
  /** Put `perFrame` whole ticks in each frame from here on. */
  pace(perFrame: number): void;
  pixel(x: number, y: number): [number, number, number];
  dispose(): void;
}

/**
 * Teach this process to fetch a relative asset path off disk and to decode an
 * image, which is what the browser gives the engine's asset loader for free.
 */
export function installAssetHost(): void {
  const host = globalThis as {
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

  const assetFailures: string[] = [];
  engine.events.on("asset:failed", ({ path, reason }) => {
    assetFailures.push(`${path}: ${reason}`);
  });
  const cues: CuePlay[] = [];
  engine.events.on("cue:played", ({ cue, gain }) => cues.push({ cue, gain }));

  await engine.initialize();

  const harness: Harness = {
    engine,
    get state() {
      return floeState(engine.world);
    },
    // Read off the engine rather than built here, so a build that failed to
    // return the surface from `initialize` fails at the seam a caller uses.
    debug: engine.debug,
    ctx,
    cues,
    assetFailures,
    snapshot: () => engine.debug.snapshot(),
    down: (code) => events.dispatchEvent(new KeyEvent("keydown", code)),
    up: (code) => events.dispatchEvent(new KeyEvent("keyup", code)),
    tap: async (code) => {
      events.dispatchEvent(new KeyEvent("keydown", code));
      await engine.advance(1);
      events.dispatchEvent(new KeyEvent("keyup", code));
      await engine.advance(1);
    },
    step: (ticks) => engine.advance(ticks),
    pace: (perFrame) => {
      engine.setClock(new ConstantClock(FRAME_MS * perFrame));
    },
    until: async (ready, limit) => {
      for (let tick = 0; tick < limit; tick++) {
        if (ready()) return true;
        await engine.advance(1);
      }
      return ready();
    },
    waitFor: async (ready, seconds) => {
      harness.pace(WAIT_TICKS_PER_FRAME);
      const frames = Math.ceil((seconds * TICK_HZ) / WAIT_TICKS_PER_FRAME);
      const reached = await harness.until(ready, frames);
      harness.pace(1);
      return reached;
    },
    pixel: (x, y) => {
      const { data } = ctx.getImageData(Math.round(x), Math.round(y), 1, 1);
      return [data[0], data[1], data[2]];
    },
    dispose: () => engine.destroy(),
  };
  return harness;
}
