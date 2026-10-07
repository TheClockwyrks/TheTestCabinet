// The runtime, driven over a toy game.
//
// Deliberately not over Floe: what is checked here is the layer BENEATH the game
// — the frame loop and the fixed-tick accumulator, the canvas fit, the wiring of
// the keyboard, the audio bus and the overlay, and above all the manual clock
// `specs/instrumentation.md`'s two clock operations rest on. A toy game that
// writes down what it was handed makes each of those a direct assertion instead
// of an inference from the critter's position.
//
// Floe over this runtime is `src/game.test.ts`.

import { createCanvas, type SKRSContext2D } from "@napi-rs/canvas";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { STAGE_H, STAGE_W, TICK_DT } from "./constants";
import {
  MAX_FRAME_SECONDS,
  createRuntime,
  type Game,
  type Runtime,
  type UpdateApi,
} from "./runtime";
import type { Surface } from "./viewport";

/** What the toy game writes down about every tick and frame it was given. */
interface ToyState {
  deltas: number[];
  renders: number;
  /** The transform the render context carried, as `[scale, offsetX, offsetY]`. */
  transforms: [number, number, number][];
  alphas: number[];
  held: number[];
  pressed: boolean[];
}

/** A game that does nothing but write down what the runtime handed it. */
const toy: Game<ToyState> = {
  initialize(api) {
    api.input.register("hop", ["KeyW"]);
    api.audio.define("blip", { freq: 400, durationMs: 10 });
    const state: ToyState = {
      deltas: [],
      renders: 0,
      transforms: [],
      alphas: [],
      held: [],
      pressed: [],
    };
    api.diagnostics.register("ticks", () => state.deltas.length);
    return state;
  },
  update(state, api: UpdateApi, dt) {
    state.deltas.push(dt);
    state.held.push(api.input.value("hop"));
    state.pressed.push(api.input.pressed("hop"));
  },
  render(state, api) {
    state.renders += 1;
    state.alphas.push(api.alpha);
    const transform = (api.ctx as unknown as SKRSContext2D).getTransform();
    state.transforms.push([transform.a, transform.e, transform.f]);
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

/** Run the frame the runtime asked for, as if the display had repainted. */
function repaint(atMs: number): void {
  const callback = pending;
  pending = null;
  callback?.(atMs);
}

interface Harness {
  runtime: Runtime<ToyState>;
  state: ToyState;
  ctx: SKRSContext2D;
  events: EventTarget;
  size: { cssWidth: number; cssHeight: number; dpr: number };
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

  const size = { cssWidth: STAGE_W, cssHeight: STAGE_H, dpr: 1 };
  const events = new EventTarget();
  const surface: Surface = {
    cssWidth: () => size.cssWidth,
    cssHeight: () => size.cssHeight,
    dpr: () => size.dpr,
    events: () => events,
  };

  const runtime = createRuntime<ToyState>({
    canvas: element,
    width: STAGE_W,
    height: STAGE_H,
    game: toy,
    background: "#061019",
    surface,
    // Node has no Web Audio; the bus stays silent and takes no part in a tick.
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

describe("standing up", () => {
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
        events: () => new EventTarget(),
      },
      audioContext: () => null,
    });
    expect(() => bare.state).toThrow(/has not initialized/);
    bare.destroy();
  });

  it("runs no tick: the state is complete before anything can observe it", () => {
    expect(h.state.deltas).toEqual([]);
    expect(h.state.renders).toBe(0);
    expect(h.runtime.tick()).toEqual({ count: 0, time: 0, alpha: 0 });
    expect(h.runtime.state).toBe(h.state);
  });

  it("initializes once, however many times it is asked", () => {
    expect(h.runtime.initialize()).toBe(h.state);
  });

  it("starts on the wall clock, which is how a build is played", () => {
    expect(h.runtime.autoStep()).toBe(true);
  });

  it("takes no further work once it has been destroyed", () => {
    h.runtime.destroy();
    h.runtime.destroy();
    expect(() => h.runtime.initialize()).toThrow(/destroyed/);
  });
});

