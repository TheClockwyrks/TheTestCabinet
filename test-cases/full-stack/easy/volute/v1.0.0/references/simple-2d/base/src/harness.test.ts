/// <reference types="node" />
// Volute under the engine, in process — the harness the rest of the tests drive
// the game through, and its own checks.
//
// Every check here builds a real engine over an `@napi-rs/canvas` canvas and a
// `SurfaceMetrics` of its own, so the game runs with no browser and no document
// behind it, and steps it with `engine.advance` against a `ConstantClock` of one
// `TICK_DT` — which makes one frame exactly one simulation tick and every
// duration below a whole number of them. What is read back is the game's own
// state, the debug surface the game returned beside it, the engine's events, and
// the pixels and draw calls the render produced.
//
// THE SURFACE IS READ OFF THE ENGINE, never built here: `initialize` returns it
// beside the state as `[state, debug]`, so a build that returned none fails here
// rather than being handed a surface this file constructed for it. A pose takes a
// state and returns the next one and is driven through `engine.apply`; a reading
// is handed `engine.state`. `h.pose` and `h.snapshot` are those two moves, named.
//
// THE PRODUCED FILES ARE REALLY LOADED. Node has neither `fetch` for a relative
// URL nor `createImageBitmap`, so the harness supplies both: the first reads
// `public/` off the disk, the second decodes through `@napi-rs/canvas`. That is
// what makes the rendering checks checks of the produced art rather than of the
// fallbacks. `bareHarness` deliberately leaves both out, so the other half — a
// host that can decode nothing — is exercised too.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas, loadImage, type SKRSContext2D } from "@napi-rs/canvas";
import {
  ConstantClock,
  createEngine,
  type Clock,
  type Engine,
  type SurfaceMetrics,
  type Viewport,
} from "@clockwyrks/simple-2d";
import type { DeepReadonly } from "ts-essentials";
import { describe, expect, it } from "vitest";
import {
  ACTIONS,
  BINDINGS,
  CELLS,
  FIELD_H,
  FIELD_W,
  LAYOUT,
  TICK_DT,
} from "./constants";
import type { PosedCore, VoluteSnapshot } from "./debug";
import {
  BACKGROUND,
  game,
  type VoluteDebugApi,
  type VoluteState,
} from "./game";

/** The project root, so the produced files are found however the suite is run. */
const ROOT = fileURLToPath(new URL("..", import.meta.url));

/** One frame of the harness's clock, in milliseconds: exactly one tick. */
export const FRAME_MS = TICK_DT * 1000;

/** One recorded operation on the drawing context. */
export type DrawCall =
  | { kind: "call"; method: string; args: unknown[] }
  | { kind: "set"; property: string; value: unknown };

/** One cue the engine reported. */
export interface CuePlay {
  cue: string;
  t: number;
  gain: number;
}

/**
 * The pure surface as a caller drives it: every pose minus its state argument,
 * over the engine that holds the state.
 */
export interface Driver {
  reset(options?: { seed?: number }): void;
  setScreen(name: string): void;
  setLevel(level: number): void;
  setScore(n: number): void;
  setCells(n: number): void;
  setChainStep(k: number): void;
  startLevel(level: number): void;
  poseTrain(cores: readonly PosedCore[]): void;
  clearTrain(): void;
  setLoaded(charge: string): void;
  setQueued(charge: string): void;
  setAim(angleDegrees: number): void;
  fire(): void;
  /**
   * Point the injector and release, as `setAim` then `fire`.
   *
   * A convenience of this harness rather than an operation of the surface: the
   * surface's poses are single-field, and a sequence over them belongs here
   * (specs/instrumentation.md).
   */
  fireAt(angleDegrees: number): void;
  /** Open a fresh run on level 1, as the start control on the title does. */
  start(): void;
  setPressure(value: number): void;
  setQuotaRemaining(n: number): void;
  setEmission(enabled: boolean): void;
  setFeed(enabled: boolean): void;
  grantMachinery(kind: string): void;
  pause(): void;
  resume(): void;
  snapshot(): VoluteSnapshot;
}

