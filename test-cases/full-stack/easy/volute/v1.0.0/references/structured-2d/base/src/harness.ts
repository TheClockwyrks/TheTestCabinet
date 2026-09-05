// Volute — the shared test harness every check in this build runs on.
//
// Every check in this build runs the REAL engine, in process, over an
// `@napi-rs/canvas` canvas and a `SurfaceMetrics` of its own, so the game runs
// with no browser and no document behind it. Time comes from a `ConstantClock`
// of `1000 / 60` ms driven by `engine.advance`, which makes one frame exactly one
// simulation step of `1 / 60` s — the step `specs/instrumentation.md` fixes — so
// a duration is a frame count and the arithmetic asserted is the arithmetic the
// specification names.
//
// The produced files are served off disk: `fetch` is stubbed to read
// `public/assets/`, `createImageBitmap` to decode a PNG through the same canvas
// library, and `AudioContext` to decode a `.wav` into a placeholder buffer. What
// that buys is a run where the real produced sprites are really drawn, so a
// check can assert what the pipeline put on the canvas.
//
// What is read back is the engine's own object model — the world, its tagged
// actors, its game state — the debug surface the game instance returned from
// `initialize`, the engine's events, and the pixels the pipeline produced.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createCanvas,
  Image,
  loadImage,
  type SKRSContext2D,
} from "@napi-rs/canvas";
import {
  ConstantClock,
  createEngine,
  type Clock,
  type Engine,
  type SurfaceMetrics,
  type Viewport,
} from "@clockwyrks/structured-2d";
import { afterEach, beforeEach, vi } from "vitest";
import type { Core, Injector } from "./actors";
import { FIELD_H, FIELD_W, INJECTOR_X, INJECTOR_Y } from "./constants";
import type { ChargeId, MachineryKind } from "./constants";
import type { PosedCore, VoluteDebug, VoluteSnapshot } from "./debug";
import { BACKGROUND, game, VoluteGame } from "./game";
import { HallMode } from "./hall-mode";
import type { HallState } from "./state";

/** One frame of the fixed simulation step. */
export const FRAME_MS = 1000 / 60;

/** Frames at 60 Hz covering a duration in seconds. */
export function frames(seconds: number): number {
  return Math.ceil(seconds * 60);
}

/** The repository root, from which `public/assets/` is served. */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** One cue the engine announced. */
export interface CuePlay {
  cue: string;
  t: number;
  gain: number;
}

/** A key event shaped exactly as the engine reads one. */
class KeyEvent extends Event {
  readonly code: string;
  readonly repeat: boolean;

  constructor(type: "keydown" | "keyup", code: string, repeat = false) {
    super(type);
    this.code = code;
    this.repeat = repeat;
  }
}

/** A pointer event shaped exactly as the engine reads one. */
class PointerEvent extends Event {
  readonly clientX: number;
  readonly clientY: number;
  readonly isPrimary = true;

  constructor(type: string, x: number, y: number) {
    super(type);
    this.clientX = x;
    this.clientY = y;
  }
}

/** A decoded buffer stand-in: the engine only ever hands it to a node. */
class FakeAudioContext {
  decodeAudioData(): Promise<AudioBuffer> {
    return Promise.resolve({ duration: 1 } as unknown as AudioBuffer);
  }
}

/** Serve one produced file out of `public/`, as a static host would. */
async function serve(url: string): Promise<Response> {
  try {
    const bytes = await readFile(path.join(ROOT, "public", url));
    return new Response(new Uint8Array(bytes), { status: 200 });
  } catch {
    return new Response(null, { status: 404 });
  }
}

/** The engine, the surface, and everything a check reads or drives. */
export interface Harness {
  readonly engine: Engine<VoluteDebug>;
  readonly debug: VoluteDebug;
  readonly ctx: SKRSContext2D;
  readonly cues: CuePlay[];
  readonly loops: string[];
  readonly assetFailures: string[];
  snapshot(): VoluteSnapshot;
  state(): HallState;
  mode(): HallMode;
  instance(): VoluteGame;
  cores(): readonly Core[];
  injector(): Injector;
  hold(code: string): void;
  release(code: string): void;
  tap(code: string): void;
  point(x: number, y: number): void;
  click(x: number, y: number): void;
  pixel(x: number, y: number): [number, number, number, number];
  /** Every byte of the backing store the last frame was drawn into. */
  pixels(): Uint8ClampedArray;
  dispose(): void;
}

function toDevice(view: Viewport, x: number, y: number): [number, number] {
  return [
    Math.round(view.offsetX + x * view.scale),
    Math.round(view.offsetY + y * view.scale),
  ];
}

