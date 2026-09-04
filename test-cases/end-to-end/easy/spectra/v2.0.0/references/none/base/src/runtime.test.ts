import { afterEach, describe, expect, it, vi } from "vitest";

import { createCanvas } from "@napi-rs/canvas";

import { OVERLAY_KEY, STAGE_H, STAGE_W } from "./constants";
import {
  MAX_FRAME_SECONDS,
  createRuntime,
  type Game,
  type Runtime,
} from "./runtime";
import type { Surface } from "./viewport";

/** A frame loop a test pumps by hand, in place of the browser's. */
function fakeFrames(): {
  pump(nowMs: number): void;
  pending(): boolean;
  restore(): void;
} {
  const globals = globalThis as unknown as Record<string, unknown>;
  const previousRequest = globals.requestAnimationFrame;
  const previousCancel = globals.cancelAnimationFrame;
  let queued: ((nowMs: number) => void) | null = null;
  let handle = 0;
  globals.requestAnimationFrame = (callback: (nowMs: number) => void) => {
    queued = callback;
    handle += 1;
    return handle;
  };
  globals.cancelAnimationFrame = () => {
    queued = null;
  };
  return {
    pump(nowMs) {
      const callback = queued;
      queued = null;
      callback?.(nowMs);
    },
    pending: () => queued !== null,
    restore() {
      if (previousRequest === undefined) delete globals.requestAnimationFrame;
      else globals.requestAnimationFrame = previousRequest;
      if (previousCancel === undefined) delete globals.cancelAnimationFrame;
      else globals.cancelAnimationFrame = previousCancel;
    },
  };
}

/**
 * A key event a real `EventTarget` will carry.
 *
 * Node's `EventTarget` insists on an `Event` instance, and the build narrows one
 * structurally rather than with `instanceof`, so a `code` assigned onto a plain
 * `Event` is exactly what a browser and an automation driver both deliver.
 */
function keyEvent(code: string, repeat = false): Event {
  return Object.assign(new Event("keydown"), { code, repeat });
}

/** What one test's runtime was asked to do. */
interface Log {
  updates: number[];
  renders: number;
  registered: Map<string, readonly string[]>;
  defined: string[];
  sources: string[];
}

/** A trivial game, so the runtime is what is under test rather than Spectra. */
function probe(log: Log): Game<{ time: number }> {
  return {
    initialize(api) {
      api.input.register("left", ["ArrowLeft"]);
      api.audio.define("blip", { freq: 440, durationMs: 20 });
      api.diagnostics.register("time", () => 0);
      log.registered.set("left", ["ArrowLeft"]);
      log.defined.push("blip");
      log.sources.push("time");
      return { time: 0 };
    },
    update(state, api, dt) {
      state.time += dt;
      log.updates.push(dt);
      api.input.value("left");
      api.input.pressed("left");
      api.audio.muted();
    },
    render() {
      log.renders += 1;
    },
  };
}

/** A runtime over a headless canvas, with the size and density a test names. */
function stand(
  size: { css: [number, number]; dpr?: number } = { css: [1280, 720] },
): {
  runtime: Runtime<{ time: number }>;
  log: Log;
  events: EventTarget;
  frames: ReturnType<typeof fakeFrames>;
} {
  const canvas = createCanvas(1, 1) as unknown as HTMLCanvasElement;
  const events = new EventTarget();
  const surface: Surface = {
    cssWidth: () => size.css[0],
    cssHeight: () => size.css[1],
    dpr: () => size.dpr ?? 1,
    events: () => events,
  };
  const log: Log = {
    updates: [],
    renders: 0,
    registered: new Map(),
    defined: [],
    sources: [],
  };
  const frames = fakeFrames();
  const runtime = createRuntime<{ time: number }>({
    canvas,
    width: STAGE_W,
    height: STAGE_H,
    game: probe(log),
    background: "#05060f",
    surface,
    audioContext: () => null,
  });
  return { runtime, log, events, frames };
}

let live: ReturnType<typeof stand> | null = null;

afterEach(() => {
  live?.runtime.destroy();
  live?.frames.restore();
  live = null;
});