describe("the fixed tick", () => {
  it("runs the whole ticks a frame's elapsed time completes, and carries the rest", () => {
    // Twenty milliseconds is two and two fifths of a tick: two ticks run and
    // the remaining two fifths is carried into the next frame.
    h.runtime.start();
    repaint(0);
    repaint(20);
    expect(h.state.deltas).toHaveLength(2);
    for (const dt of h.state.deltas) expect(dt).toBe(TICK_DT);
    expect(h.runtime.tick().alpha).toBeCloseTo(0.4, 6);

    repaint(40);
    expect(h.state.deltas).toHaveLength(4);
    expect(h.runtime.tick().alpha).toBeCloseTo(0.8, 6);
  });

  it("runs the same ticks over an interval however it is divided into frames", () => {
    h.runtime.start();
    repaint(0);
    repaint(1000);
    const inOne = h.state.deltas.length;

    const many = harness();
    many.runtime.start();
    for (let frame = 0; frame <= 60; frame += 1) repaint((frame * 1000) / 60);
    // Both cover a second of wall time; the clamp caps the single leap.
    expect(many.state.deltas.length).toBeGreaterThan(inOne);
    expect(many.state.deltas.length).toBe(120);
    many.dispose();
  });

  it("counts the ticks it has run and the game time they cover", () => {
    h.runtime.advance(120);
    expect(h.runtime.tick().count).toBe(120);
    expect(h.runtime.tick().time).toBeCloseTo(1, 9);
  });

  it("is worth nothing on the first frame, which has no earlier frame to measure from", () => {
    h.runtime.start();
    repaint(5000);
    expect(h.state.deltas).toEqual([]);
    expect(h.state.renders).toBe(1);
  });

  it("clamps a frame a backgrounded tab left behind", () => {
    h.runtime.start();
    repaint(0);
    repaint(60_000);
    expect(h.state.deltas.length).toBe(Math.floor(MAX_FRAME_SECONDS / TICK_DT));
  });

  it("ignores a frame that arrives no later than the one before it", () => {
    h.runtime.start();
    repaint(1000);
    repaint(1000);
    repaint(900);
    expect(h.state.deltas).toEqual([]);
  });
});

describe("the clock the debug surface reaches", () => {
  it("runs exactly the ticks it is asked for, each of the fixed length", () => {
    h.runtime.advance(3);
    expect(h.state.deltas).toEqual([TICK_DT, TICK_DT, TICK_DT]);
  });

  it("runs nothing for no ticks", () => {
    h.runtime.advance(0);
    expect(h.state.deltas).toEqual([]);
  });

  it("refuses a count it cannot honour", () => {
    expect(() => h.runtime.advance(-1)).toThrow(RangeError);
    expect(() => h.runtime.advance(1.5)).toThrow(RangeError);
    expect(() => h.runtime.advance(Number.NaN)).toThrow(RangeError);
    expect(h.state.deltas).toEqual([]);
  });

  it("draws what the ticks produced, so a driven scenario can be looked at", () => {
    h.runtime.advance(1);
    expect(h.state.renders).toBe(1);
    expect(h.pixel(1, 1)).toEqual([255, 0, 0, 255]);
  });

  it("stops the loop advancing the simulation, and keeps it drawing", () => {
    h.runtime.setAutoStep(false);
    expect(h.runtime.autoStep()).toBe(false);
    h.runtime.start();
    repaint(0);
    repaint(1000);
    repaint(2000);
    expect(h.state.deltas).toEqual([]);
    expect(h.state.renders).toBe(3);
    expect(h.runtime.tick().time).toBe(0);
  });

  it("leaves advance the only thing that moves the game on", () => {
    h.runtime.setAutoStep(false);
    h.runtime.start();
    repaint(0);
    h.runtime.advance(2);
    repaint(5000);
    expect(h.state.deltas).toEqual([TICK_DT, TICK_DT]);
  });

  it("gives the clock back without paying for the time it was off it", () => {
    h.runtime.setAutoStep(false);
    h.runtime.start();
    repaint(0);
    repaint(10_000);
    h.runtime.setAutoStep(true);
    repaint(10_016);
    expect(h.state.deltas.length).toBe(1);
  });
});

describe("the frame loop", () => {
  it("keeps asking for frames while it runs, and stops when it is stopped", () => {
    h.runtime.start();
    repaint(0);
    expect(pending).not.toBeNull();
    h.runtime.stop();
    expect(pending).toBeNull();
    repaint(1000);
    expect(h.state.deltas).toEqual([]);
  });

  it("starts once, however many times it is asked", () => {
    h.runtime.start();
    h.runtime.start();
    repaint(0);
    repaint(16);
    expect(h.state.renders).toBe(2);
  });

  it("re-arms after a frame the game threw out of", () => {
    const angry = createRuntime<{ ticks: number }>({
      canvas: h.canvas as unknown as HTMLCanvasElement,
      width: STAGE_W,
      height: STAGE_H,
      background: "#000",
      surface: {
        cssWidth: () => STAGE_W,
        cssHeight: () => STAGE_H,
        dpr: () => 1,
        events: () => new EventTarget(),
      },
      audioContext: () => null,
      game: {
        initialize: () => ({ ticks: 0 }),
        update: (state) => {
          state.ticks += 1;
          if (state.ticks === 1) throw new Error("one bad tick");
        },
        render: () => undefined,
      },
    });
    angry.initialize();
    angry.start();
    repaint(0);
    expect(() => repaint(100)).toThrow(/one bad tick/);
    expect(pending).not.toBeNull();
    angry.destroy();
  });
});

