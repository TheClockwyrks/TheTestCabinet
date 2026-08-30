// Spectra — the runtime: the frame loop, the clock that can be taken away, and the
// canvas fit, all over a surface with no document behind it.

import { afterEach, describe, expect, it, vi } from "vitest";
import { OVERLAY_KEY } from "./constants";
import { MAX_FRAME_SECONDS, createRuntime, type Game } from "./runtime";
import type { Surface } from "./viewport";

/** What one frame of the game under test recorded. */
interface Recorded {
  updates: number[];
  renders: number;
  actions: string[];
}

/** A canvas stub whose 2D context records nothing but survives every call. */
function stubCanvas(): HTMLCanvasElement {
  const ctx = new Proxy(
    { canvas: null as unknown },
    {
      get: (target, name) => {
        if (name === "canvas") return target.canvas;
        return () => undefined;
      },
      set: () => true,
    },
  );
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ctx,
  };
  return canvas as unknown as HTMLCanvasElement;
}

function stubSurface(target: EventTarget): Surface {
  return {
    cssWidth: () => 1280,
    cssHeight: () => 720,
    dpr: () => 1,
    events: () => target,
  };
}

function recordingGame(recorded: Recorded): Game<{ ticks: number }> {
  return {
    initialize(api) {
      api.input.register("fire", ["Space"]);
      api.audio.define("beep", { freq: 440, durationMs: 10 });
      api.diagnostics.register("ticks", () => 0);
      return { ticks: 0 };
    },
    update(state, api, dt) {
      recorded.updates.push(dt);
      if (api.input.pressed("fire")) recorded.actions.push("pressed");
      if (api.input.value("fire") > 0) recorded.actions.push("held");
      state.ticks += 1;
    },
    render() {
      recorded.renders += 1;
    },
  };
}

function stand(recorded: Recorded) {
  const target = new EventTarget();
  const runtime = createRuntime({
    canvas: stubCanvas(),
    width: 1280,
    height: 720,
    game: recordingGame(recorded),
    background: "#000",
    surface: stubSurface(target),
    audioContext: () => null,
  });
  return { runtime, target };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createRuntime", () => {
  it("throws until it has initialized, then hands the state back once", () => {
    const recorded: Recorded = { updates: [], renders: 0, actions: [] };
    const { runtime } = stand(recorded);
    expect(() => runtime.state).toThrow(/has not initialized/);
    const state = runtime.initialize();
    expect(runtime.initialize()).toBe(state);
    expect(runtime.state).toBe(state);
    expect(recorded.updates).toHaveLength(0);
  });

  it("runs exactly the frames advance asks for, at an exact delta", () => {
    const recorded: Recorded = { updates: [], renders: 0, actions: [] };
    const { runtime } = stand(recorded);
    runtime.initialize();
    runtime.advance(1, 4);
    expect(recorded.updates).toEqual([0.25, 0.25, 0.25, 0.25]);
    expect(recorded.renders).toBe(4);
    expect(runtime.frame()).toMatchObject({ count: 4, dt: 0.25 });
    expect(runtime.frame().time).toBeCloseTo(1, 6);
  });

  it("refuses an advance that is not a finite span of whole frames", () => {
    const recorded: Recorded = { updates: [], renders: 0, actions: [] };
    const { runtime } = stand(recorded);
    runtime.initialize();
    expect(() => runtime.advance(-1)).toThrow(RangeError);
    expect(() => runtime.advance(Number.NaN)).toThrow(RangeError);
    expect(() => runtime.advance(1, 0)).toThrow(RangeError);
    expect(() => runtime.advance(1, 1.5)).toThrow(RangeError);
  });

  it("keeps rendering but stops advancing while it is off the wall clock", () => {
    const recorded: Recorded = { updates: [], renders: 0, actions: [] };
    const { runtime } = stand(recorded);
    runtime.initialize();
    expect(runtime.autoStep()).toBe(true);
    runtime.setAutoStep(false);
    expect(runtime.autoStep()).toBe(false);

    // Pump the loop by hand: one tick with the game off the clock renders and
    // advances nothing.
    const ticks: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => {
      ticks.push(fn);
      return ticks.length;
    });
    vi.stubGlobal("cancelAnimationFrame", () => undefined);
    runtime.start();
    (ticks.shift() as FrameRequestCallback)(0);
    (ticks.shift() as FrameRequestCallback)(1000);
    runtime.stop();
    expect(recorded.updates).toHaveLength(0);
    expect(recorded.renders).toBeGreaterThan(0);
  });

  it("clamps a frame measured across a long gap", () => {
    const recorded: Recorded = { updates: [], renders: 0, actions: [] };
    const { runtime } = stand(recorded);
    runtime.initialize();
    const ticks: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => {
      ticks.push(fn);
      return ticks.length;
    });
    vi.stubGlobal("cancelAnimationFrame", () => undefined);
    runtime.start();
    (ticks.shift() as FrameRequestCallback)(0);
    (ticks.shift() as FrameRequestCallback)(30_000);
    runtime.stop();
    // The first tick is worth nothing, and the second is clamped.
    expect(recorded.updates[0]).toBe(0);
    expect(recorded.updates[1]).toBe(MAX_FRAME_SECONDS);
  });

  it("refuses to start where there is no animation frame to arm", () => {
    const recorded: Recorded = { updates: [], renders: 0, actions: [] };
    const { runtime } = stand(recorded);
    runtime.initialize();
    vi.stubGlobal("requestAnimationFrame", undefined);
    expect(() => runtime.start()).toThrow(/requestAnimationFrame/);
  });

  it("routes a real key event to the game's registered action", () => {
    const recorded: Recorded = { updates: [], renders: 0, actions: [] };
    const { runtime, target } = stand(recorded);
    runtime.initialize();
    const down = new Event("keydown") as Event & { code: string };
    down.code = "Space";
    target.dispatchEvent(down);
    runtime.advance(1 / 60);
    expect(recorded.actions).toEqual(["pressed", "held"]);
  });

  it("toggles the overlay on the backtick and nothing else", () => {
    const recorded: Recorded = { updates: [], renders: 0, actions: [] };
    const { runtime, target } = stand(recorded);
    runtime.initialize();
    expect(runtime.overlayVisible()).toBe(false);
    const tick = new Event("keydown") as Event & { code: string };
    tick.code = OVERLAY_KEY;
    target.dispatchEvent(tick);
    expect(runtime.overlayVisible()).toBe(true);
    const other = new Event("keydown") as Event & { code: string };
    other.code = "KeyZ";
    target.dispatchEvent(other);
    expect(runtime.overlayVisible()).toBe(true);
    target.dispatchEvent(tick);
    expect(runtime.overlayVisible()).toBe(false);
  });

  it("reports the fit of the logical stage onto the surface", () => {
    const recorded: Recorded = { updates: [], renders: 0, actions: [] };
    const { runtime } = stand(recorded);
    runtime.initialize();
    expect(runtime.viewport()).toMatchObject({
      scale: 1,
      offsetX: 0,
      offsetY: 0,
    });
  });

  it("advances nothing once it has been destroyed", () => {
    const recorded: Recorded = { updates: [], renders: 0, actions: [] };
    const { runtime } = stand(recorded);
    runtime.initialize();
    runtime.destroy();
    runtime.destroy();
    runtime.advance(1, 2);
    expect(recorded.updates).toHaveLength(0);
    expect(() => runtime.initialize()).toThrow(/destroyed/);
  });
});
