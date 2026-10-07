// The runtime, driven over a toy game.
//
// Deliberately NOT over Meltdown: what is measured here is the layer BENEATH the
// game — the frame loop and the delta it measures, the canvas fit and its
// transform, the wiring of the keyboard, the pointer and the overlay, and above
// all the manual clock `specs/instrumentation.md` builds `setAutoStep` and
// `advance` on. A toy game that writes down what it was handed turns each of
// those into a direct assertion rather than an inference from a Mote's position.
//
// Meltdown over this runtime is `src/game.test.ts`.

import { createCanvas, type SKRSContext2D } from "@napi-rs/canvas";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  MAX_FRAME_SECONDS,
  createRuntime,
  type Game,
  type Runtime,
} from "./runtime";
import type { PointerSample } from "./pointer";
import type { Surface } from "./viewport";

const STAGE_W = 1280;
const STAGE_H = 720;

/** What the toy game records about every frame the runtime gave it. */
interface ToyState {
  deltas: number[];
  renders: number;
  /** The transform the render context carried, as `[scale, offsetX, offsetY]`. */
  transforms: [number, number, number][];
  /** Whether `pause` edged on each frame. */
  pressed: boolean[];
  /** The pointer as each update read it. */
  pointers: { x: number; y: number; down: boolean }[];
  /** Every pointer event the runtime resolved, in order. */
  samples: PointerSample[];
}

/** A game that does nothing but write down what the runtime handed it. */
const toy: Game<ToyState> = {
  initialize(api) {
    api.input.register("pause", ["KeyP"]);
    api.audio.define("blip", { wave: "square", freq: 400, durationMs: 10 });
    const state: ToyState = {
      deltas: [],
      renders: 0,
      transforms: [],
      pressed: [],
      pointers: [],
      samples: [],
    };
    api.diagnostics.register("frames", () => state.deltas.length);
    return state;
  },
  update(state, api, dt) {
    state.deltas.push(dt);
    state.pressed.push(api.input.pressed("pause"));
    state.pointers.push({ ...api.input.pointer() });
  },
  render(state, api) {
    state.renders += 1;
    const t = (api.ctx as unknown as SKRSContext2D).getTransform();
    state.transforms.push([t.a, t.e, t.f]);
    // Painted, so a pixel read can tell a rendered frame from a bare clear.
    api.ctx.fillStyle = "#ff0000";
    api.ctx.fillRect(0, 0, 40, 40);
  },
  pointer(state, sample) {
    state.samples.push(sample);
  },
};

/** A `KeyboardEvent`-shaped event: the runtime reads `code` and `repeat`. */
class KeyEvent extends Event {
  readonly code: string;
  readonly repeat = false;

  constructor(type: "keydown" | "keyup", code: string) {
    super(type);
    this.code = code;
  }
}

/** A `PointerEvent`-shaped event: the runtime reads the client position. */
class PointEvent extends Event {
  readonly clientX: number;
  readonly clientY: number;
  readonly pointerId = 1;
  readonly button = 0;

  constructor(type: string, clientX: number, clientY: number) {
    super(type);
    this.clientX = clientX;
    this.clientY = clientY;
  }
}

// ---- A frame callback the test drives itself ----------------------------

let pending: ((atMs: number) => void) | null = null;
let originalRaf: unknown;
let originalCaf: unknown;

const globals = globalThis as unknown as Record<string, unknown>;

/** Run the frame the runtime asked for, as if the browser had repainted. */
function repaint(atMs: number): void {
  const callback = pending;
  pending = null;
  callback?.(atMs);
}

// ---- The harness --------------------------------------------------------

interface Harness {
  runtime: Runtime<ToyState>;
  state: ToyState;
  ctx: SKRSContext2D;
  events: EventTarget;
  /** The element's laid-out size and origin, which a test may change mid-run. */
  size: {
    cssWidth: number;
    cssHeight: number;
    dpr: number;
    left: number;
    top: number;
  };
  canvas: { width: number; height: number };
  pixel(x: number, y: number): [number, number, number, number];
  dispose(): void;
}