describe("the canvas", () => {
  it("sizes the backing store to the element and installs the stage transform", () => {
    h.size.cssWidth = 640;
    h.size.cssHeight = 480;
    h.size.dpr = 2;
    h.runtime.advance(1);
    expect(h.canvas.width).toBe(1280);
    expect(h.canvas.height).toBe(960);
    const [scale, offsetX, offsetY] = h.state.transforms[0];
    expect(scale).toBeCloseTo((640 / STAGE_W) * 2, 9);
    expect(offsetX).toBeCloseTo(0, 6);
    expect(offsetY).toBeCloseTo((960 - STAGE_H * scale) / 2, 6);
  });

  it("re-derives the fit every frame, so a resize needs no listener", () => {
    h.runtime.advance(1);
    const before = h.runtime.viewport().scale;
    h.size.cssWidth = 320;
    h.size.cssHeight = 180;
    h.runtime.advance(1);
    expect(h.runtime.viewport().scale).toBeLessThan(before);
  });

  it("clears the whole canvas, letterbox bars included, to the background", () => {
    h.size.cssWidth = STAGE_W;
    h.size.cssHeight = 900;
    h.runtime.advance(1);
    // A bar above the stage carries the stage's own ground.
    expect(h.pixel(4, 4)).toEqual([6, 16, 25, 255]);
  });

  it("hands the render the fraction of the next tick already elapsed", () => {
    h.runtime.start();
    repaint(0);
    repaint(1000 / 240);
    const alpha = h.state.alphas[h.state.alphas.length - 1];
    expect(alpha).toBeGreaterThan(0);
    expect(alpha).toBeLessThan(1);
  });
});

describe("the wiring beneath the game", () => {
  it("gives the game the keys the page saw", () => {
    h.events.dispatchEvent(new KeyEvent("keydown", "KeyW"));
    h.runtime.advance(1);
    expect(h.state.held[0]).toBe(1);
    expect(h.state.pressed[0]).toBe(true);

    h.runtime.advance(1);
    expect(h.state.held[1]).toBe(1);
    expect(h.state.pressed[1]).toBe(false);

    h.events.dispatchEvent(new KeyEvent("keyup", "KeyW"));
    h.runtime.advance(1);
    expect(h.state.held[2]).toBe(0);
  });

  it("drops an edge nothing read at the tick's end", () => {
    const events = new EventTarget();
    const state = { reading: false, edges: [] as boolean[] };
    const forgetful = createRuntime<typeof state>({
      canvas: h.canvas as unknown as HTMLCanvasElement,
      width: STAGE_W,
      height: STAGE_H,
      background: "#000",
      surface: {
        cssWidth: () => STAGE_W,
        cssHeight: () => STAGE_H,
        dpr: () => 1,
        events: () => events,
      },
      audioContext: () => null,
      game: {
        initialize: (api) => {
          api.input.register("hop", ["KeyW"]);
          return state;
        },
        // Reads the edge only when the test asks it to, so a tick that read
        // nothing is a tick that left one armed.
        update: (value, api) => {
          if (value.reading) value.edges.push(api.input.pressed("hop"));
        },
        render: () => undefined,
      },
    });
    forgetful.initialize();
    events.dispatchEvent(new KeyEvent("keydown", "KeyW"));
    forgetful.advance(1);
    state.reading = true;
    forgetful.advance(1);
    expect(state.edges).toEqual([false]);
    forgetful.destroy();
  });

  it("stops listening once it is destroyed", () => {
    h.runtime.destroy();
    h.events.dispatchEvent(new KeyEvent("keydown", "KeyW"));
    expect(h.state.deltas).toEqual([]);
  });

  it("draws the overlay only once the backtick key has shown it", () => {
    h.runtime.advance(1);
    const plain = h.pixel(2, 2);
    h.events.dispatchEvent(new KeyEvent("keydown", "Backquote"));
    h.runtime.advance(1);
    expect(h.pixel(2, 2)).not.toEqual(plain);
    h.events.dispatchEvent(new KeyEvent("keydown", "Backquote"));
    h.runtime.advance(1);
    expect(h.pixel(2, 2)).toEqual(plain);
  });

  it("leaves a key that is not the overlay's alone", () => {
    h.runtime.advance(1);
    const plain = h.pixel(2, 2);
    h.events.dispatchEvent(new KeyEvent("keydown", "KeyW"));
    h.runtime.advance(1);
    expect(h.pixel(2, 2)).toEqual(plain);
  });
});
