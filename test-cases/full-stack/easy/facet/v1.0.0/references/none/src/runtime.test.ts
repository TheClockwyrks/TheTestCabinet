import { createCanvas } from "@napi-rs/canvas";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AssetStore, assetManifest, type AssetIo } from "./assets";
import { OVERLAY_KEY } from "./overlay";
import {
  MAX_FRAME_SECONDS,
  createRuntime,
  domScratchCanvas,
  type Game,
  type InitApi,
  type RenderApi,
  type Runtime,
  type UpdateApi,
} from "./runtime";
import type { Surface } from "./viewport";

/** A canvas the runtime can size and draw through, with no document behind it. */
function canvasElement(): HTMLCanvasElement {
  return createCanvas(16, 9) as unknown as HTMLCanvasElement;
}

/** A surface of a fixed size, with one event target the test dispatches at. */
function surfaceOf(
  events: EventTarget,
  cssWidth = 1280,
  cssHeight = 720,
  dpr = 1,
): Surface {
  return {
    cssWidth: () => cssWidth,
    cssHeight: () => cssHeight,
    dpr: () => dpr,
    origin: () => ({ left: 0, top: 0 }),
    events: () => events,
  };
}

/** A store whose files never arrive, and which counts what was asked for. */
function countingAssets(): { store: AssetStore; requests: () => number } {
  let requests = 0;
  const io: AssetIo = {
    image: () => {
      requests += 1;
      return new Promise(() => {});
    },
    json: () => {
      requests += 1;
      return new Promise(() => {});
    },
    bytes: () => {
      requests += 1;
      return new Promise(() => {});
    },
  };
  return {
    store: new AssetStore(io, assetManifest()),
    requests: () => requests,
  };
}

/** The state the test game carries, and the calls it recorded. */
interface Recorded {
  updates: number[];
  renders: number;
}

/** A game that records what the loop did to it. */
function recordingGame(log: Recorded): Game<number, { tag: string }> {
  return {
    initialize(api: InitApi<number>): [number, { tag: string }] {
      api.input.register("confirm", ["Enter"]);
      api.audio.define("ping", { layers: ["ping"] });
      api.diagnostics.register("value", (state) => state);
      return [0, { tag: "debug" }];
    },
    update(state: number, _api: UpdateApi, dt: number): number {
      log.updates.push(dt);
      return state + 1;
    },
    render(_state: number, _api: RenderApi): void {
      log.renders += 1;
    },
  };
}

/** A runtime over a recording game, already built but not initialized. */
function bench(options: { cssWidth?: number; dpr?: number } = {}) {
  const log: Recorded = { updates: [], renders: 0 };
  const events = new EventTarget();
  const assets = countingAssets();
  const runtime: Runtime<number, { tag: string }> = createRuntime({
    canvas: canvasElement(),
    width: 1280,
    height: 720,
    game: recordingGame(log),
    background: "#000",
    surface: surfaceOf(events, options.cssWidth ?? 1280, 720, options.dpr ?? 1),
    audioContext: () => null,
    assets: assets.store,
    scratch: (width, height) =>
      createCanvas(width, height).getContext(
        "2d",
      ) as unknown as CanvasRenderingContext2D,
  });
  return { runtime, log, events, assets };
}