function harness(): Harness {
  const canvas = createCanvas(STAGE_W, STAGE_H);
  const ctx = canvas.getContext("2d");
  const element = Object.assign(canvas, {
    getContext: () => ctx,
  }) as unknown as HTMLCanvasElement;

  const size = {
    cssWidth: STAGE_W,
    cssHeight: STAGE_H,
    dpr: 1,
    left: 0,
    top: 0,
  };
  const events = new EventTarget();
  const surface: Surface = {
    cssWidth: () => size.cssWidth,
    cssHeight: () => size.cssHeight,
    dpr: () => size.dpr,
    origin: () => ({ left: size.left, top: size.top }),
    events: () => events,
  };

  const runtime = createRuntime<ToyState>({
    canvas: element,
    width: STAGE_W,
    height: STAGE_H,
    game: toy,
    background: "#05070b",
    surface,
    // Node has no Web Audio; the bus stays silent and takes no part in a frame.
    audioContext: () => null,
  });

  return {
    runtime,
    state: runtime.initialize(),
    ctx,
    events,
    size,
    canvas: canvas as unknown as { width: number; height: number },
    pixel: (x, y) => {
      const { data } = ctx.getImageData(x, y, 1, 1);
      return [data[0], data[1], data[2], data[3]];
    },
    dispose: () => runtime.destroy(),
  };
}

let h: Harness;

beforeEach(() => {
  originalRaf = globals["requestAnimationFrame"];
  originalCaf = globals["cancelAnimationFrame"];
  pending = null;
  globals["requestAnimationFrame"] = (callback: (atMs: number) => void) => {
    pending = callback;
    return 1;
  };
  globals["cancelAnimationFrame"] = () => {
    pending = null;
  };
  h = harness();
});

afterEach(() => {
  h.dispose();
  globals["requestAnimationFrame"] = originalRaf;
  globals["cancelAnimationFrame"] = originalCaf;
});

// ---- Standing up --------------------------------------------------------

describe("initializing", () => {
  it("refuses to hand out a state before the game has built one", () => {
    const bare = createRuntime<ToyState>({
      canvas: h.canvas as unknown as HTMLCanvasElement,
      width: STAGE_W,
      height: STAGE_H,
      game: toy,
      background: "#000",
      surface: {
        cssWidth: () => STAGE_W,
        cssHeight: () => STAGE_H,
        dpr: () => 1,
        origin: () => ({ left: 0, top: 0 }),
        events: () => new EventTarget(),
      },
      audioContext: () => null,
    });
    expect(() => bare.state).toThrow(/has not initialized/);
    bare.destroy();
  });

  it("runs no frame, so the state is complete before anything observes it", () => {
    expect(h.state.deltas).toEqual([]);
    expect(h.state.renders).toBe(0);
    expect(h.runtime.frame()).toEqual({ count: 0, time: 0, dt: 0 });
  });

  it("initializes once, however many times it is asked", () => {
    expect(h.runtime.initialize()).toBe(h.state);
  });

  it("hands out the live state, not a copy", () => {
    expect(h.runtime.state).toBe(h.state);
  });

  it("starts on the wall clock, which is how a build is played", () => {
    expect(h.runtime.autoStep()).toBe(true);
  });
});

// ---- The manual clock ---------------------------------------------------

describe("advance", () => {
  it("runs one whole frame of the stated length by default", () => {
    h.runtime.advance(0.25);
    expect(h.state.deltas).toEqual([0.25]);
    expect(h.state.renders).toBe(1);
  });

  it("divides the interval into exactly the frames asked for", () => {
    h.runtime.advance(1, 60);
    expect(h.state.deltas).toHaveLength(60);
    for (const dt of h.state.deltas) expect(dt).toBeCloseTo(1 / 60, 12);
    expect(h.runtime.frame().count).toBe(60);
    expect(h.runtime.frame().time).toBeCloseTo(1, 9);
  });

  it("covers the same interval however it is divided", () => {
    h.runtime.advance(1, 1);
    const single = h.runtime.frame().time;
    h.runtime.advance(1, 60);
    expect(h.runtime.frame().time - single).toBeCloseTo(single, 9);
  });

  it("renders every frame, so the canvas reflects the result", () => {
    h.runtime.advance(0.5, 10);
    expect(h.state.renders).toBe(10);
  });

  it("reports the last delta it ran, not the interval it was asked for", () => {
    h.runtime.advance(1, 4);
    expect(h.runtime.frame().dt).toBeCloseTo(0.25, 12);
  });

  it("is not clamped: an interval asked for is an interval run", () => {
    // The clamp guards the WALL clock against a backgrounded tab. A caller that
    // asks for a whole second in one frame means it.
    h.runtime.advance(1, 1);
    expect(h.state.deltas[0]).toBe(1);
    expect(h.state.deltas[0]).toBeGreaterThan(MAX_FRAME_SECONDS);
  });

  it("refuses an interval or a frame count it cannot honor", () => {
    expect(() => h.runtime.advance(-1)).toThrow(RangeError);
    expect(() => h.runtime.advance(Number.NaN)).toThrow(RangeError);
    expect(() => h.runtime.advance(Number.POSITIVE_INFINITY)).toThrow(
      RangeError,
    );
    expect(() => h.runtime.advance(1, 0)).toThrow(RangeError);
    expect(() => h.runtime.advance(1, 1.5)).toThrow(RangeError);
    expect(() => h.runtime.advance(1, -2)).toThrow(RangeError);
    expect(h.state.deltas).toEqual([]);
  });

  it("runs nothing before the game has a state", () => {
    const bare = createRuntime<ToyState>({
      canvas: h.canvas as unknown as HTMLCanvasElement,
      width: STAGE_W,
      height: STAGE_H,
      game: toy,
      background: "#000",
      surface: {
        cssWidth: () => STAGE_W,
        cssHeight: () => STAGE_H,
        dpr: () => 1,
        origin: () => ({ left: 0, top: 0 }),
        events: () => new EventTarget(),
      },
      audioContext: () => null,
    });
    expect(() => bare.advance(1, 10)).not.toThrow();
    expect(bare.frame().count).toBe(0);
    bare.destroy();
  });
});

