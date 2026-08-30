// Wireworm — the runtime the game stands on (specs/overview.md,
// specs/instrumentation.md).
//
// The frame loop, the delta it measures, the canvas fit, and the manual clock
// the debug surface exposes. Checked over a canvas with no document behind it,
// through a `Surface` of the test's own, which is the seam the DOM is read
// through.

import { describe, expect, test, vi } from "vitest";
import { createCanvas, type Canvas } from "@napi-rs/canvas";
import { MAX_FRAME_SECONDS, createRuntime, type Game } from "./runtime";
import type { Surface } from "./viewport";
import { keyEvent } from "./harness.test-support";

interface Counted {
  updates: number;
  renders: number;
  deltas: number[];
  held: number;
  edges: number;
}

/** A game that counts what the runtime did to it. */
function countingGame(): { game: Game<Counted>; keys: EventTarget } {
  const keys = new EventTarget();
  const game: Game<Counted> = {
    initialize(api) {
      api.input.register("go", ["KeyG"]);
      api.audio.define("beep", { freq: 440, durationMs: 10 });
      api.diagnostics.register("updates", () => 0);
      return { updates: 0, renders: 0, deltas: [], held: 0, edges: 0 };
    },
    update(state, api, dt) {
      state.updates += 1;
      state.deltas.push(dt);
      state.held += api.input.value("go");
      if (api.input.pressed("go")) state.edges += 1;
    },
    render(state, api) {
      state.renders += 1;
      api.ctx.fillStyle = "#ff0000";
      api.ctx.fillRect(0, 0, 10, 10);
    },
  };
  return { game, keys };
}

function stand(size = { w: 640, h: 360, dpr: 1 }): {
  runtime: ReturnType<typeof createRuntime<Counted>>;
  keys: EventTarget;
  canvas: Canvas;
} {
  const canvas = createCanvas(size.w, size.h);
  const { game, keys } = countingGame();
  const surface: Surface = {
    cssWidth: () => size.w,
    cssHeight: () => size.h,
    dpr: () => size.dpr,
    events: () => keys,
  };
  const runtime = createRuntime<Counted>({
    canvas: canvas as unknown as HTMLCanvasElement,
    width: 1280,
    height: 720,
    game,
    background: "#000000",
    surface,
    audioContext: () => null,
  });
  return { runtime, keys, canvas };
}