describe("the runtime", () => {
  it("builds the state once, before a single frame has run", () => {
    live = stand();
    const state = live.runtime.initialize();
    expect(state.time).toBe(0);
    expect(live.log.updates).toEqual([]);
    expect(live.log.renders).toBe(0);
    // Initializing twice returns the same state.
    expect(live.runtime.initialize()).toBe(state);
    expect(live.runtime.state).toBe(state);
  });

  it("throws when the state is read before it exists", () => {
    live = stand();
    expect(() => live?.runtime.state).toThrow(/has not initialized/);
  });

  it("hands the game its registrations while it initializes", () => {
    live = stand();
    live.runtime.initialize();
    expect(live.log.registered.has("left")).toBe(true);
    expect(live.log.defined).toEqual(["blip"]);
    expect(live.runtime.diagnostics.names()).toEqual(["time"]);
  });

  it("fits the logical stage onto the canvas it is given", () => {
    live = stand({ css: [1600, 720], dpr: 2 });
    live.runtime.initialize();
    const viewport = live.runtime.viewport();
    expect(viewport.width).toBe(STAGE_W);
    expect(viewport.scale).toBe(2);
    expect(viewport.offsetX).toBe(320);
    expect(viewport.offsetY).toBe(0);
  });

  it("runs update then render, once each, per frame it is advanced", () => {
    live = stand();
    live.runtime.initialize();
    live.runtime.advance(1 / 60, 1);
    expect(live.log.updates).toEqual([1 / 60]);
    expect(live.log.renders).toBe(1);
    expect(live.runtime.frame()).toMatchObject({ count: 1, dt: 1 / 60 });
  });

  it("divides an advance into whole frames of an exact delta", () => {
    live = stand();
    live.runtime.initialize();
    live.runtime.advance(1, 4);
    expect(live.log.updates).toEqual([0.25, 0.25, 0.25, 0.25]);
    expect(live.runtime.frame().time).toBeCloseTo(1, 10);
    expect(live.runtime.frame().count).toBe(4);
  });

  it("refuses an advance that is not a whole, positive number of frames", () => {
    live = stand();
    live.runtime.initialize();
    expect(() => live?.runtime.advance(1, 0)).toThrow(RangeError);
    expect(() => live?.runtime.advance(1, 1.5)).toThrow(/whole, positive/);
    expect(() => live?.runtime.advance(-1, 1)).toThrow(/non-negative/);
    expect(() => live?.runtime.advance(Number.NaN)).toThrow(/finite/);
  });

  it("steps from the wall clock while it is stepping, and only draws when not", () => {
    live = stand();
    live.runtime.initialize();
    expect(live.runtime.autoStep()).toBe(true);
    live.runtime.start();
    // The first tick measures from itself, so it is worth nothing.
    live.frames.pump(1000);
    expect(live.log.updates).toEqual([0]);
    live.frames.pump(1016);
    expect(live.log.updates[1]).toBeCloseTo(0.016, 6);

    live.runtime.setAutoStep(false);
    const updates = live.log.updates.length;
    const renders = live.log.renders;
    live.frames.pump(1032);
    live.frames.pump(1048);
    expect(live.log.updates.length).toBe(updates);
    // Drawing carries on, so the canvas shows what the last frame left.
    expect(live.log.renders).toBeGreaterThan(renders);

    live.runtime.setAutoStep(true);
    live.frames.pump(1064);
    expect(live.log.updates.length).toBe(updates + 1);
  });

  it("clamps a frame that arrives after a long gap", () => {
    live = stand();
    live.runtime.initialize();
    live.runtime.start();
    live.frames.pump(0);
    live.frames.pump(30_000);
    expect(live.log.updates[1]).toBe(MAX_FRAME_SECONDS);
  });

  it("treats a tick that went backwards as worth nothing", () => {
    live = stand();
    live.runtime.initialize();
    live.runtime.start();
    live.frames.pump(1000);
    live.frames.pump(900);
    expect(live.log.updates).toEqual([0, 0]);
  });

  it("keeps asking for frames until it is stopped", () => {
    live = stand();
    live.runtime.initialize();
    live.runtime.start();
    expect(live.frames.pending()).toBe(true);
    live.frames.pump(16);
    expect(live.frames.pending()).toBe(true);
    live.runtime.stop();
    expect(live.frames.pending()).toBe(false);
    // Starting twice is harmless.
    live.runtime.start();
    live.runtime.start();
    expect(live.frames.pending()).toBe(true);
  });

  it("re-arms the loop even when a frame throws", () => {
    const canvas = createCanvas(1, 1) as unknown as HTMLCanvasElement;
    const events = new EventTarget();
    const frames = fakeFrames();
    let thrown = 0;
    const runtime = createRuntime<null>({
      canvas,
      width: STAGE_W,
      height: STAGE_H,
      background: "#000",
      surface: {
        cssWidth: () => 800,
        cssHeight: () => 600,
        dpr: () => 1,
        events: () => events,
      },
      audioContext: () => null,
      game: {
        initialize: () => null,
        update: () => {
          thrown += 1;
          throw new Error("one bad frame");
        },
        render: () => undefined,
      },
    });
    try {
      runtime.initialize();
      runtime.start();
      expect(() => frames.pump(16)).toThrow(/one bad frame/);
      expect(thrown).toBe(1);
      expect(frames.pending()).toBe(true);
    } finally {
      runtime.destroy();
      frames.restore();
    }
  });

  it("toggles the overlay on the backtick key, and on nothing else", () => {
    live = stand();
    live.runtime.initialize();
    expect(live.runtime.diagnostics.visible()).toBe(false);
    live.events.dispatchEvent(keyEvent(OVERLAY_KEY));
    expect(live.runtime.diagnostics.visible()).toBe(true);
    live.events.dispatchEvent(keyEvent("KeyM"));
    expect(live.runtime.diagnostics.visible()).toBe(true);
    live.events.dispatchEvent(keyEvent(OVERLAY_KEY));
    expect(live.runtime.diagnostics.visible()).toBe(false);
    // An auto-repeat is not a fresh press.
    live.events.dispatchEvent(keyEvent(OVERLAY_KEY, true));
    expect(live.runtime.diagnostics.visible()).toBe(false);
  });

  it("drops every listener on destroy, and refuses to come back", () => {
    live = stand();
    live.runtime.initialize();
    live.runtime.start();
    live.runtime.destroy();
    live.runtime.destroy();
    expect(live.frames.pending()).toBe(false);
    live.events.dispatchEvent(keyEvent(OVERLAY_KEY));
    expect(live.runtime.diagnostics.visible()).toBe(false);
    expect(() => live?.runtime.initialize()).toThrow(/destroyed/);
    // And an advance after a destroy runs nothing.
    const updates = live.log.updates.length;
    live.runtime.advance(1, 1);
    expect(live.log.updates.length).toBe(updates);
  });

  it("throws a useful error where there is no frame loop to arm", () => {
    const globals = globalThis as unknown as Record<string, unknown>;
    const previous = globals.requestAnimationFrame;
    delete globals.requestAnimationFrame;
    const canvas = createCanvas(1, 1) as unknown as HTMLCanvasElement;
    const events = new EventTarget();
    const runtime = createRuntime<null>({
      canvas,
      width: STAGE_W,
      height: STAGE_H,
      background: "#000",
      surface: {
        cssWidth: () => 800,
        cssHeight: () => 600,
        dpr: () => 1,
        events: () => events,
      },
      audioContext: () => null,
      game: {
        initialize: () => null,
        update: () => undefined,
        render: () => undefined,
      },
    });
    try {
      runtime.initialize();
      expect(() => runtime.start()).toThrow(/no requestAnimationFrame/);
    } finally {
      runtime.destroy();
      if (previous !== undefined) globals.requestAnimationFrame = previous;
    }
  });

  it("recovers from an element that has not laid out yet", () => {
    const size: { css: [number, number] } = { css: [0, 0] };
    const canvas = createCanvas(1, 1) as unknown as HTMLCanvasElement;
    const events = new EventTarget();
    const frames = fakeFrames();
    const log: Log = {
      updates: [],
      renders: 0,
      registered: new Map(),
      defined: [],
      sources: [],
    };
    const runtime = createRuntime<{ time: number }>({
      canvas,
      width: STAGE_W,
      height: STAGE_H,
      game: probe(log),
      background: "#000",
      surface: {
        cssWidth: () => size.css[0],
        cssHeight: () => size.css[1],
        dpr: () => 1,
        events: () => events,
      },
      audioContext: () => null,
    });
    try {
      runtime.initialize();
      expect(runtime.viewport().scale).toBe(0);
      runtime.advance(1 / 60, 1);
      size.css = [1280, 720];
      runtime.advance(1 / 60, 1);
      expect(runtime.viewport().scale).toBe(1);
    } finally {
      runtime.destroy();
      frames.restore();
    }
  });

  it("plays a cue through its bus, and reports what it has started", () => {
    live = stand();
    live.runtime.initialize();
    expect(live.runtime.audio.defined("blip")).toBe(true);
    // The context source hands back nothing, so a play is silent and safe.
    expect(live.runtime.audio.startedSources()).toBe(0);
  });

  it("draws the overlay over the finished frame", () => {
    live = stand();
    live.runtime.initialize();
    live.runtime.diagnostics.toggle();
    live.runtime.advance(1 / 60, 1);
    expect(live.log.renders).toBe(1);
    expect(live.runtime.diagnostics.visible()).toBe(true);
  });

  it("throws where the canvas has no 2D context at all", () => {
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => null,
    } as unknown as HTMLCanvasElement;
    const events = new EventTarget();
    const frames = fakeFrames();
    const runtime = createRuntime<null>({
      canvas,
      width: STAGE_W,
      height: STAGE_H,
      background: "#000",
      surface: {
        cssWidth: () => 800,
        cssHeight: () => 600,
        dpr: () => 1,
        events: () => events,
      },
      audioContext: () => null,
      game: {
        initialize: () => null,
        update: () => undefined,
        render: () => undefined,
      },
    });
    try {
      runtime.initialize();
      expect(() => runtime.advance(1 / 60, 1)).toThrow(/no 2D context/);
    } finally {
      runtime.destroy();
      frames.restore();
    }
  });

  it("does not run a frame before the state exists", () => {
    live = stand();
    live.runtime.advance(1, 1);
    expect(live.log.updates).toEqual([]);
    expect(live.log.renders).toBe(0);
  });

  it("carries the audio bus and the overlay it built", () => {
    live = stand();
    expect(live.runtime.audio).toBeDefined();
    expect(live.runtime.diagnostics).toBeDefined();
    expect(vi.isMockFunction(live.runtime.advance)).toBe(false);
  });
});
