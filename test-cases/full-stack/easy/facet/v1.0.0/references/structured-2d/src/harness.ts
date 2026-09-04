// The test harness the build's own suite stands the game up with.
//
// A harness builds a REAL engine over an `@napi-rs/canvas` canvas and a
// `SurfaceMetrics` of its own, so the game runs with no browser and no document
// behind it, and steps it with `engine.advance` against a `ConstantClock`. Keys
// and the pointer are driven by dispatching keyboard-shaped and pointer-shaped
// events at the surface's event target — the same listeners a player's input
// reaches — and what is read back is the world's own `FacetState`, the debug
// surface `initialize` returned, the engine's cue events, and the pixels the
// render produced: the recipe `specs/overview.md` states for the build's own
// tests.
//
// THE PRODUCED FILES ARE REALLY LOADED. Node has neither `fetch` over a
// page-relative path nor `createImageBitmap`, so this module installs both over
// the committed tree under `public/assets/`: the engine's own asset loader then
// resolves, fetches, and decodes exactly the paths the served build asks for,
// and the tests draw the real sprites and simulate the real particle systems.
// Audio is the one thing that cannot follow — decoding a `.wav` needs a Web
// Audio context and Node has none — so every cue keeps the synthesized
// placeholder `src/audio.ts` declared it with, plays by name, and emits its
// `cue:played` exactly as a loaded cue does.
//
// The surface reports the canvas at the design size with a device pixel ratio
// of 1 and no origin, so a dispatched event's client position IS a logical
// stage position, the camera at rest maps world onto logical one to one, and a
// pixel read needs no conversion either.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createCanvas, loadImage, type SKRSContext2D } from "@napi-rs/canvas";
import {
  ConstantClock,
  createEngine,
  type Engine,
  type SurfaceMetrics,
} from "@test-cabinet/structured-2d";
import { LAYOUT, STAGE_H, STAGE_W } from "./constants";
import { Bench } from "./bench";
import { BACKGROUND, facetState, game } from "./game";
import type { FacetDebugApi, FacetState, PointerDevice } from "./game";
import type { ScratchCanvas } from "./effects";

/** One frame at sixty a second, in milliseconds, which the clock supplies. */
export const FRAME_MS = 1000 / 60;

/** The committed tree the engine's `assets/` root is served from here. */
const PUBLIC_DIR = fileURLToPath(new URL("../public/", import.meta.url));

/** A keyboard event the engine's own listener reads exactly as a real one. */
export class KeyEvent extends Event {
  readonly code: string;
  readonly repeat = false;

  constructor(type: "keydown" | "keyup", code: string) {
    super(type);
    this.code = code;
  }
}

/**
 * A pointer event, the same. `pointerType` is what the engine reads the device
 * off, so a dispatched touch reaches the game exactly as a real finger does.
 */
export class PointerEvt extends Event {
  readonly clientX: number;
  readonly clientY: number;
  readonly isPrimary = true;
  readonly pointerType: PointerDevice;

  constructor(
    type: "pointerdown" | "pointermove" | "pointerup",
    x: number,
    y: number,
    device: PointerDevice = "mouse",
  ) {
    super(type);
    this.clientX = x;
    this.clientY = y;
    this.pointerType = device;
  }
}

/**
 * Serve `public/` over `globalThis.fetch` and decode PNGs through
 * `@napi-rs/canvas`, once for the process. Both are what the engine's asset
 * loader reaches for, so nothing about the game changes to be tested.
 */
function installAssetHost(): void {
  const host = globalThis as {
    fetch?: unknown;
    createImageBitmap?: unknown;
    __facetAssetHost?: boolean;
  };
  if (host.__facetAssetHost === true) return;
  host.__facetAssetHost = true;

  host.fetch = (input: unknown): Promise<Response> => {
    const path = String(input);
    try {
      return Promise.resolve(
        new Response(new Uint8Array(readFileSync(PUBLIC_DIR + path))),
      );
    } catch {
      return Promise.resolve(new Response(null, { status: 404 }));
    }
  };
  host.createImageBitmap = async (blob: Blob): Promise<ImageBitmap> => {
    const bytes = Buffer.from(await blob.arrayBuffer());
    return (await loadImage(bytes)) as unknown as ImageBitmap;
  };
}

