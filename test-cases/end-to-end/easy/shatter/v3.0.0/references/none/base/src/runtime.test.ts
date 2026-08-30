// The runtime layer, driven the way a browser drives it.
//
// This build stands on no engine, so the frame loop, the canvas fit, the
// keyboard wiring and the manual clock are deliverables of the build and are
// checked here directly. The loop is driven through a stand-in
// `requestAnimationFrame` and a {@link Surface} of the test's own, so a frame is
// an exact number of milliseconds and nothing waits on a real one; the canvas is
// a real 2D context from `@napi-rs/canvas`, so what the loop clears and hands the
// game is what a browser would hand it.

import { createCanvas } from "@napi-rs/canvas";
import { afterEach, describe, expect, it } from "vitest";

import { FIELD_H, FIELD_W, TICK_DT } from "./constants";
import { game } from "./game";
import { OVERLAY_KEY } from "./overlay";
import { MAX_FRAME_SECONDS, createRuntime } from "./runtime";
import { COLOR } from "./theme";
import type { ShatterState } from "./types";
import { domSurface, type Surface } from "./viewport";

/** A key event as the page delivers one; narrowed structurally by the runtime. */
function keyEvent(type: string, code: string): Event {
  return Object.assign(new Event(type), { code, repeat: false });
}

/** A stand-in for the browser's frame scheduler. */
class FrameClock {
  private pending: ((nowMs: number) => void) | null = null;
  private nowMs = 0;
  private readonly previous: {
    request: typeof globalThis.requestAnimationFrame | undefined;
    cancel: typeof globalThis.cancelAnimationFrame | undefined;
  };

  constructor() {
    const host = globalThis as unknown as Record<string, unknown>;
    this.previous = {
      request: globalThis.requestAnimationFrame,
      cancel: globalThis.cancelAnimationFrame,
    };
    host.requestAnimationFrame = (
      callback: (nowMs: number) => void,
    ): number => {
      this.pending = callback;
      return 1;
    };
    host.cancelAnimationFrame = (): void => {
      this.pending = null;
    };
  }

  /** Whether a frame has been asked for. */
  armed(): boolean {
    return this.pending !== null;
  }

  /** Deliver the frame that was asked for, `ms` milliseconds later. */
  tick(ms: number): void {
    const callback = this.pending;
    this.pending = null;
    this.nowMs += ms;
    callback?.(this.nowMs);
  }

  /** Put the platform's own scheduler back. */
  restore(): void {
    const host = globalThis as unknown as Record<string, unknown>;
    host.requestAnimationFrame = this.previous.request;
    host.cancelAnimationFrame = this.previous.cancel;
  }
}

/** A runtime over a real 2D context, a stand-in surface, and no audio. */
function stand(
  options: { cssWidth?: number; cssHeight?: number; dpr?: number } = {},
) {
  const canvas = createCanvas(1, 1) as unknown as HTMLCanvasElement;
  const events = new EventTarget();
  const surface: Surface = {
    cssWidth: () => options.cssWidth ?? 1280,
    cssHeight: () => options.cssHeight ?? 720,
    dpr: () => options.dpr ?? 1,
    events: () => events,
  };
  const runtime = createRuntime<ShatterState>({
    canvas,
    width: FIELD_W,
    height: FIELD_H,
    game,
    background: COLOR.bg,
    surface,
    // No Web Audio in Node: the bus degrades to silence, which is what
    // `specs/audio.md` requires of a build with no audio available.
    audioContext: () => null,
  });
  const frames = new FrameClock();
  return { canvas, events, surface, runtime, frames };
}

let clock: FrameClock | null = null;

afterEach(() => {
  clock?.restore();
  clock = null;
});

