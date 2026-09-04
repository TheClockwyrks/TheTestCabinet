import { createCanvas } from "@napi-rs/canvas";
import { afterEach, describe, expect, it } from "vitest";
import { OVERLAY_KEY } from "./overlay";
import { createRuntime, MAX_FRAME_SECONDS, type Game } from "./runtime";
import type { Surface } from "./viewport";

/** A DOM-free event target the runtime listens on. */
class Target implements EventTarget {
  private readonly listeners = new Map<string, Set<EventListener>>();

  addEventListener(type: string, listener: EventListener | null): void {
    if (listener === null) return;
    const set = this.listeners.get(type) ?? new Set<EventListener>();
    set.add(listener);
    this.listeners.set(type, set);
  }

  removeEventListener(type: string, listener: EventListener | null): void {
    if (listener === null) return;
    this.listeners.get(type)?.delete(listener);
  }

  dispatchEvent(event: Event): boolean {
    for (const listener of [...(this.listeners.get(event.type) ?? [])]) {
      listener(event);
    }
    return true;
  }
}

interface Trace {
  updates: number[];
  renders: number;
}

/** A canvas and the surface that reports its shape, with no document. */
function bench(cssWidth = 1280, cssHeight = 720, dpr = 1) {
  const canvas = createCanvas(1, 1) as unknown as HTMLCanvasElement;
  const events = new Target();
  const surface: Surface = {
    cssWidth: () => cssWidth,
    cssHeight: () => cssHeight,
    dpr: () => dpr,
    origin: () => ({ left: 0, top: 0 }),
    events: () => events,
  };
  const trace: Trace = { updates: [], renders: 0 };
  const game: Game<{ n: number }> = {
    initialize: () => ({ n: 0 }),
    update: (state, _api, dt) => {
      state.n += 1;
      trace.updates.push(dt);
    },
    render: () => {
      trace.renders += 1;
    },
  };
  const runtime = createRuntime({
    canvas,
    width: 1280,
    height: 720,
    game,
    background: "#000000",
    surface,
    audioContext: () => null,
  });
  return { runtime, trace, events, canvas };
}

/** A stand-in for the browser's frame callback, driven by hand. */
function armFrames() {
  const pending: FrameRequestCallback[] = [];
  const globals = globalThis as unknown as {
    requestAnimationFrame?: (cb: FrameRequestCallback) => number;
    cancelAnimationFrame?: (handle: number) => void;
  };
  const hadRequest = globals.requestAnimationFrame;
  const hadCancel = globals.cancelAnimationFrame;
  globals.requestAnimationFrame = (cb) => {
    pending.push(cb);
    return pending.length;
  };
  globals.cancelAnimationFrame = () => undefined;
  return {
    tick(ms: number): void {
      const next = pending.shift();
      next?.(ms);
    },
    restore(): void {
      globals.requestAnimationFrame = hadRequest;
      globals.cancelAnimationFrame = hadCancel;
    },
  };
}

let frames: ReturnType<typeof armFrames> | null = null;

afterEach(() => {
  frames?.restore();
  frames = null;
});

describe("the runtime", () => {
  it("builds the state once, before any frame runs", () => {
    const { runtime, trace } = bench();
    expect(() => runtime.state).toThrow(/has not initialized/);
    const state = runtime.initialize();
    expect(state).toEqual({ n: 0 });
    expect(runtime.initialize()).toBe(state);
    expect(trace.updates).toEqual([]);
    expect(trace.renders).toBe(0);
  });

  it("advances exact whole frames, each a real update and render", () => {
    const { runtime, trace } = bench();
    runtime.initialize();
    runtime.advance(1, 4);
    expect(trace.updates).toEqual([0.25, 0.25, 0.25, 0.25]);
    expect(trace.renders).toBe(4);
    expect(runtime.frame()).toMatchObject({ count: 4, time: 1, dt: 0.25 });
  });

  it("covers an interval the same however it is divided", () => {
    const one = bench();
    const many = bench();
    one.runtime.initialize();
    many.runtime.initialize();
    one.runtime.advance(1, 1);
    many.runtime.advance(1, 60);
    expect(one.runtime.frame().time).toBeCloseTo(many.runtime.frame().time, 9);
  });

  it("refuses a nonsense advance rather than guessing", () => {
    const { runtime } = bench();
    runtime.initialize();
    expect(() => runtime.advance(-1)).toThrow(RangeError);
    expect(() => runtime.advance(1, 0)).toThrow(RangeError);
    expect(() => runtime.advance(1, 1.5)).toThrow(RangeError);
  });

  it("steps from the wall clock, and stops when the clock is taken away", () => {
    frames = armFrames();
    const { runtime, trace } = bench();
    runtime.initialize();
    runtime.start();
    frames.tick(0);
    frames.tick(16);
    expect(trace.updates).toHaveLength(2);
    expect(trace.updates[0]).toBe(0);
    expect(trace.updates[1]).toBeCloseTo(0.016, 6);

    runtime.setAutoStep(false);
    expect(runtime.autoStep()).toBe(false);
    const renders = trace.renders;
    frames.tick(32);
    expect(trace.updates).toHaveLength(2);
    expect(trace.renders).toBe(renders + 1);
    runtime.stop();
  });

  it("clamps a frame measured across a long stall", () => {
    frames = armFrames();
    const { runtime, trace } = bench();
    runtime.initialize();
    runtime.start();
    frames.tick(0);
    frames.tick(30000);
    expect(trace.updates[1]).toBe(MAX_FRAME_SECONDS);
    runtime.stop();
  });

  it("sizes the backing store to the surface and centres the stage in it", () => {
    const { runtime, canvas } = bench(1280, 1000, 2);
    runtime.initialize();
    runtime.advance(0);
    expect(canvas.width).toBe(2560);
    expect(canvas.height).toBe(2000);
    const view = runtime.viewport();
    expect(view.scale).toBe(2);
    expect(view.offsetX).toBe(0);
    expect(view.offsetY).toBe((2000 - 1440) / 2);
  });

  it("toggles the overlay on the backtick key and on no other", () => {
    const { runtime, events } = bench();
    runtime.initialize();
    expect(runtime.overlayVisible()).toBe(false);
    events.dispatchEvent(
      Object.assign(new Event("keydown"), { code: "KeyA", repeat: false }),
    );
    expect(runtime.overlayVisible()).toBe(false);
    events.dispatchEvent(
      Object.assign(new Event("keydown"), { code: OVERLAY_KEY, repeat: false }),
    );
    expect(runtime.overlayVisible()).toBe(true);
  });

  it("drops everything it held once it is destroyed", () => {
    const { runtime, trace } = bench();
    runtime.initialize();
    runtime.destroy();
    runtime.destroy();
    expect(() => runtime.initialize()).toThrow(/destroyed/);
    runtime.advance(1, 1);
    expect(trace.updates).toEqual([]);
  });

  it("says so where the platform has no frame callback", () => {
    const globals = globalThis as unknown as {
      requestAnimationFrame?: unknown;
    };
    const had = globals.requestAnimationFrame;
    delete globals.requestAnimationFrame;
    const { runtime } = bench();
    runtime.initialize();
    expect(() => runtime.start()).toThrow(/advance\(\)/);
    globals.requestAnimationFrame = had;
  });
});