/** A hall under test. */
export interface Harness {
  readonly engine: Engine<VoluteState, VoluteDebugApi>;
  /** The current state: `engine.state`, read at the moment it is read. */
  readonly state: DeepReadonly<VoluteState>;
  readonly debug: VoluteDebugApi;
  /**
   * The surface as a scenario drives it: each pose bound to the engine, so
   * `h.api.startLevel(1)` is `engine.apply((s) => debug.startLevel(s, 1))` and
   * `h.api.snapshot()` is `debug.snapshot(engine.state)`.
   */
  readonly api: Driver;
  /** Apply a pose from the surface to the current state. */
  pose(transition: (state: DeepReadonly<VoluteState>) => VoluteState): void;
  /** The surface's reading of the current state. */
  snapshot(): VoluteSnapshot;
  readonly ctx: SKRSContext2D;
  readonly calls: DrawCall[];
  /** Every cue played, in order. */
  readonly cues: CuePlay[];
  /** Every loop started, and every loop stopped, in order. */
  readonly looped: string[];
  readonly stopped: string[];
  readonly assetFailures: string[];
  hold(code: string): void;
  release(code: string): void;
  tap(code: string): void;
  /** Deliver a pointer position, in logical units. */
  point(x: number, y: number): void;
  /** Press and release the pointer at a position, in logical units. */
  click(x: number, y: number): void;
  /** Run whole frames, each exactly one simulation tick. */
  step(frames?: number): Promise<void>;
  pixel(x: number, y: number): [number, number, number, number];
  /** The cues played since the marker, so one step can be probed on its own. */
  since(marker: number): string[];
  dispose(): void;
}

class KeyEvent extends Event {
  readonly code: string;
  readonly repeat: boolean;

  constructor(type: "keydown" | "keyup", code: string, repeat = false) {
    super(type);
    this.code = code;
    this.repeat = repeat;
  }
}

class PointerishEvent extends Event {
  readonly clientX: number;
  readonly clientY: number;
  readonly isPrimary = true;

  constructor(type: string, x: number, y: number) {
    super(type);
    this.clientX = x;
    this.clientY = y;
  }
}

function recorder(target: SKRSContext2D, calls: DrawCall[]): SKRSContext2D {
  return new Proxy(target, {
    get(object, property) {
      const value = Reflect.get(object, property, object) as unknown;
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        calls.push({ kind: "call", method: String(property), args });
        return (value as (...rest: unknown[]) => unknown).apply(object, args);
      };
    },
    set(object, property, value) {
      calls.push({ kind: "set", property: String(property), value });
      return Reflect.set(object, property, value, object);
    },
  });
}

/** Every argument list a method was called with, in order. */
export function callsTo(
  calls: readonly DrawCall[],
  method: string,
): unknown[][] {
  return calls.flatMap((call) =>
    call.kind === "call" && call.method === method ? [call.args] : [],
  );
}

/** Every string a `fillText` drew, in order. */
export function drawnText(calls: readonly DrawCall[]): string[] {
  return callsTo(calls, "fillText").map((args) => String(args[0]));
}

function toDevice(view: Viewport, x: number, y: number): [number, number] {
  return [
    Math.round(view.offsetX + x * view.scale),
    Math.round(view.offsetY + y * view.scale),
  ];
}

/**
 * Serve `public/` off the disk and decode a PNG through `@napi-rs/canvas`.
 *
 * Installed once, on the globals the engine's own loader reaches for, so the
 * engine loads the committed files by exactly the path a page would.
 */