describe("setAutoStep", () => {
  it("stops the loop advancing the simulation from the wall clock", () => {
    h.runtime.setAutoStep(false);
    expect(h.runtime.autoStep()).toBe(false);
    h.runtime.start();
    repaint(0);
    repaint(1000);
    repaint(2000);
    expect(h.state.deltas).toEqual([]);
    expect(h.runtime.frame().time).toBe(0);
  });

  it("keeps drawing, so the canvas shows the last frame's state", () => {
    h.runtime.advance(1 / 60);
    h.runtime.setAutoStep(false);
    h.runtime.start();
    repaint(0);
    repaint(1000);
    expect(h.state.renders).toBe(3);
    expect(h.state.deltas).toHaveLength(1);
  });

  it("leaves advance as the only thing that moves the game on", () => {
    h.runtime.setAutoStep(false);
    h.runtime.start();
    repaint(0);
    h.runtime.advance(0.5, 2);
    repaint(5000);
    expect(h.state.deltas).toEqual([0.25, 0.25]);
  });

  it("gives the clock back without paying for the time it was off it", () => {
    h.runtime.setAutoStep(false);
    h.runtime.start();
    repaint(0);
    repaint(10_000); // ten seconds pass with the game off the clock
    h.runtime.setAutoStep(true);
    repaint(10_016);
    expect(h.state.deltas).toHaveLength(1);
    expect(h.state.deltas[0]).toBeCloseTo(0.016, 9);
  });

  it("presents nothing before the game has a state", () => {
    const bare = createRuntime<ToyState>({
      canvas: h.canvas as unknown as HTMLCanvasElement,
      width: STAGE_W,
      height: STAGE_H,
      game: toy,
      background: "#000",
      surface: {
        cssWidth: () => STAGE_W,
        cssHeight: () => STAGE_H,
        dpr: () => 1,
        origin: () => ({ left: 0, top: 0 }),
        events: () => new EventTarget(),
      },
      audioContext: () => null,
    });
    bare.setAutoStep(false);
    bare.start();
    expect(() => repaint(0)).not.toThrow();
    bare.destroy();
  });
});

// ---- The frame loop -----------------------------------------------------