/** A scratch canvas factory over `@napi-rs/canvas`, for the effects tests. */
export function napiScratch(): ScratchCanvas {
  return (width, height) =>
    createCanvas(
      Math.max(1, Math.ceil(width)),
      Math.max(1, Math.ceil(height)),
    ).getContext("2d") as unknown as CanvasRenderingContext2D;
}

/** One `cue:played` the engine emitted. */
export interface CuePlay {
  cue: string;
  gain: number;
}

export interface Harness {
  readonly engine: Engine<FacetDebugApi>;
  /** The world's live game state. */
  readonly state: FacetState;
  /** The surface `initialize` returned, read back off the engine. */
  readonly debug: FacetDebugApi;
  /** The one bench actor the level declares, and its presentation layer. */
  readonly bench: Bench;
  readonly ctx: SKRSContext2D;
  /** Every `cue:played` the engine emitted, in order. */
  readonly cues: CuePlay[];
  /** Every `cue:looped` the engine emitted, in order. */
  readonly loops: string[];
  tap(code: string): void;
  hold(code: string): void;
  release(code: string): void;
  pointer(
    type: "pointerdown" | "pointermove" | "pointerup",
    x: number,
    y: number,
    device?: PointerDevice,
  ): void;
  advance(frames: number): Promise<void>;
  pixel(x: number, y: number): [number, number, number];
  /** The brightest pixel in a rectangle, which is how a mark is looked for. */
  brightest(
    x: number,
    y: number,
    w: number,
    h: number,
  ): [number, number, number];
  /** How many pixels in a rectangle are brighter than `threshold`. */
  litPixels(
    x: number,
    y: number,
    w: number,
    h: number,
    threshold: number,
  ): number;
  dispose(): void;
}

/** Stand a real engine up over a canvas and a surface of the test's own. */
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

  const cues: CuePlay[] = [];
  const loops: string[] = [];
  engine.events.on("cue:played", ({ cue, gain }) => cues.push({ cue, gain }));
  engine.events.on("cue:looped", ({ cue }) => loops.push(cue));

  await engine.initialize();

  const bench = engine.world.find(Bench);
  if (bench === null) throw new Error("Facet: the level declared no bench");

  return {
    engine,
    get state() {
      return facetState(engine.world);
    },
    // Read off the engine rather than built here, so a build that failed to
    // return the surface from `initialize` fails here.
    debug: engine.debug,
    bench,
    ctx,
    cues,
    loops,
    tap: (code) => {
      events.dispatchEvent(new KeyEvent("keydown", code));
      events.dispatchEvent(new KeyEvent("keyup", code));
    },
    hold: (code) => {
      events.dispatchEvent(new KeyEvent("keydown", code));
    },
    release: (code) => {
      events.dispatchEvent(new KeyEvent("keyup", code));
    },
    pointer: (type, x, y, device) => {
      events.dispatchEvent(new PointerEvt(type, x, y, device));
    },
    advance: (frames) => engine.advance(frames),
    pixel: (x, y) => {
      const { data } = ctx.getImageData(Math.round(x), Math.round(y), 1, 1);
      return [data[0], data[1], data[2]];
    },
    brightest: (x, y, w, h) => {
      const { data } = ctx.getImageData(x, y, w, h);
      let best: [number, number, number] = [0, 0, 0];
      let bestSum = -1;
      for (let index = 0; index < data.length; index += 4) {
        const sum = data[index] + data[index + 1] + data[index + 2];
        if (sum > bestSum) {
          bestSum = sum;
          best = [data[index], data[index + 1], data[index + 2]];
        }
      }
      return best;
    },
    litPixels: (x, y, w, h, threshold) => {
      const { data } = ctx.getImageData(x, y, w, h);
      let lit = 0;
      for (let index = 0; index < data.length; index += 4) {
        const sum = data[index] + data[index + 1] + data[index + 2];
        if (sum >= threshold * 3) lit += 1;
      }
      return lit;
    },
    dispose: () => {
      engine.destroy();
    },
  };
}
