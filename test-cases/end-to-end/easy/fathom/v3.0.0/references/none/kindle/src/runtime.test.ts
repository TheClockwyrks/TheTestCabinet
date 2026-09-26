import { createCanvas } from "@napi-rs/canvas";
import { afterEach, describe, expect, it } from "vitest";

import {
  createRuntime,
  MAX_FRAME_SECONDS,
  type Game,
  type Runtime,
} from "./runtime";
import type { Surface } from "./viewport";

const TICK = 1 / 120;

/** A state that simply records what the runtime did to it. */
interface Recorded {
  ticks: number[];
  renders: number[];
  cues: string[];
  held: number[];
  edges: boolean[];
}

/** A surface with no document behind it, sized and driven by the test. */
function testSurface(events: EventTarget): Surface & {
  size: { w: number; h: number; dpr: number };
} {
  const size = { w: 640, h: 360, dpr: 1 };
  return {
    size,
    cssWidth: () => size.w,
    cssHeight: () => size.h,
    dpr: () => size.dpr,
    events: () => events,
  };
}

function recordingGame(): Game<Recorded> {
  return {
    initialize(api) {
      api.input.register("fire", ["Space"]);
      api.audio.define("blip", { freq: 440, durationMs: 10 });
      const state: Recorded = {
        ticks: [],
        renders: [],
        cues: [],
        held: [],
        edges: [],
      };
      api.diagnostics.register("ticks", () => state.ticks.length);
      return state;
    },
    tick(state, api, dt) {
      state.ticks.push(dt);
      state.held.push(api.input.value("fire"));
      state.edges.push(api.input.pressed("fire"));
      if (api.input.value("fire") > 0) {
        api.audio.play("blip");
        state.cues.push("blip");
      }
    },
    render(state, api) {
      state.renders.push(api.alpha);
    },
  };
}

let live: Runtime<Recorded> | null = null;

function build(): {
  runtime: Runtime<Recorded>;
  events: EventTarget;
  surface: ReturnType<typeof testSurface>;
} {
  const events = new EventTarget();
  const surface = testSurface(events);
  const runtime = createRuntime<Recorded>({
    canvas: createCanvas(640, 360) as unknown as HTMLCanvasElement,
    width: 1280,
    height: 720,
    tickSeconds: TICK,
    game: recordingGame(),
    background: "#000000",
    surface,
    audioContext: () => null,
  });
  live = runtime;
  return { runtime, events, surface };
}

afterEach(() => {
  live?.destroy();
  live = null;
});