describe("the frame loop", () => {
  it("measures each frame's delta in seconds", () => {
    h.runtime.start();
    repaint(1000);
    repaint(1016);
    repaint(1032);
    expect(h.state.deltas).toEqual([0, 0.016, 0.016]);
  });

  it("is worth nothing on its first tick: there is no earlier frame", () => {
    h.runtime.start();
    repaint(5000);
    expect(h.state.deltas).toEqual([0]);
  });

  it("clamps the gap a backgrounded tab comes back with", () => {
    h.runtime.start();
    repaint(0);
    repaint(30_000);
    expect(h.state.deltas[1]).toBe(MAX_FRAME_SECONDS);
  });

  it("never runs time backwards on a non-monotonic timestamp", () => {
    h.runtime.start();
    repaint(1000);
    repaint(900);
    expect(h.state.deltas[1]).toBe(0);
  });

  it("updates before it renders, every frame", () => {
    h.runtime.advance(1 / 60, 3);
    expect(h.state.deltas).toHaveLength(3);
    expect(h.state.renders).toBe(3);
  });

  it("keeps pumping after a frame throws, rather than freezing the game", () => {
    const thrower = { count: 0 };
    const original = toy.update;
    toy.update = (state, api, dt) => {
      thrower.count += 1;
      original(state, api, dt);
      if (thrower.count === 2) throw new Error("one bad frame");
    };
    try {
      h.runtime.start();
      repaint(0);
      expect(() => repaint(16)).toThrow("one bad frame");
      repaint(32);
      expect(thrower.count).toBe(3);
    } finally {
      toy.update = original;
    }
  });

  it("starts once, however many times it is asked", () => {
    h.runtime.start();
    h.runtime.start();
    repaint(0);
    repaint(16);
    expect(h.state.deltas).toEqual([0, 0.016]);
  });

  it("stops when asked, and starts again from a fresh measurement", () => {
    h.runtime.start();
    repaint(0);
    repaint(16);
    h.runtime.stop();
    expect(pending).toBeNull();

    h.runtime.start();
    repaint(9000);
    expect(h.state.deltas).toEqual([0, 0.016, 0]);
  });

  it("says so plainly where there are no frames to ask for", () => {
    globals["requestAnimationFrame"] = undefined;
    expect(() => h.runtime.start()).toThrow(/advance\(\)/);
  });
});

// ---- The canvas ---------------------------------------------------------

describe("the canvas fit", () => {
  it("sizes the backing store to the element at its pixel density", () => {
    h.size.cssWidth = 640;
    h.size.cssHeight = 360;
    h.size.dpr = 2;
    h.runtime.advance(1 / 60);
    expect(h.canvas.width).toBe(1280);
    expect(h.canvas.height).toBe(720);
  });

  it("re-derives the fit every frame, so no resize handler is needed", () => {
    h.runtime.advance(1 / 60);
    expect(h.runtime.viewport().scale).toBe(1);

    h.size.cssWidth = 640;
    h.size.cssHeight = 360;
    h.runtime.advance(1 / 60);
    expect(h.runtime.viewport().scale).toBe(0.5);
    expect(h.canvas.width).toBe(640);
  });

  it("hands the game a context already carrying the logical transform", () => {
    h.size.cssWidth = 1280;
    h.size.cssHeight = 900; // taller than the stage, so it is letterboxed
    h.runtime.advance(1 / 60);
    const view = h.runtime.viewport();
    expect(view.offsetY).toBeGreaterThan(0);
    expect(h.state.transforms[0]).toEqual([
      view.scale,
      view.offsetX,
      view.offsetY,
    ]);
  });

  it("clears the whole canvas to the background before the game draws", () => {
    h.runtime.advance(1 / 60);
    // The toy game paints red over the top-left corner; the rest is background.
    expect(h.pixel(10, 10)).toEqual([255, 0, 0, 255]);
    expect(h.pixel(900, 500)).toEqual([5, 7, 11, 255]);
  });
});

// ---- Input, the pointer and the overlay ---------------------------------

