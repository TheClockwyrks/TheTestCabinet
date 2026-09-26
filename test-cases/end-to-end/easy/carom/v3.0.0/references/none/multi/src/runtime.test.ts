// The runtime, driven over a toy game.
//
// Deliberately not over Carom: what is checked here is the layer BENEATH the
// game — the frame loop and the delta it measures, the canvas fit, the wiring of
// the keyboard and the overlay, and above all the manual clock the debug surface
// is built on. A toy game that records what it was handed makes each of those a
// direct assertion instead of an inference from the ball's position.
//
// Carom over this runtime is `src/game.test.ts`.

import { createCanvas, type SKRSContext2D } from "@napi-rs/canvas";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  MAX_FRAME_SECONDS,
  createRuntime,
  type Game,
  type Runtime,
  type UpdateApi,
} from "./runtime";
import type { Surface } from "./viewport";

const FIELD_W = 1280;
const FIELD_H = 720;

/** What the toy game records about every frame the runtime gave it. */
interface ToyState {
  deltas: number[];
  renders: number;
  /** The transform the render context carried, as `[scale, offsetX, offsetY]`. */
  transforms: [number, number, number][];
  /** Whether `p1-up` was held on each frame, and whether it edged. */
  held: number[];
  pressed: boolean[];
  cues: string[];
}

/** A game that does nothing but write down what the runtime handed it. */
const toy: Game<ToyState> = {
  initialize(api) {
    api.input.register("p1-up", ["KeyW"]);
    api.audio.define("blip", { freq: 400, durationMs: 10 });
    const state: ToyState = {
      deltas: [],
      renders: 0,
      transforms: [],
      held: [],
      pressed: [],
      cues: [],
    };
    api.diagnostics.register("frames", () => state.deltas.length);
    return state;
  },
  update(state, api: UpdateApi, dt) {
    state.deltas.push(dt);
    state.held.push(api.input.value("p1-up"));
    state.pressed.push(api.input.pressed("p1-up"));
  },
  render(state, api) {
    state.renders += 1;
    const t = (api.ctx as unknown as SKRSContext2D).getTransform();
    state.transforms.push([t.a, t.e, t.f]);
    // Painted so a pixel read can tell a rendered frame from a bare clear.
    api.ctx.fillStyle = "#ff0000";
    api.ctx.fillRect(0, 0, 40, 40);
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
  /** The element's laid-out size, which a test may change mid-run. */
  size: { cssWidth: number; cssHeight: number; dpr: number };
  canvas: { width: number; height: number };
  pixel(x: number, y: number): [number, number, number, number];
  dispose(): void;
}

function harness(): Harness {
  const canvas = createCanvas(FIELD_W, FIELD_H);
  const ctx = canvas.getContext("2d");
  const element = Object.assign(canvas, {
    getContext: () => ctx,
  }) as unknown as HTMLCanvasElement;

  const size = { cssWidth: FIELD_W, cssHeight: FIELD_H, dpr: 1 };
  const events = new EventTarget();
  const surface: Surface = {
    cssWidth: () => size.cssWidth,
    cssHeight: () => size.cssHeight,
    dpr: () => size.dpr,
    origin: () => ({ x: 0, y: 0 }),
    events: () => events,
  };

  const runtime = createRuntime<ToyState>({
    canvas: element,
    width: FIELD_W,
    height: FIELD_H,
    game: toy,
    background: "#0b0e14",
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
      width: FIELD_W,
      height: FIELD_H,
      game: toy,
      background: "#000",
      surface: {
        cssWidth: () => FIELD_W,
        cssHeight: () => FIELD_H,
        dpr: () => 1,
        origin: () => ({ x: 0, y: 0 }),
        events: () => new EventTarget(),
      },
    });
    expect(() => bare.state).toThrow(/has not initialized/);
    bare.destroy();
  });

  it("runs no frame: the state is complete before anything can observe it", () => {
    expect(h.state.deltas).toEqual([]);
    expect(h.state.renders).toBe(0);
    expect(h.runtime.frame()).toEqual({ count: 0, time: 0, dt: 0 });
  });

  it("initializes once, however many times it is asked", () => {
    expect(h.runtime.initialize()).toBe(h.state);
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

  it("is not clamped: an interval asked for is an interval run", () => {
    // The clamp guards the WALL clock against a backgrounded tab. A caller that
    // asks for a second in one frame means it.
    h.runtime.advance(1, 1);
    expect(h.state.deltas[0]).toBe(1);
    expect(h.state.deltas[0]).toBeGreaterThan(MAX_FRAME_SECONDS);
  });

  it("refuses an interval or a frame count it cannot honor", () => {
    expect(() => h.runtime.advance(-1)).toThrow(RangeError);
    expect(() => h.runtime.advance(Number.NaN)).toThrow(RangeError);
    expect(() => h.runtime.advance(1, 0)).toThrow(RangeError);
    expect(() => h.runtime.advance(1, 1.5)).toThrow(RangeError);
    expect(() => h.runtime.advance(1, -2)).toThrow(RangeError);
    expect(h.state.deltas).toEqual([]);
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
    h.size.cssHeight = 900; // taller than 16:9, so the field is letterboxed
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
    expect(h.pixel(600, 400)).toEqual([11, 14, 20, 255]);
  });
});

// ---- Input and the overlay ----------------------------------------------

describe("wiring", () => {
  it("delivers a held key to the game as its named action", () => {
    h.events.dispatchEvent(new KeyEvent("keydown", "KeyW"));
    h.runtime.advance(1 / 60, 2);
    expect(h.state.held).toEqual([1, 1]);
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
        if (state.deltas.length > 1) seen.push(api.input.pressed("p1-up"));
      },
    };
    const other = createRuntime<ToyState>({
      canvas: h.canvas as unknown as HTMLCanvasElement,
      width: FIELD_W,
      height: FIELD_H,
      game: late,
      background: "#000",
      surface: {
        cssWidth: () => FIELD_W,
        cssHeight: () => FIELD_H,
        dpr: () => 1,
        origin: () => ({ x: 0, y: 0 }),
        events: () => h.events,
      },
    });
    other.initialize();
    h.events.dispatchEvent(new KeyEvent("keydown", "KeyW"));
    other.advance(1 / 60, 2);
    expect(seen).toEqual([false]);
    other.destroy();
  });

  it("keeps an edge armed between advances while off the clock", () => {
    h.runtime.setAutoStep(false);
    h.runtime.start();
    h.events.dispatchEvent(new KeyEvent("keydown", "KeyW"));
    repaint(0);
    repaint(16); // repaints must not eat the press
    h.runtime.advance(1 / 60);
    expect(h.state.pressed).toEqual([true]);
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

  it("ignores a key event carrying no code", () => {
    h.events.dispatchEvent(new Event("keydown"));
    h.runtime.advance(1 / 60);
    expect(h.state.held).toEqual([0]);
  });
});

describe("destroy", () => {
  it("halts the loop and stops listening", () => {
    h.runtime.start();
    repaint(0);
    h.runtime.destroy();
    expect(pending).toBeNull();

    h.events.dispatchEvent(new KeyEvent("keydown", "KeyW"));
    const ran = h.state.deltas.length;
    h.runtime.advance(1 / 60);
    expect(h.state.deltas).toHaveLength(ran);
  });

  it("is idempotent, because teardown races", () => {
    h.runtime.destroy();
    expect(() => h.runtime.destroy()).not.toThrow();
  });

  it("refuses to be stood back up, rather than running on dead listeners", () => {
    h.runtime.destroy();
    expect(() => h.runtime.initialize()).toThrow(/destroyed/);
  });
});