/** A hand-driven `requestAnimationFrame`, so the loop runs on the test's clock. */
function stubRaf(): { tick: (nowMs: number) => void; canceled: number[] } {
  const pending: ((nowMs: number) => void)[] = [];
  const canceled: number[] = [];
  let next = 1;
  const handles = new Map<number, (nowMs: number) => void>();
  vi.stubGlobal("requestAnimationFrame", (callback: (now: number) => void) => {
    const handle = next++;
    handles.set(handle, callback);
    pending.push(callback);
    return handle;
  });
  vi.stubGlobal("cancelAnimationFrame", (handle: number) => {
    canceled.push(handle);
    handles.delete(handle);
  });
  return {
    canceled,
    tick(nowMs) {
      const callback = pending.shift();
      callback?.(nowMs);
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createRuntime", () => {
  it("refuses to hand over a state before it has initialized", () => {
    const { runtime } = bench();
    expect(() => runtime.state).toThrow(/has not initialized/);
    expect(() => runtime.debug).toThrow(/has not initialized/);
  });

  it("builds the state and the debug surface in one call, running no frame", () => {
    const { runtime, log } = bench();
    expect(runtime.initialize()).toBe(0);
    expect(runtime.debug).toEqual({ tag: "debug" });
    expect(log.updates).toEqual([]);
    expect(log.renders).toBe(0);
  });

  it("initializes once, however many times it is asked", () => {
    const { runtime } = bench();
    runtime.initialize();
    runtime.advance(0.1);
    expect(runtime.initialize()).toBe(1);
  });

  it("starts the produced files loading as it initializes", () => {
    const { runtime, assets } = bench();
    expect(assets.requests()).toBe(0);
    runtime.initialize();
    const manifest = assetManifest();
    expect(assets.requests()).toBe(
      Object.keys(manifest.images).length +
        Object.keys(manifest.systems).length +
        Object.keys(manifest.sounds).length,
    );
  });

  it("fits the stage into the surface, letterboxing the leftover", () => {
    const { runtime } = bench({ cssWidth: 1600 });
    runtime.initialize();
    const view = runtime.viewport();
    expect(view.scale).toBe(1);
    expect(view.offsetX).toBe(160);
  });

  it("runs whole frames at an exact delta on advance", () => {
    const { runtime, log } = bench();
    runtime.initialize();
    runtime.advance(1, 4);
    expect(log.updates).toEqual([0.25, 0.25, 0.25, 0.25]);
    expect(log.renders).toBe(4);
    expect(runtime.frame()).toEqual({ count: 4, time: 1, dt: 0.25 });
  });

  it("defaults advance to one frame", () => {
    const { runtime, log } = bench();
    runtime.initialize();
    runtime.advance(0.5);
    expect(log.updates).toEqual([0.5]);
  });

  it("refuses a nonsense advance rather than running a nonsense frame", () => {
    const { runtime } = bench();
    runtime.initialize();
    expect(() => runtime.advance(-1)).toThrow(RangeError);
    expect(() => runtime.advance(Number.NaN)).toThrow(RangeError);
    expect(() => runtime.advance(1, 0)).toThrow(RangeError);
    expect(() => runtime.advance(1, 1.5)).toThrow(RangeError);
  });

  it("advances nothing before it has initialized", () => {
    const { runtime, log } = bench();
    runtime.advance(1, 3);
    expect(log.updates).toEqual([]);
  });

  it("replaces the live state with what a pose returns", () => {
    const { runtime } = bench();
    runtime.initialize();
    runtime.apply((state) => state + 41);
    expect(runtime.state).toBe(41);
  });

  it("measures the delta between two ticks, and clamps a long gap", () => {
    const raf = stubRaf();
    const { runtime, log } = bench();
    runtime.initialize();
    runtime.start();
    raf.tick(1000);
    raf.tick(1016);
    raf.tick(9000);
    expect(log.updates[0]).toBe(0);
    expect(log.updates[1]).toBeCloseTo(0.016, 9);
    expect(log.updates[2]).toBe(MAX_FRAME_SECONDS);
  });

  it("keeps drawing but stops advancing once it is off the wall clock", () => {
    const raf = stubRaf();
    const { runtime, log } = bench();
    runtime.initialize();
    expect(runtime.autoStep()).toBe(true);
    runtime.setAutoStep(false);
    expect(runtime.autoStep()).toBe(false);
    runtime.start();
    raf.tick(1000);
    raf.tick(1016);
    expect(log.updates).toEqual([]);
    expect(log.renders).toBe(2);
    // `advance` still drives it, which is the whole point of taking the clock.
    runtime.advance(0.5);
    expect(log.updates).toEqual([0.5]);
  });

  it("stops the loop, and cancels the frame it had asked for", () => {
    const raf = stubRaf();
    const { runtime, log } = bench();
    runtime.initialize();
    runtime.start();
    runtime.start();
    raf.tick(1000);
    runtime.stop();
    expect(raf.canceled).toHaveLength(1);
    raf.tick(1016);
    expect(log.renders).toBe(1);
  });

  it("says so where there is no requestAnimationFrame to start on", () => {
    vi.stubGlobal("requestAnimationFrame", undefined);
    const { runtime } = bench();
    runtime.initialize();
    expect(() => runtime.start()).toThrow(/advance\(\)/);
  });

  it("toggles the diagnostics overlay on the backtick key", () => {
    const { runtime, events, log } = bench();
    runtime.initialize();
    runtime.advance(0.1);
    const before = log.renders;
    events.dispatchEvent(
      Object.assign(new Event("keydown"), { code: OVERLAY_KEY }),
    );
    // The panel is the runtime's, so the only observable effect is that the
    // frame after the toggle still draws without complaint.
    expect(() => runtime.advance(0.1)).not.toThrow();
    expect(log.renders).toBeGreaterThan(before);
  });

  it("drops every listener on destroy, and destroying twice is harmless", () => {
    const { runtime, events, log } = bench();
    runtime.initialize();
    runtime.destroy();
    runtime.destroy();
    events.dispatchEvent(
      Object.assign(new Event("keydown"), { code: OVERLAY_KEY }),
    );
    runtime.advance(1);
    expect(log.updates).toEqual([]);
    expect(() => runtime.initialize()).toThrow(/destroyed/);
  });

  it("will not start once destroyed", () => {
    stubRaf();
    const { runtime } = bench();
    runtime.initialize();
    runtime.destroy();
    runtime.start();
    expect(runtime.frame().count).toBe(0);
  });
});

describe("domScratchCanvas", () => {
  it("makes nothing where there is no document to make it in", () => {
    expect(domScratchCanvas()(10, 10)).toBeNull();
  });

  it("makes a detached canvas of whole pixels where there is one", () => {
    const made: HTMLCanvasElement[] = [];
    vi.stubGlobal("document", {
      createElement: () => {
        const canvas = createCanvas(1, 1) as unknown as HTMLCanvasElement;
        made.push(canvas);
        return canvas;
      },
    });
    const ctx = domScratchCanvas()(96.4, 0);
    expect(ctx).not.toBeNull();
    expect(made[0].width).toBe(96);
    expect(made[0].height).toBe(1);
  });
});
