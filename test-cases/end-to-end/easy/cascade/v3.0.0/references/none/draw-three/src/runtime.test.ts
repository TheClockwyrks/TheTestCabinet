// The runtime, over a canvas with no document behind it.
//
// Everything the runtime does is checked here directly: the frame loop, the delta
// it measures and clamps, the manual clock the debug surface reaches, the pointer
// samples it delivers in arrival order, and the overlay key it owns.

import { createCanvas } from "@napi-rs/canvas";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STAGE_H, STAGE_W } from "./constants";
import { OVERLAY_KEY } from "./overlay";
import type { PointerSample } from "./pointer";
import {
  createRuntime,
  MAX_FRAME_SECONDS,
  type Game,
  type Runtime,
} from "./runtime";
import type { Surface } from "./viewport";

interface Recorded {
  initialized: number;
  updates: number[];
  renders: number;
  samples: PointerSample[];
}

class KeyEvent extends Event {
  readonly code: string;

  constructor(code: string) {
    super("keydown");
    this.code = code;
  }
}

class Point extends Event {
  readonly clientX: number;
  readonly clientY: number;
  readonly isPrimary: boolean;

  constructor(type: string, x: number, y: number, isPrimary = true) {
    super(type);
    this.clientX = x;
    this.clientY = y;
    this.isPrimary = isPrimary;
  }
}

interface Stand {
  runtime: Runtime<{ n: number }>;
  log: Recorded;
  events: EventTarget;
}

function stand(): Stand {
  const canvas = createCanvas(STAGE_W, STAGE_H) as unknown as HTMLCanvasElement;
  const events = new EventTarget();
  const surface: Surface = {
    cssWidth: () => STAGE_W,
    cssHeight: () => STAGE_H,
    origin: () => ({ x: 0, y: 0 }),
    dpr: () => 1,
    events: () => events,
  };
  const log: Recorded = {
    initialized: 0,
    updates: [],
    renders: 0,
    samples: [],
  };
  const game: Game<{ n: number }> = {
    initialize: (api) => {
      log.initialized += 1;
      api.audio.define("beep", { freq: 400, durationMs: 20 });
      api.diagnostics.register("n", () => 1);
      return { n: 0 };
    },
    update: (_state, _api, dt) => {
      log.updates.push(dt);
    },
    render: () => {
      log.renders += 1;
    },
    pointer: (_state, _api, sample) => {
      log.samples.push(sample);
    },
  };
  const runtime = createRuntime({
    canvas,
    width: STAGE_W,
    height: STAGE_H,
    game,
    menuBindings: {
      "menu-up": ["ArrowUp"],
      "menu-down": ["ArrowDown"],
      "menu-confirm": ["Enter"],
      "menu-back": ["Escape"],
    },
    background: "#000000",
    surface,
    audioContext: () => null,
  });
  return { runtime, log, events };
}

let ticks: ((ms: number) => void)[] = [];

beforeEach(() => {
  ticks = [];
  Object.defineProperty(globalThis, "requestAnimationFrame", {
    value: (callback: (ms: number) => void) => {
      ticks.push(callback);
      return ticks.length;
    },
    configurable: true,
  });
  Object.defineProperty(globalThis, "cancelAnimationFrame", {
    value: () => undefined,
    configurable: true,
  });
});

afterEach(() => {
  Reflect.deleteProperty(globalThis, "requestAnimationFrame");
  Reflect.deleteProperty(globalThis, "cancelAnimationFrame");
});

/** Drive whatever the loop most recently asked for, at `ms`. */
function tick(ms: number): void {
  const next = ticks.shift();
  next?.(ms);
}

describe("initialize", () => {
  it("builds the state once and runs no frame", () => {
    const { runtime, log } = stand();
    const state = runtime.initialize();
    expect(log.initialized).toBe(1);
    expect(log.updates).toEqual([]);
    expect(log.renders).toBe(0);
    expect(runtime.initialize()).toBe(state);
    expect(log.initialized).toBe(1);
  });

  it("refuses to hand out a state it has not built", () => {
    const { runtime } = stand();
    expect(() => runtime.state).toThrow(/has not initialized/);
  });

  it("fits the stage onto the canvas", () => {
    const { runtime } = stand();
    runtime.initialize();
    expect(runtime.viewport()).toMatchObject({
      width: STAGE_W,
      height: STAGE_H,
      scale: 1,
      offsetX: 0,
      offsetY: 0,
    });
  });
});