describe("wiring", () => {
  it("delivers a key edge to the game as its named action, once", () => {
    h.events.dispatchEvent(new KeyEvent("keydown", "KeyP"));
    h.runtime.advance(1 / 60, 2);
    expect(h.state.pressed).toEqual([true, false]);
  });

  it("discards an edge nothing consumed at the end of its frame", () => {
    // A game that skips the read on its first frame. The press must not be
    // waiting for it on the second: an edge is news for exactly one frame.
    const seen: boolean[] = [];
    const late: Game<ToyState> = {
      ...toy,
      update(state, api, dt) {
        state.deltas.push(dt);
        if (state.deltas.length > 1) seen.push(api.input.pressed("pause"));
      },
    };
    const other = createRuntime<ToyState>({
      canvas: h.canvas as unknown as HTMLCanvasElement,
      width: STAGE_W,
      height: STAGE_H,
      game: late,
      background: "#000",
      surface: {
        cssWidth: () => STAGE_W,
        cssHeight: () => STAGE_H,
        dpr: () => 1,
        origin: () => ({ left: 0, top: 0 }),
        events: () => h.events,
      },
      audioContext: () => null,
    });
    other.initialize();
    h.events.dispatchEvent(new KeyEvent("keydown", "KeyP"));
    other.advance(1 / 60, 2);
    expect(seen).toEqual([false]);
    other.destroy();
  });

  it("keeps an edge armed between advances while off the clock", () => {
    h.runtime.setAutoStep(false);
    h.runtime.start();
    h.events.dispatchEvent(new KeyEvent("keydown", "KeyP"));
    repaint(0);
    repaint(16); // repaints must not eat the press
    h.runtime.advance(1 / 60);
    expect(h.state.pressed).toEqual([true]);
  });

  it("ignores a key event carrying no code", () => {
    h.events.dispatchEvent(new Event("keydown"));
    h.runtime.advance(1 / 60);
    expect(h.state.pressed).toEqual([false]);
  });

  it("resolves a page pointer event in logical stage units", () => {
    h.runtime.advance(1 / 60);
    h.events.dispatchEvent(new PointEvent("pointerdown", 400, 300));
    expect(h.state.samples).toEqual([
      { type: "down", x: 400, y: 300, silent: false },
    ]);
    h.runtime.advance(1 / 60);
    expect(h.state.pointers[1]).toEqual({ x: 400, y: 300, down: true });
  });

  it("undoes the letterbox and the density when it maps a press", () => {
    h.size.cssWidth = 640;
    h.size.cssHeight = 450; // taller than the stage: letterboxed top and bottom
    h.size.left = 12;
    h.size.top = 20;
    h.runtime.advance(1 / 60);
    const view = h.runtime.viewport();
    // The stage's own centre, expressed back in client coordinates.
    const clientX =
      12 + (view.offsetX + view.scale * (STAGE_W / 2)) / h.size.dpr;
    const clientY =
      20 + (view.offsetY + view.scale * (STAGE_H / 2)) / h.size.dpr;
    h.events.dispatchEvent(new PointEvent("pointermove", clientX, clientY));
    const sample = h.state.samples[h.state.samples.length - 1];
    expect(sample?.x).toBeCloseTo(STAGE_W / 2, 6);
    expect(sample?.y).toBeCloseTo(STAGE_H / 2, 6);
  });

  it("reports a pointer event from code, silently, down the same path", () => {
    h.runtime.reportPointer("down", 100, 200);
    h.runtime.reportPointer("up", 100, 200, true);
    expect(h.state.samples).toEqual([
      { type: "down", x: 100, y: 200, silent: false },
      { type: "up", x: 100, y: 200, silent: true },
    ]);
  });

  it("shows and hides the overlay on the backtick key", () => {
    h.runtime.advance(1 / 60);
    const plain = h.pixel(4, 4);

    h.events.dispatchEvent(new KeyEvent("keydown", "Backquote"));
    h.runtime.advance(1 / 60);
    expect(h.pixel(4, 4)).not.toEqual(plain);

    h.events.dispatchEvent(new KeyEvent("keydown", "Backquote"));
    h.runtime.advance(1 / 60);
    expect(h.pixel(4, 4)).toEqual(plain);
  });

  it("ignores every key but the backtick for the overlay", () => {
    h.runtime.advance(1 / 60);
    const plain = h.pixel(4, 4);
    h.events.dispatchEvent(new KeyEvent("keydown", "KeyP"));
    h.runtime.advance(1 / 60);
    expect(h.pixel(4, 4)).toEqual(plain);
  });
});

describe("the audio bus", () => {
  it("carries the mute bit the game reads and the panel toggles", () => {
    expect(h.runtime.muted()).toBe(false);
    h.runtime.setMuted(true);
    expect(h.runtime.muted()).toBe(true);
    h.runtime.setMuted(false);
    expect(h.runtime.muted()).toBe(false);
  });
});

describe("destroy", () => {
  it("halts the loop and stops listening", () => {
    h.runtime.start();
    repaint(0);
    h.runtime.destroy();
    expect(pending).toBeNull();

    h.events.dispatchEvent(new KeyEvent("keydown", "KeyP"));
    const ran = h.state.deltas.length;
    h.runtime.advance(1 / 60);
    expect(h.state.deltas).toHaveLength(ran);
  });

  it("stops resolving pointer events", () => {
    h.runtime.destroy();
    h.runtime.reportPointer("down", 10, 10);
    expect(h.state.samples).toEqual([]);
  });

  it("is idempotent, because teardown races", () => {
    h.runtime.destroy();
    expect(() => h.runtime.destroy()).not.toThrow();
  });

  it("refuses to be stood back up, rather than running on dead listeners", () => {
    h.runtime.destroy();
    expect(() => h.runtime.initialize()).toThrow(/destroyed/);
  });

  it("declines to start once destroyed", () => {
    h.runtime.destroy();
    h.runtime.start();
    expect(pending).toBeNull();
  });
});