/** Stand a whole engine up over a canvas, a scripted clock, and the disk. */
export async function createHarness(
  options: { clock?: Clock } = {},
): Promise<Harness> {
  vi.stubGlobal("fetch", vi.fn(serve));
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(async (blob: Blob) => {
      const bytes = Buffer.from(await blob.arrayBuffer());
      return (await loadImage(bytes)) as unknown as ImageBitmap;
    }),
  );
  vi.stubGlobal("AudioContext", FakeAudioContext);
  // The engine's draw-command recorder captures a bitmap source by testing it
  // against the host's own `ImageBitmap`. In process there is no such global, so
  // the class this canvas library decodes into stands in for it — which is what
  // lets a recording carry the produced sprites the pipeline drew.
  vi.stubGlobal("ImageBitmap", Image);

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
    clock: options.clock ?? new ConstantClock(FRAME_MS),
    surface,
  });

  // Subscribed before any game code runs, so a produced file that did not
  // arrive is visible here rather than showing up later as wrong pixels.
  const assetFailures: string[] = [];
  engine.events.on("asset:failed", ({ path: file, reason }) => {
    assetFailures.push(`${file}: ${reason}`);
  });
  const cues: CuePlay[] = [];
  engine.events.on("cue:played", (play) => cues.push(play));
  const loops: string[] = [];
  engine.events.on("cue:looped", (play) => loops.push(play.cue));

  await engine.initialize();

  const key = (type: "keydown" | "keyup", code: string): void => {
    events.dispatchEvent(new KeyEvent(type, code));
  };
  const pointer = (type: string, x: number, y: number): void => {
    events.dispatchEvent(new PointerEvent(type, x, y));
  };
  const mode = (): HallMode => {
    const found = engine.world.mode;
    if (!(found instanceof HallMode)) throw new Error("no hall mode is open");
    return found;
  };

  return {
    engine,
    // Read off the engine rather than built here: `initialize` returned the
    // surface, the engine holds it, and reaching it this way is what makes that
    // return load-bearing.
    debug: engine.debug,
    ctx,
    cues,
    loops,
    assetFailures,
    snapshot: () => engine.debug.snapshot(),
    state: () => mode().state,
    mode,
    instance: () => {
      const found = engine.instance;
      if (!(found instanceof VoluteGame)) {
        throw new Error("Volute: the engine built no game instance");
      }
      return found;
    },
    cores: () => mode().state.cores,
    injector: () => mode().injector(),
    hold: (code) => key("keydown", code),
    release: (code) => key("keyup", code),
    tap: (code) => {
      key("keydown", code);
      key("keyup", code);
    },
    point: (x, y) => pointer("pointermove", x, y),
    click: (x, y) => {
      pointer("pointermove", x, y);
      pointer("pointerdown", x, y);
      pointer("pointerup", x, y);
    },
    pixels: () =>
      ctx.getImageData(0, 0, canvas.width, canvas.height)
        .data as unknown as Uint8ClampedArray,
    pixel: (x, y) => {
      const [dx, dy] = toDevice(engine.viewport(), x, y);
      const { data } = ctx.getImageData(dx, dy, 1, 1);
      return [data[0], data[1], data[2], data[3]];
    },
    dispose: () => engine.destroy(),
  };
}

/** The harness the check now running is driving. */
let harness: Harness | null = null;

/**
 * Stand a fresh engine up before every check in the calling file, and tear it
 * down after.
 *
 * Every check in this build runs against a hall of its own, so nothing one check
 * poses can reach the next.
 */
export function useHarness(): void {
  beforeEach(async () => {
    harness = await createHarness();
  });
  afterEach(() => {
    harness?.dispose();
    harness = null;
    vi.unstubAllGlobals();
  });
}

/** The harness the current check is running against. */
export function current(): Harness {
  if (harness === null) throw new Error("Volute: no harness is standing");
  return harness;
}

/**
 * Open a level of the run, and let the transition land.
 *
 * `startLevel` may have to open the hall level, which the engine performs at the
 * end of the frame, so a scenario advances one frame before it poses further —
 * which is exactly what `specs/instrumentation.md` asks a caller to do.
 */
export async function openLevel(h: Harness, level: number): Promise<void> {
  h.debug.startLevel(level);
  await h.engine.advance(1);
}

/** An isolated hall: one level open, the inlet stopped, and the channel bare. */
export async function isolate(h: Harness, level = 1): Promise<void> {
  await openLevel(h, level);
  h.debug.setQuotaRemaining(0);
  h.debug.clearTrain();
  h.debug.setPressure(0);
}

/** Pose a train of `[s, charge, mark]` triples. */
export function poseTrain(h: Harness, cores: readonly PosedCore[]): void {
  h.debug.poseTrain(cores);
}

/** A run of cores of one charge, one spacing apart, head first. */
export function run(
  head: number,
  count: number,
  charge: ChargeId,
  mark: MachineryKind | null = null,
): PosedCore[] {
  return Array.from({ length: count }, (_unused, i): PosedCore => [
    head - i * 28,
    charge,
    i === 0 ? mark : null,
  ]);
}

/**
 * The arc position of the point `(x, 420)` on the channel's lower leg.
 *
 * That leg runs 90 units below the injector and travels toward `-x`, so a shot
 * fired down at it lands in 0.145 s — barely three units of train drift — which
 * is what makes "the side the shot arrived on" a statement about the shot rather
 * than about the flight time.
 */
export function onLowerLeg(x: number): number {
  return 3540 + (840 - x);
}

/** The angle from the injector toward a point on the field, in degrees. */
export function toward(x: number, y: number): number {
  return (Math.atan2(y - INJECTOR_Y, x - INJECTOR_X) * 180) / Math.PI;
}

/**
 * Fire a core in front of the head of a train posed on the lower leg, and
 * advance frame by frame until it seats.
 */
export async function seatAhead(charge: string, head = 400): Promise<void> {
  const h = current();
  h.debug.setLoaded(charge);
  h.debug.setAim(toward(head - 20, 420));
  h.debug.fire();
  for (let i = 0; i < 20; i += 1) {
    await h.engine.advance(1);
    if (h.snapshot().projectiles.length === 0) return;
  }
  throw new Error("Volute: the shot never seated");
}

/**
 * How many bytes two frames of the backing store differ in.
 *
 * A frame is a couple of million bytes, so a check that compares two of them
 * counts the difference rather than deep-equalling the arrays: the count is what
 * every claim about the picture is actually written against, and it costs one
 * pass instead of a structural comparison of every byte.
 */
export function differing(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  if (a.length !== b.length) return Math.max(a.length, b.length);
  let count = 0;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) count += 1;
  return count;
}