describe("the runtime", () => {
  test("nothing the game supplies runs until it is initialized", () => {
    const { runtime } = stand();
    expect(() => runtime.state).toThrow(/has not initialized/);
    const state = runtime.initialize();
    expect(state.updates).toBe(0);
    expect(runtime.frame()).toEqual({ count: 0, time: 0, dt: 0 });
    runtime.destroy();
  });

  test("initializing twice returns the state it already built", () => {
    const { runtime } = stand();
    expect(runtime.initialize()).toBe(runtime.initialize());
    runtime.destroy();
  });

  test("advance runs whole frames of an exact length, update then render", () => {
    const { runtime } = stand();
    const state = runtime.initialize();
    runtime.advance(1, 4);
    expect(state.updates).toBe(4);
    expect(state.renders).toBe(4);
    expect(state.deltas).toEqual([0.25, 0.25, 0.25, 0.25]);
    expect(runtime.frame()).toEqual({ count: 4, time: 1, dt: 0.25 });
    runtime.destroy();
  });

  test("advance defaults to one frame", () => {
    const { runtime } = stand();
    const state = runtime.initialize();
    runtime.advance(0.5);
    expect(state.deltas).toEqual([0.5]);
    runtime.destroy();
  });

  test("advance refuses a span or a count it cannot run", () => {
    const { runtime } = stand();
    runtime.initialize();
    expect(() => runtime.advance(-1)).toThrow(RangeError);
    expect(() => runtime.advance(Number.NaN)).toThrow(RangeError);
    expect(() => runtime.advance(1, 0)).toThrow(RangeError);
    expect(() => runtime.advance(1, 2.5)).toThrow(RangeError);
    runtime.destroy();
  });

  test("advancing before initializing runs nothing", () => {
    const { runtime } = stand();
    expect(() => runtime.advance(1, 2)).not.toThrow();
    expect(runtime.frame().count).toBe(0);
    runtime.destroy();
  });

  test("the clock can be taken away and given back", () => {
    const { runtime } = stand();
    runtime.initialize();
    expect(runtime.autoStep()).toBe(true);
    runtime.setAutoStep(false);
    expect(runtime.autoStep()).toBe(false);
    runtime.setAutoStep(true);
    expect(runtime.autoStep()).toBe(true);
    runtime.destroy();
  });

  test("the loop measures its own delta and clamps a long gap", () => {
    const frames: FrameRequestCallback[] = [];
    const original = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    }) as typeof globalThis.requestAnimationFrame;

    const { runtime } = stand();
    const state = runtime.initialize();
    runtime.start();
    // The first tick is worth nothing: a delta is measured between two frames.
    frames.shift()?.(1000);
    expect(state.deltas).toEqual([0]);
    frames.shift()?.(1016);
    expect(state.deltas[1]).toBeCloseTo(0.016, 6);
    // A backgrounded tab resumes with a gap measured in seconds.
    frames.shift()?.(31016);
    expect(state.deltas[2]).toBe(MAX_FRAME_SECONDS);
    // A tick that went backwards is worth nothing.
    frames.shift()?.(31000);
    expect(state.deltas[3]).toBe(0);

    runtime.stop();
    runtime.destroy();
    globalThis.requestAnimationFrame = original;
  });

  test("while it is off the clock the loop presents without advancing", () => {
    const frames: FrameRequestCallback[] = [];
    const original = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    }) as typeof globalThis.requestAnimationFrame;

    const { runtime } = stand();
    const state = runtime.initialize();
    runtime.setAutoStep(false);
    runtime.start();
    frames.shift()?.(1000);
    frames.shift()?.(1016);
    expect(state.updates).toBe(0);
    expect(state.renders).toBe(2);
    runtime.destroy();
    globalThis.requestAnimationFrame = original;
  });

  test("an environment with no animation frame says so", () => {
    const original = globalThis.requestAnimationFrame;
    // @ts-expect-error — removing it is the whole of the scenario.
    delete globalThis.requestAnimationFrame;
    const { runtime } = stand();
    runtime.initialize();
    expect(() => runtime.start()).toThrow(/advance\(\)/);
    runtime.destroy();
    globalThis.requestAnimationFrame = original;
  });

  test("the canvas is sized to the element and cleared to the background", () => {
    const { runtime, canvas } = stand({ w: 900, h: 600, dpr: 2 });
    runtime.initialize();
    runtime.advance(0, 1);
    expect(canvas.width).toBe(1800);
    expect(canvas.height).toBe(1200);
    // A 3:2 element is taller than the 16:9 stage, so the letterbox is the two
    // bars above and below it, and it carries the background.
    const fit = runtime.viewport();
    expect(fit.offsetX).toBeCloseTo(0, 6);
    expect(fit.offsetY).toBeGreaterThan(0);
    const corner = canvas.getContext("2d").getImageData(1, 1, 1, 1).data;
    expect([corner[0], corner[1], corner[2]]).toEqual([0, 0, 0]);
  });

  test("the input the game reads is the keyboard the runtime listens on", () => {
    const { runtime, keys } = stand();
    const state = runtime.initialize();
    keys.dispatchEvent(keyEvent("keydown", "KeyG"));
    runtime.advance(0.1, 2);
    expect(state.held).toBe(2);
    // An edge is news for one frame only.
    expect(state.edges).toBe(1);
    keys.dispatchEvent(keyEvent("keyup", "KeyG"));
    runtime.advance(0.1, 1);
    expect(state.held).toBe(2);
    runtime.destroy();
  });

  test("a frame that throws is still closed, and the loop re-arms", () => {
    const canvas = createCanvas(640, 360);
    const keys = new EventTarget();
    const game: Game<{ runs: number }> = {
      initialize: () => ({ runs: 0 }),
      update(state) {
        state.runs += 1;
        throw new Error("bad frame");
      },
      render: () => undefined,
    };
    const runtime = createRuntime<{ runs: number }>({
      canvas: canvas as unknown as HTMLCanvasElement,
      width: 1280,
      height: 720,
      game,
      background: "#000000",
      surface: {
        cssWidth: () => 640,
        cssHeight: () => 360,
        dpr: () => 1,
        events: () => keys,
      },
      audioContext: () => null,
    });
    runtime.initialize();
    expect(() => runtime.advance(0.1, 1)).toThrow("bad frame");
    expect(() => runtime.advance(0.1, 1)).toThrow("bad frame");
    expect(runtime.state.runs).toBe(2);
    runtime.destroy();
  });

  test("destroying halts the loop and refuses to come back", () => {
    const { runtime, keys } = stand();
    const state = runtime.initialize();
    runtime.destroy();
    runtime.destroy();
    expect(() => runtime.initialize()).toThrow(/destroyed/);
    keys.dispatchEvent(keyEvent("keydown", "KeyG"));
    runtime.advance(0.1, 1);
    // The state is gone with the runtime, so nothing further reaches the game.
    expect(state.updates).toBe(0);
    expect(() => runtime.start()).not.toThrow();
  });

  test("a canvas with no 2D context is reported rather than drawn to", () => {
    const canvas = {
      width: 0,
      height: 0,
      clientWidth: 640,
      clientHeight: 360,
      getContext: vi.fn(() => null),
    } as unknown as HTMLCanvasElement;
    const runtime = createRuntime<{ ok: boolean }>({
      canvas,
      width: 1280,
      height: 720,
      game: {
        initialize: () => ({ ok: true }),
        update: () => undefined,
        render: () => undefined,
      },
      background: "#000000",
      surface: {
        cssWidth: () => 640,
        cssHeight: () => 360,
        dpr: () => 1,
        events: () => new EventTarget(),
      },
      audioContext: () => null,
    });
    runtime.initialize();
    expect(() => runtime.advance(0.1, 1)).toThrow(/no 2D context/);
    runtime.destroy();
  });

  test("the overlay's own key is the runtime's, not the game's", () => {
    const { runtime, keys } = stand();
    runtime.initialize();
    expect(runtime.overlayVisible()).toBe(false);
    keys.dispatchEvent(keyEvent("keydown", "Backquote"));
    expect(runtime.overlayVisible()).toBe(true);
    // An auto-repeat is not a second press.
    const repeat = new Event("keydown");
    Object.assign(repeat, { code: "Backquote", repeat: true });
    keys.dispatchEvent(repeat);
    expect(runtime.overlayVisible()).toBe(true);
    keys.dispatchEvent(keyEvent("keydown", "KeyG"));
    expect(runtime.overlayVisible()).toBe(true);
    runtime.destroy();
  });
});