describe("createRuntime", () => {
  it("refuses to hand over a state before it has initialized", () => {
    const { runtime } = build();
    expect(() => runtime.state).toThrow(/has not initialized/);
  });

  it("builds the state once and runs no tick doing it", () => {
    const { runtime } = build();
    const state = runtime.initialize();
    expect(runtime.initialize()).toBe(state);
    expect(state.ticks).toHaveLength(0);
  });

  it("runs exactly the ticks it is asked for, each of one tick's length", () => {
    const { runtime } = build();
    const state = runtime.initialize();
    runtime.advance(3);
    expect(state.ticks).toEqual([TICK, TICK, TICK]);
    expect(runtime.tick()).toEqual({ count: 3, time: TICK * 3 });
  });

  it("draws once after an advance, so the canvas shows what was run", () => {
    const { runtime } = build();
    const state = runtime.initialize();
    runtime.advance(2);
    expect(state.renders).toEqual([0]);
  });

  it("runs nothing on advance(0) but still redraws", () => {
    const { runtime } = build();
    const state = runtime.initialize();
    runtime.advance(0);
    expect(state.ticks).toHaveLength(0);
    expect(state.renders).toHaveLength(1);
  });

  it("refuses a tick count that is not a whole, non-negative number", () => {
    const { runtime } = build();
    runtime.initialize();
    expect(() => runtime.advance(1.5)).toThrow(RangeError);
    expect(() => runtime.advance(-1)).toThrow(RangeError);
    expect(() => runtime.advance(Number.NaN)).toThrow(RangeError);
  });

  it("hands the game its registered actions, held and as edges", () => {
    const { runtime, events } = build();
    const state = runtime.initialize();
    events.dispatchEvent(
      Object.assign(new Event("keydown"), { code: "Space" }),
    );
    runtime.advance(2);
    expect(state.held).toEqual([1, 1]);
    // The edge is news for the first tick alone.
    expect(state.edges).toEqual([true, false]);
    expect(state.cues).toEqual(["blip", "blip"]);
  });

  it("takes the game off the wall clock and gives it back", () => {
    const { runtime } = build();
    runtime.initialize();
    expect(runtime.autoStep()).toBe(true);
    runtime.setAutoStep(false);
    expect(runtime.autoStep()).toBe(false);
    runtime.setAutoStep(true);
    expect(runtime.autoStep()).toBe(true);
  });

  it("fits the stage into the surface, letterboxing what is left over", () => {
    const { runtime, surface } = build();
    runtime.initialize();
    expect(runtime.viewport().scale).toBe(0.5);
    surface.size.w = 1280;
    surface.size.h = 1000;
    runtime.advance(0);
    const view = runtime.viewport();
    expect(view.scale).toBe(1);
    expect(view.offsetY).toBe(140);
  });

  it("throws where a frame loop cannot be armed", () => {
    const original = globalThis.requestAnimationFrame;
    // @ts-expect-error — removing it is the condition under test.
    delete globalThis.requestAnimationFrame;
    const { runtime } = build();
    runtime.initialize();
    expect(() => runtime.start()).toThrow(/requestAnimationFrame/);
    globalThis.requestAnimationFrame = original;
  });

  describe("the frame loop", () => {
    /** Drive the loop by hand, one wall-clock instant at a time. */
    function armLoop(): { pump(atMs: number): void; stop(): void } {
      const original = globalThis.requestAnimationFrame;
      let pending: FrameRequestCallback | null = null;
      globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
        pending = cb;
        return 1;
      }) as typeof requestAnimationFrame;
      globalThis.cancelAnimationFrame = (() => {
        pending = null;
      }) as typeof cancelAnimationFrame;
      return {
        pump(atMs) {
          const cb = pending;
          pending = null;
          cb?.(atMs);
        },
        stop() {
          globalThis.requestAnimationFrame = original;
        },
      };
    }

    it("runs the whole ticks the elapsed time completes, carrying the rest", () => {
      const loop = armLoop();
      const { runtime } = build();
      const state = runtime.initialize();
      runtime.start();
      // The first frame measures from nothing and is worth no time at all.
      loop.pump(0);
      expect(state.ticks).toHaveLength(0);
      // A sixtieth of a second is two whole ticks at 120 a second.
      loop.pump(1000 / 60);
      expect(state.ticks).toHaveLength(2);
      // A remainder is carried rather than dropped: three frames of 1/144 s
      // complete two ticks between them, not three and not one.
      loop.pump(1000 / 60 + 1000 / 144);
      loop.pump(1000 / 60 + (2 * 1000) / 144);
      loop.pump(1000 / 60 + (3 * 1000) / 144);
      expect(state.ticks).toHaveLength(4);
      runtime.stop();
      loop.stop();
    });

    it("hands the renderer how far past the last tick the picture stands", () => {
      const loop = armLoop();
      const { runtime } = build();
      const state = runtime.initialize();
      runtime.start();
      loop.pump(0);
      loop.pump(1000 / 80); // one tick and a half
      expect(state.ticks).toHaveLength(1);
      expect(state.renders[state.renders.length - 1]).toBeCloseTo(0.5, 6);
      runtime.stop();
      loop.stop();
    });

    it("clamps a frame that resumed after the tab was away", () => {
      const loop = armLoop();
      const { runtime } = build();
      const state = runtime.initialize();
      runtime.start();
      loop.pump(0);
      loop.pump(30_000);
      expect(state.ticks.length).toBe(Math.floor(MAX_FRAME_SECONDS / TICK));
      runtime.stop();
      loop.stop();
    });

    it("keeps drawing but advances nothing while it is off the clock", () => {
      const loop = armLoop();
      const { runtime } = build();
      const state = runtime.initialize();
      runtime.setAutoStep(false);
      runtime.start();
      loop.pump(0);
      loop.pump(1000);
      expect(state.ticks).toHaveLength(0);
      expect(state.renders.length).toBeGreaterThan(1);
      expect(state.renders.every((alpha) => alpha === 0)).toBe(true);
      runtime.stop();
      loop.stop();
    });

    it("does not hand the game the interval it spent off the clock", () => {
      const loop = armLoop();
      const { runtime } = build();
      const state = runtime.initialize();
      runtime.setAutoStep(false);
      runtime.start();
      loop.pump(0);
      loop.pump(5000);
      runtime.setAutoStep(true);
      loop.pump(5000 + 1000 / 60);
      expect(state.ticks).toHaveLength(2);
      runtime.stop();
      loop.stop();
    });
  });

  it("halts and releases everything on destroy, twice over", () => {
    const { runtime } = build();
    runtime.initialize();
    runtime.destroy();
    runtime.destroy();
    expect(() => runtime.initialize()).toThrow(/destroyed/);
  });
});