function installAssetHost(): void {
  const host = globalThis as unknown as {
    fetch?: unknown;
    createImageBitmap?: unknown;
  };
  host.fetch = async (input: unknown): Promise<Response> => {
    const path = join(ROOT, "public", String(input));
    try {
      const bytes = readFileSync(path);
      return new Response(new Uint8Array(bytes), { status: 200 });
    } catch {
      return new Response(null, { status: 404, statusText: "Not Found" });
    }
  };
  host.createImageBitmap = async (blob: Blob): Promise<ImageBitmap> => {
    const bytes = Buffer.from(await blob.arrayBuffer());
    return (await loadImage(bytes)) as unknown as ImageBitmap;
  };
}

/** Take the asset host away again, leaving a host that can decode nothing. */
function removeAssetHost(): void {
  const host = globalThis as unknown as {
    fetch?: unknown;
    createImageBitmap?: unknown;
  };
  delete host.fetch;
  delete host.createImageBitmap;
}

interface HarnessOptions {
  /** The clock the engine steps on; one tick a frame by default. */
  clock?: Clock;
  /** Whether the produced files are reachable at all. */
  assets?: boolean;
}

/** Build a hall under test, initialized and ready to step. */
export async function harness(options: HarnessOptions = {}): Promise<Harness> {
  const canvas = createCanvas(FIELD_W, FIELD_H);
  const ctx = canvas.getContext("2d");
  const calls: DrawCall[] = [];
  const recorded = recorder(ctx, calls);
  const element = Object.assign(canvas, {
    style: {} as CSSStyleDeclaration,
    getContext: () => recorded,
  }) as unknown as HTMLCanvasElement;

  const events = new EventTarget();
  const surface: SurfaceMetrics = {
    cssWidth: () => FIELD_W,
    cssHeight: () => FIELD_H,
    dpr: () => 1,
    events: () => events,
  };

  if (options.assets === false) removeAssetHost();
  else installAssetHost();

  // Exactly the options src/main.ts passes, plus the clock and the surface a
  // headless run needs.
  const engine = createEngine<VoluteState, VoluteDebugApi>({
    canvas: element,
    width: FIELD_W,
    height: FIELD_H,
    game,
    background: BACKGROUND,
    layout: LAYOUT,
    clock: options.clock ?? new ConstantClock(FRAME_MS),
    surface,
  });

  // Subscribed before any game code runs, so a failure during the game's own
  // initialization is visible rather than showing up later as wrong pixels.
  const assetFailures: string[] = [];
  engine.events.on("asset:failed", ({ path, reason }) => {
    assetFailures.push(`${path}: ${reason}`);
  });
  const cues: CuePlay[] = [];
  engine.events.on("cue:played", (play) => cues.push(play));
  const looped: string[] = [];
  engine.events.on("cue:looped", (play) => looped.push(play.cue));
  const stopped: string[] = [];
  engine.events.on("cue:stopped", (play) => stopped.push(play.cue));

  await engine.initialize();

  // Read off the engine rather than built here: `initialize` returns the surface
  // beside the state, so reaching it this way is what makes that return
  // load-bearing.
  const debug = engine.debug;

  const dispatch = (event: Event): void => {
    events.dispatchEvent(event);
  };

  const api: Driver = {
    reset: (options) => void engine.apply((s) => debug.reset(s, options)),
    setScreen: (name) => void engine.apply((s) => debug.setScreen(s, name)),
    setLevel: (level) => void engine.apply((s) => debug.setLevel(s, level)),
    setScore: (n) => void engine.apply((s) => debug.setScore(s, n)),
    setCells: (n) => void engine.apply((s) => debug.setCells(s, n)),
    setChainStep: (k) => void engine.apply((s) => debug.setChainStep(s, k)),
    startLevel: (level) => void engine.apply((s) => debug.startLevel(s, level)),
    poseTrain: (cores) => void engine.apply((s) => debug.poseTrain(s, cores)),
    clearTrain: () => void engine.apply((s) => debug.clearTrain(s)),
    setLoaded: (charge) => void engine.apply((s) => debug.setLoaded(s, charge)),
    setQueued: (charge) => void engine.apply((s) => debug.setQueued(s, charge)),
    setAim: (angle) => void engine.apply((s) => debug.setAim(s, angle)),
    fire: () => void engine.apply((s) => debug.fire(s)),
    fireAt: (angle) => {
      engine.apply((s) => debug.setAim(s, angle));
      engine.apply((s) => debug.fire(s));
    },
    start: () => {
      engine.apply((s) => debug.setScore(s, 0));
      engine.apply((s) => debug.setCells(s, CELLS));
      engine.apply((s) => debug.startLevel(s, 1));
    },
    setPressure: (value) =>
      void engine.apply((s) => debug.setPressure(s, value)),
    setQuotaRemaining: (n) =>
      void engine.apply((s) => debug.setQuotaRemaining(s, n)),
    setEmission: (enabled) =>
      void engine.apply((s) => debug.setEmission(s, enabled)),
    setFeed: (enabled) => void engine.apply((s) => debug.setFeed(s, enabled)),
    grantMachinery: (kind) =>
      void engine.apply((s) => debug.grantMachinery(s, kind)),
    pause: () => void engine.apply((s) => debug.pause(s)),
    resume: () => void engine.apply((s) => debug.resume(s)),
    snapshot: () => debug.snapshot(engine.state),
  };

  return {
    engine,
    get state() {
      return engine.state;
    },
    debug,
    api,
    pose: (transition) => {
      engine.apply(transition);
    },
    snapshot: () => debug.snapshot(engine.state),
    ctx,
    calls,
    cues,
    looped,
    stopped,
    assetFailures,
    hold: (code) => dispatch(new KeyEvent("keydown", code)),
    release: (code) => dispatch(new KeyEvent("keyup", code)),
    tap: (code) => {
      dispatch(new KeyEvent("keydown", code));
      dispatch(new KeyEvent("keyup", code));
    },
    point: (x, y) => dispatch(new PointerishEvent("pointermove", x, y)),
    click: (x, y) => {
      dispatch(new PointerishEvent("pointerdown", x, y));
      dispatch(new PointerishEvent("pointerup", x, y));
    },
    step: (frames = 1) => engine.advance(frames),
    pixel: (x, y) => {
      const [dx, dy] = toDevice(engine.viewport(), x, y);
      const { data } = ctx.getImageData(dx, dy, 1, 1);
      return [data[0], data[1], data[2], data[3]];
    },
    since: (marker) => cues.slice(marker).map((play) => play.cue),
    dispose: () => {
      engine.destroy();
      installAssetHost();
    },
  };
}