describe("advance", () => {
  it("runs whole frames of an exact length, in order", () => {
    const { runtime, log } = stand();
    runtime.initialize();
    runtime.advance(1, 4);
    expect(log.updates).toEqual([0.25, 0.25, 0.25, 0.25]);
    expect(log.renders).toBe(4);
    expect(runtime.frame()).toEqual({ count: 4, time: 1, dt: 0.25 });
  });

  it("runs one frame when it is given no count", () => {
    const { runtime, log } = stand();
    runtime.initialize();
    runtime.advance(0.5);
    expect(log.updates).toEqual([0.5]);
  });

  it("refuses nonsense", () => {
    const { runtime } = stand();
    runtime.initialize();
    expect(() => runtime.advance(-1)).toThrow(RangeError);
    expect(() => runtime.advance(Number.NaN)).toThrow(RangeError);
    expect(() => runtime.advance(1, 0)).toThrow(RangeError);
    expect(() => runtime.advance(1, 1.5)).toThrow(RangeError);
  });
});

describe("the loop", () => {
  it("measures its delta between consecutive frames", () => {
    const { runtime, log } = stand();
    runtime.initialize();
    runtime.start();
    tick(1000);
    tick(1016);
    expect(log.updates[0]).toBe(0);
    expect(log.updates[1]).toBeCloseTo(0.016, 9);
  });

  it("clamps the gap a backgrounded tab resumes with", () => {
    const { runtime, log } = stand();
    runtime.initialize();
    runtime.start();
    tick(0);
    tick(30000);
    expect(log.updates[1]).toBe(MAX_FRAME_SECONDS);
  });

  it("keeps drawing but stops advancing while the clock is taken away", () => {
    const { runtime, log } = stand();
    runtime.initialize();
    runtime.setAutoStep(false);
    expect(runtime.autoStep()).toBe(false);
    runtime.start();
    tick(0);
    tick(16);
    expect(log.updates).toEqual([]);
    expect(log.renders).toBe(2);
  });

  it("stops when it is told to", () => {
    const { runtime, log } = stand();
    runtime.initialize();
    runtime.start();
    tick(0);
    runtime.stop();
    const drawn = log.renders;
    tick(16);
    expect(log.renders).toBe(drawn);
  });
});

describe("the pointer", () => {
  it("delivers every sample on its own, in the order it arrived", () => {
    const { runtime, log, events } = stand();
    runtime.initialize();
    events.dispatchEvent(new Point("pointerdown", 100, 200));
    events.dispatchEvent(new Point("pointermove", 140, 220));
    events.dispatchEvent(new Point("pointerup", 180, 240));
    expect(log.samples).toEqual([
      { phase: "down", x: 100, y: 200 },
      { phase: "move", x: 140, y: 220 },
      { phase: "up", x: 180, y: 240 },
    ]);
  });

  it("ignores a non-primary touch", () => {
    const { runtime, log, events } = stand();
    runtime.initialize();
    events.dispatchEvent(new Point("pointerdown", 10, 10, false));
    expect(log.samples).toEqual([]);
  });

  it("delivers a posed sample down the same path", () => {
    const { runtime, log } = stand();
    runtime.initialize();
    runtime.pointer("down", 640, 360);
    expect(log.samples).toEqual([{ phase: "down", x: 640, y: 360 }]);
  });

  it("answers a whole gesture between two frames", () => {
    const { runtime, log, events } = stand();
    runtime.initialize();
    events.dispatchEvent(new Point("pointerdown", 10, 10));
    events.dispatchEvent(new Point("pointerup", 12, 12));
    expect(log.samples).toHaveLength(2);
    expect(log.updates).toEqual([]);
  });
});

describe("the overlay key", () => {
  it("is the runtime's, and answers the backtick", () => {
    const { runtime, events } = stand();
    runtime.initialize();
    expect(runtime.overlayVisible()).toBe(false);
    events.dispatchEvent(new KeyEvent(OVERLAY_KEY));
    expect(runtime.overlayVisible()).toBe(true);
    events.dispatchEvent(new KeyEvent("KeyA"));
    expect(runtime.overlayVisible()).toBe(true);
    events.dispatchEvent(new KeyEvent(OVERLAY_KEY));
    expect(runtime.overlayVisible()).toBe(false);
  });
});

describe("destroy", () => {
  it("drops every listener and refuses to run again", () => {
    const { runtime, log, events } = stand();
    runtime.initialize();
    runtime.start();
    runtime.destroy();
    events.dispatchEvent(new Point("pointerdown", 10, 10));
    events.dispatchEvent(new KeyEvent(OVERLAY_KEY));
    expect(log.samples).toEqual([]);
    expect(() => runtime.initialize()).toThrow(/destroyed/);
    expect(() => runtime.destroy()).not.toThrow();
  });
});

describe("a host with no animation frame", () => {
  it("says so rather than failing silently", () => {
    Reflect.deleteProperty(globalThis, "requestAnimationFrame");
    const { runtime } = stand();
    runtime.initialize();
    const start = vi.fn(() => runtime.start());
    expect(start).toThrow(/advance\(\)/);
  });
});