describe("the frame loop", () => {
  it("builds the state without running a tick", () => {
    const { runtime, frames } = stand();
    clock = frames;
    const state = runtime.initialize();
    expect(state.screen).toBe("title");
    expect(state.simTime).toBe(0);
    expect(runtime.frame().count).toBe(0);
    runtime.destroy();
  });

  it("throws rather than reporting a state it has not built", () => {
    const { runtime, frames } = stand();
    clock = frames;
    expect(() => runtime.state).toThrow(/has not initialized/);
    runtime.destroy();
  });

  it("measures a frame against the one before it, so the first is worth nothing", () => {
    const { runtime, frames } = stand();
    clock = frames;
    const state = runtime.initialize();
    runtime.start();
    frames.tick(16);
    expect(state.simTime).toBe(0);
    frames.tick(1000 / 60);
    expect(runtime.frame().count).toBeGreaterThan(0);
    expect(state.simTime).toBeCloseTo(runtime.frame().count * TICK_DT, 9);
    runtime.destroy();
  });

  it("carries the remainder of a frame into the next one", () => {
    const { runtime, frames } = stand();
    clock = frames;
    const state = runtime.initialize();
    runtime.start();
    frames.tick(0);
    // A tenth of a tick, twelve times over, is one whole tick and no more.
    for (let i = 0; i < 12; i += 1) frames.tick(1000 / 1200);
    expect(runtime.frame().count).toBe(1);
    expect(state.simTime).toBeCloseTo(TICK_DT, 9);
    runtime.destroy();
  });

  it("clamps the gap a backgrounded tab resumes with", () => {
    const { runtime, frames } = stand();
    clock = frames;
    runtime.initialize();
    runtime.start();
    frames.tick(0);
    frames.tick(60_000);
    expect(runtime.frame().dt).toBeCloseTo(MAX_FRAME_SECONDS, 9);
    expect(runtime.frame().count).toBeLessThanOrEqual(
      Math.ceil(MAX_FRAME_SECONDS / TICK_DT),
    );
    runtime.destroy();
  });

  it("keeps asking for the next frame, and stops when it is stopped", () => {
    const { runtime, frames } = stand();
    clock = frames;
    runtime.initialize();
    runtime.start();
    expect(frames.armed()).toBe(true);
    frames.tick(16);
    expect(frames.armed()).toBe(true);
    runtime.stop();
    frames.tick(16);
    expect(frames.armed()).toBe(false);
    runtime.destroy();
  });
});

describe("the manual clock", () => {
  it("stops advancing the simulation while it is held, and draws on", () => {
    const { runtime, frames } = stand();
    clock = frames;
    const state = runtime.initialize();
    runtime.setAutoStep(false);
    expect(runtime.autoStep()).toBe(false);
    runtime.start();
    for (let i = 0; i < 40; i += 1) frames.tick(16);
    expect(state.simTime).toBe(0);
    expect(runtime.frame().count).toBe(0);

    runtime.setAutoStep(true);
    frames.tick(16);
    frames.tick(16);
    expect(runtime.frame().count).toBeGreaterThan(0);
    runtime.destroy();
  });

  it("runs exactly the ticks it is asked for, and none for zero", () => {
    const { runtime, frames } = stand();
    clock = frames;
    const state = runtime.initialize();
    runtime.setAutoStep(false);
    runtime.advance(0);
    expect(state.simTime).toBe(0);
    expect(runtime.frame().count).toBe(0);

    runtime.advance(120);
    expect(runtime.frame().count).toBe(120);
    expect(state.simTime).toBeCloseTo(1, 9);
    runtime.destroy();
  });

  it("refuses a count that is not a whole, non-negative number of ticks", () => {
    const { runtime, frames } = stand();
    clock = frames;
    runtime.initialize();
    expect(() => runtime.advance(-1)).toThrow(RangeError);
    expect(() => runtime.advance(1.5)).toThrow(RangeError);
    runtime.destroy();
  });

  it("advances nothing before the state has been built", () => {
    const { runtime, frames } = stand();
    clock = frames;
    runtime.advance(10);
    expect(runtime.frame().count).toBe(0);
    runtime.destroy();
  });
});