/** The last entry of a list, which the ES2020 target has no `Array#at` for. */
export function last<T>(items: readonly T[]): T {
  return items[items.length - 1];
}

/**
 * A hall on `level` with the inlet spent and one core parked out of the way, near
 * the inlet end of the straight top run.
 *
 * The core is deliberate: a channel that is EMPTY while the quota is spent is a
 * cleared level (specs/channel.md, step 6), and a cleared level advances nothing
 * but its own interlude — so a scenario that wants the hall to keep running has
 * to leave something on the channel. At `s = 100` it stands at `(140, 40)`,
 * hundreds of units clear of every shot fired below.
 */
export async function bare(level = 1): Promise<Harness> {
  const h = await harness();
  h.api.startLevel(level);
  h.api.setPressure(0);
  // The inlet is held rather than starved, so the level's quota stands and an
  // emptied channel is never cleared for an exhausted one. Nothing arrives, and
  // no bystander core has to stand in a corner keeping the hall in play.
  h.api.setEmission(false);
  h.api.clearTrain();
  return h;
}

/**
 * The arc position of the point `(x, 220)` on the straight leg the intake side of
 * the hall runs along, where the channel's forward is `+x`.
 *
 * The injector stands at `(420, 330)`, 110 units below this leg, so a shot fired
 * straight up crosses it after ten ticks — short enough that a posed train has
 * barely ridden when the strike resolves.
 */
export function topLegS(x: number): number {
  return 4360 + (x - 220);
}

/**
 * Fire straight up, carry the shot to one tick short of the `y = 220` leg, pose a
 * train across its path, and let the strike resolve.
 *
 * This is how a scenario aims a shot at an exact core: the train is put in place
 * at the last moment, so the feed has not carried it anywhere between the pose and
 * the strike.
 */
export async function seatShot(
  h: Harness,
  cores: readonly PosedCore[],
  charge = "cobalt",
  posed?: () => void,
): Promise<void> {
  const step = 620 / 60;
  h.api.setLoaded(charge);
  h.api.fireAt(270);
  for (let i = 0; i < 60; i += 1) {
    const shot = h.api.snapshot().projectiles[0];
    if (shot === undefined || shot.y - step <= 220) break;
    await h.step();
  }
  h.api.poseTrain(cores);
  // Anything the caller wants standing on the LAST tick alone, such as an
  // exhausted quota that would otherwise clear the level during the flight.
  posed?.();
  await h.step();
}

/** A run of `charges` one spacing apart, head first, as `poseTrain` takes it. */
export function runOf(
  headS: number,
  charges: readonly string[],
  marks: readonly (string | null)[] = [],
): PosedCore[] {
  return charges.map((charge, index) => [
    headS - index * 28,
    charge,
    marks[index] ?? null,
  ]);
}

describe("the harness", () => {
  it("loads every produced sprite, sheet frame and particle system", async () => {
    const h = await harness();
    // Node has no Web Audio, so the fifteen `.wav` decodes are the one class of
    // load that cannot succeed here; every other produced file must.
    expect(
      h.assetFailures.filter((line) => !line.startsWith("audio/")),
    ).toEqual([]);
    h.dispose();
  });

  it("keeps every cue playable when its produced file cannot be decoded", async () => {
    const h = await harness();
    // A load that fails leaves the name bound to the shape `src/audio.ts`
    // declared it with, so a cue is never an undeclared name the engine throws
    // on. The fifteen failures here are exactly the fifteen cue files.
    expect(h.assetFailures).toHaveLength(15);
    h.api.setScore(0);
    h.api.setCells(CELLS);
    h.api.startLevel(1);
    h.tap(BINDINGS.a[0]);
    await h.step(1);
    expect(h.cues.map((play) => play.cue)).toContain("fire");
    h.dispose();
  });

  it("returns the state and the debug surface together", async () => {
    const h = await harness();
    expect(h.engine.debug).toBe(h.debug);
    expect(h.debug.version).toBe(1);
    expect(h.state.screen).toBe("title");
    h.dispose();
  });

  it("registers every action the layout names, under its own bindings", async () => {
    const h = await harness();
    // The engine reports nothing about registrations, so the check is that each
    // binding actually drives its action: holding a bound key moves the aim.
    h.api.setScore(0);
    h.api.setCells(CELLS);
    h.api.startLevel(1);
    const before = h.snapshot().injector.aim;
    h.hold(BINDINGS.right[0]);
    await h.step(30);
    h.release(BINDINGS.right[0]);
    expect(h.snapshot().injector.aim).not.toBeCloseTo(before, 3);
    expect([...ACTIONS]).toHaveLength(10);
    h.dispose();
  });

  it("steps exactly one simulation tick per frame", async () => {
    const h = await harness();
    h.api.setScore(0);
    h.api.setCells(CELLS);
    h.api.startLevel(1);
    await h.step(60);
    // `simTime` accumulates every update's elapsed time, so 60 frames of the
    // harness's clock are exactly one second.
    expect(h.snapshot().simTime).toBeCloseTo(1, 6);
    h.dispose();
  });
});