describe("the canvas", () => {
  it("sizes the backing store from the surface and the pixel ratio", () => {
    const { canvas, runtime, frames } = stand({
      cssWidth: 800,
      cssHeight: 600,
      dpr: 2,
    });
    clock = frames;
    runtime.initialize();
    expect(canvas.width).toBe(1600);
    expect(canvas.height).toBe(1200);
    const view = runtime.viewport();
    expect(view.scale).toBeCloseTo((800 / FIELD_W) * 2, 9);
    expect(view.offsetY).toBeGreaterThan(0);
    runtime.destroy();
  });

  it("clears the letterbox bars to the field's own background", () => {
    const { canvas, runtime, frames } = stand({
      cssWidth: 800,
      cssHeight: 800,
      dpr: 1,
    });
    clock = frames;
    runtime.initialize();
    runtime.setAutoStep(false);
    runtime.advance(1);
    const ctx = (
      canvas as unknown as {
        getContext(kind: "2d"): {
          getImageData(
            x: number,
            y: number,
            w: number,
            h: number,
          ): { data: Uint8ClampedArray };
        };
      }
    ).getContext("2d");
    const bar = ctx.getImageData(4, 4, 1, 1).data;
    expect([bar[0], bar[1], bar[2]]).toEqual([5, 7, 14]);
    runtime.destroy();
  });
});

describe("the keyboard and the overlay", () => {
  it("hands the game the keys the page reports", () => {
    const { events, runtime, frames } = stand();
    clock = frames;
    const state = runtime.initialize();
    runtime.setAutoStep(false);
    // Two press edges on the title menu: down to the second entry and back.
    events.dispatchEvent(keyEvent("keydown", "ArrowDown"));
    runtime.advance(1);
    events.dispatchEvent(keyEvent("keyup", "ArrowDown"));
    expect(state.menuIndex).toBe(1);

    events.dispatchEvent(keyEvent("keydown", "ArrowUp"));
    runtime.advance(1);
    events.dispatchEvent(keyEvent("keyup", "ArrowUp"));
    expect(state.menuIndex).toBe(0);
    runtime.destroy();
  });

  it("discards an edge no tick consumed", () => {
    const { events, runtime, frames } = stand();
    clock = frames;
    const state = runtime.initialize();
    runtime.setAutoStep(false);
    events.dispatchEvent(keyEvent("keydown", "Enter"));
    events.dispatchEvent(keyEvent("keyup", "Enter"));
    runtime.advance(1);
    expect(state.screen).toBe("playing");

    // A second press with nothing to consume it is gone by the tick after.
    events.dispatchEvent(keyEvent("keydown", "KeyP"));
    events.dispatchEvent(keyEvent("keyup", "KeyP"));
    runtime.advance(1);
    expect(state.screen).toBe("paused");
    runtime.advance(1);
    expect(state.screen).toBe("paused");
    runtime.destroy();
  });

  it("shows and hides the overlay on the backtick key, changing no state", () => {
    const { events, runtime, frames } = stand();
    clock = frames;
    const state = runtime.initialize();
    runtime.setAutoStep(false);
    runtime.advance(1);
    const before = JSON.stringify(state);
    events.dispatchEvent(keyEvent("keydown", OVERLAY_KEY));
    runtime.advance(0);
    events.dispatchEvent(keyEvent("keydown", OVERLAY_KEY));
    expect(JSON.stringify(state)).toBe(before);
    runtime.destroy();
  });

  it("drops its listeners when it is destroyed", () => {
    const { events, runtime, frames } = stand();
    clock = frames;
    const state = runtime.initialize();
    runtime.setAutoStep(false);
    runtime.destroy();
    events.dispatchEvent(keyEvent("keydown", "Enter"));
    runtime.advance(1);
    expect(state.screen).toBe("title");
    // Destroying twice is a no-op, because teardown races.
    runtime.destroy();
    expect(() => runtime.initialize()).toThrow(/destroyed/);
  });
});

describe("the DOM surface", () => {
  it("reads the element's laid-out size and the window's pixel ratio", () => {
    const host = globalThis as unknown as Record<string, unknown>;
    const hadWindow = "window" in host;
    const hadDocument = "document" in host;
    const previousWindow = host.window;
    const previousDocument = host.document;
    const target = new EventTarget();
    host.window = { devicePixelRatio: 3 };
    host.document = target;
    try {
      const element = {
        clientWidth: 640,
        clientHeight: 360,
      } as unknown as HTMLCanvasElement;
      const surface = domSurface(element);
      expect(surface.cssWidth()).toBe(640);
      expect(surface.cssHeight()).toBe(360);
      expect(surface.dpr()).toBe(3);
      expect(surface.events()).toBe(target);
    } finally {
      if (hadWindow) host.window = previousWindow;
      else delete host.window;
      if (hadDocument) host.document = previousDocument;
      else delete host.document;
    }
  });
});
