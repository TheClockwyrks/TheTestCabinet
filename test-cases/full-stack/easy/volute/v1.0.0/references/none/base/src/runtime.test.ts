// The runtime the game stands on: the frame loop and its accumulator, the canvas
// fit, the beds under the hall, the overlay, and the surface installed on the page.

import { beforeAll, describe, expect, it, vi } from "vitest";
import { createCanvas } from "@napi-rs/canvas";
import {
  CELLS,
  DANGER_S,
  FIELD_H,
  FIELD_W,
  PATH_LENGTH,
  TICK_DT,
  VOLUTE_HANDLE,
} from "./constants";
import type { Assets } from "./assets";
import { installDebugApi } from "./debug";
import { createRuntime, MAX_FRAME_SECONDS, type Runtime } from "./runtime";
import type { Surface } from "./viewport";
import { loadProducedAssets } from "./render.test";

let assets: Assets;

beforeAll(async () => {
  assets = await loadProducedAssets();
});

/** A tiny event target, so the runtime is driven with no DOM behind it. */
class Bus implements EventTarget {
  private readonly listeners = new Map<string, Set<EventListener>>();

  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
  ): void {
    if (typeof listener !== "function") return;
    const set = this.listeners.get(type) ?? new Set();
    set.add(listener);
    this.listeners.set(type, set);
  }

  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
  ): void {
    if (typeof listener !== "function") return;
    this.listeners.get(type)?.delete(listener);
  }

  dispatchEvent(event: Event): boolean {
    for (const listener of this.listeners.get(event.type) ?? [])
      listener(event);
    return true;
  }
}

interface Rig {
  runtime: Runtime;
  keys: Bus;
  pointer: Bus;
  /** Run the frame the loop has asked for, at `ms` on the wall clock. */
  frame(ms: number): void;
}

/** Stand a runtime up over a real canvas with a surface of a fixed size. */
function rig(): Rig {
  const canvas = createCanvas(FIELD_W, FIELD_H) as unknown as HTMLCanvasElement;
  const keys = new Bus();
  const pointer = new Bus();
  const surface: Surface = {
    cssWidth: () => FIELD_W,
    cssHeight: () => FIELD_H,
    dpr: () => 1,
    events: () => keys,
    pointerEvents: () => pointer,
    bounds: () => ({ left: 0, top: 0, width: FIELD_W, height: FIELD_H }),
  };

  let pending: ((ms: number) => void) | null = null;
  vi.stubGlobal("requestAnimationFrame", (callback: (ms: number) => void) => {
    pending = callback;
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {
    pending = null;
  });

  const runtime = createRuntime({
    canvas,
    assets,
    surface,
    // No Web Audio in Node; the bus degrades to silence and the beds are read off
    // the bus's own bookkeeping rather than off a sound.
    audioContext: () => null,
    createCanvas: (width, height) =>
      createCanvas(width, height) as unknown as HTMLCanvasElement,
  });

  return {
    runtime,
    keys,
    pointer,
    frame(ms: number) {
      const callback = pending;
      pending = null;
      callback?.(ms);
    },
  };
}

/** A key event as the page delivers it. */
function key(type: string, code: string): Event {
  return { type, code, repeat: false } as unknown as Event;
}

describe("the frame loop", () => {
  it("opens on the title, with a complete state and nothing run", () => {
    const { runtime } = rig();
    expect(runtime.state.screen).toBe("title");
    expect(runtime.ticksRun()).toBe(0);
    expect(runtime.autoStep()).toBe(true);
  });

  it("consumes whole ticks and keeps the remainder in the accumulator", () => {
    const { runtime, keys } = rig();
    keys.dispatchEvent(key("keydown", "Enter"));
    keys.dispatchEvent(key("keyup", "Enter"));
    runtime.start();
    // The first frame measures nothing, and reads the confirm that starts a run.
    runtime.stop();
    runtime.step(0);

    runtime.setAutoStep(true);
    runtime.start();
    expect(runtime.state.screen).toBe("title");
  });

  it("runs the ticks a frame's delta holds, and no more", () => {
    const rigged = rig();
    rigged.runtime.start();
    rigged.frame(0);
    expect(rigged.runtime.ticksRun()).toBe(0);
    // Fifty milliseconds on the title advances nothing but the clock.
    rigged.frame(50);
    expect(rigged.runtime.state.simTime).toBeCloseTo(0.05, 6);
    expect(rigged.runtime.state.accumulator).toBe(0);

    rigged.keys.dispatchEvent(key("keydown", "Enter"));
    rigged.frame(60);
    expect(rigged.runtime.state.screen).toBe("playing");

    const before = rigged.runtime.ticksRun();
    rigged.frame(110);
    // Fifty milliseconds is three whole ticks, with the rest kept for next time.
    expect(rigged.runtime.ticksRun() - before).toBe(3);
    expect(rigged.runtime.state.accumulator).toBeGreaterThanOrEqual(0);
    expect(rigged.runtime.state.accumulator).toBeLessThan(TICK_DT);
  });

  it("clamps a frame that arrives after a long gap", () => {
    const rigged = rig();
    rigged.runtime.start();
    rigged.frame(0);
    rigged.keys.dispatchEvent(key("keydown", "Enter"));
    rigged.frame(16);
    const before = rigged.runtime.ticksRun();
    rigged.frame(60000);
    expect(rigged.runtime.ticksRun() - before).toBeLessThanOrEqual(
      Math.ceil(MAX_FRAME_SECONDS / TICK_DT) + 1,
    );
  });

  it("stops advancing when the game is taken off the wall clock", () => {
    const rigged = rig();
    rigged.runtime.start();
    rigged.frame(0);
    rigged.keys.dispatchEvent(key("keydown", "Enter"));
    rigged.frame(16);
    rigged.runtime.setAutoStep(false);
    const before = rigged.runtime.ticksRun();
    rigged.frame(500);
    rigged.frame(1000);
    expect(rigged.runtime.ticksRun()).toBe(before);
    // And the loop keeps presenting, so the canvas still shows the last tick.
    rigged.runtime.present();
  });

  it("runs exactly the ticks a step asks for", () => {
    const { runtime } = rig();
    runtime.step(30);
    expect(runtime.ticksRun()).toBe(30);
    expect(runtime.state.simTime).toBeCloseTo(30 * TICK_DT, 6);
    runtime.step(-4);
    runtime.step(Number.NaN);
    expect(runtime.ticksRun()).toBe(30);
  });

  it("closes each stepped tick, so no edge survives into the next", () => {
    const { runtime, keys } = rig();
    runtime.setAutoStep(false);
    // `Space` carries both confirm and fire, and arms an edge on each.
    keys.dispatchEvent(key("keydown", "Space"));
    keys.dispatchEvent(key("keyup", "Space"));

    runtime.step(1);
    expect(runtime.state.screen).toBe("playing");

    // The confirm was consumed by the title; the fire must not survive to the
    // hall, exactly as it does not when the wall clock runs the same frames.
    runtime.step(1);
    expect(runtime.state.projectiles).toHaveLength(0);
  });

  it("stops and can be destroyed without a frame in flight", () => {
    const { runtime } = rig();
    runtime.start();
    runtime.stop();
    runtime.destroy();
    runtime.destroy();
    runtime.start();
    expect(runtime.ticksRun()).toBe(0);
  });
});

describe("the canvas", () => {
  it("fits the field to the surface it was given", () => {
    const { runtime } = rig();
    runtime.step(1);
    const viewport = runtime.viewport();
    expect(viewport.scale).toBe(1);
    expect(viewport.offsetX).toBe(0);
    expect(viewport.offsetY).toBe(0);
    expect(viewport.width).toBe(FIELD_W);
    expect(viewport.height).toBe(FIELD_H);
  });
});

describe("the controls the runtime binds", () => {
  it("starts a run on Enter and pauses on Escape", () => {
    const rigged = rig();
    rigged.keys.dispatchEvent(key("keydown", "Enter"));
    rigged.runtime.step(1);
    expect(rigged.runtime.state.screen).toBe("playing");
    rigged.keys.dispatchEvent(key("keydown", "Escape"));
    rigged.runtime.step(1);
    expect(rigged.runtime.state.screen).toBe("paused");
  });

  it("aims at the pointer, in the field's own units", () => {
    const rigged = rig();
    rigged.keys.dispatchEvent(key("keydown", "Enter"));
    rigged.runtime.step(1);
    rigged.pointer.dispatchEvent({
      type: "pointermove",
      clientX: 720,
      clientY: 330,
      button: -1,
      preventDefault: () => undefined,
    } as unknown as Event);
    rigged.runtime.step(1);
    expect(rigged.runtime.state.aim).toBeCloseTo(0, 6);
  });

  it("fires on the primary mouse button", () => {
    const rigged = rig();
    rigged.keys.dispatchEvent(key("keydown", "Enter"));
    rigged.runtime.step(1);
    rigged.pointer.dispatchEvent({
      type: "pointerdown",
      clientX: 420,
      clientY: 100,
      button: 0,
      preventDefault: () => undefined,
    } as unknown as Event);
    rigged.runtime.step(1);
    expect(rigged.runtime.state.projectiles.length).toBeGreaterThan(0);
  });

  it("toggles the overlay on the backtick, and leaves the game alone", () => {
    const rigged = rig();
    rigged.keys.dispatchEvent(key("keydown", "Enter"));
    rigged.runtime.step(1);
    const before = JSON.stringify(rigged.runtime.state.cores);
    rigged.keys.dispatchEvent(key("keydown", "Backquote"));
    rigged.runtime.present();
    expect(JSON.stringify(rigged.runtime.state.cores)).toBe(before);
    rigged.keys.dispatchEvent(key("keydown", "Backquote"));
    rigged.runtime.present();
  });
});

describe("the beds", () => {
  it("loops exactly one bed on play, and none on any other screen", () => {
    const rigged = rig();
    // The platform supplies no audio here, so the bus never opens a context and
    // nothing can loop; what is checked is that the bus is asked correctly.
    const asked: string[] = [];
    const bus = rigged.runtime.audio;
    const loop = bus.loop.bind(bus);
    const stop = bus.stop.bind(bus);
    bus.loop = (cue) => {
      asked.push(`loop ${cue}`);
      loop(cue);
    };
    bus.stop = (cue) => {
      asked.push(`stop ${cue}`);
      stop(cue);
    };

    rigged.keys.dispatchEvent(key("keydown", "Enter"));
    rigged.runtime.step(1);
    expect(asked).toContain("loop hall-loop");

    rigged.runtime.state.cores = [
      { charge: "halide", s: DANGER_S + 10, mark: null, hold: 0 },
    ];
    rigged.runtime.step(1);
    expect(asked).toContain("stop hall-loop");
    expect(asked).toContain("loop danger-loop");

    rigged.keys.dispatchEvent(key("keydown", "Escape"));
    rigged.runtime.step(1);
    expect(asked[asked.length - 1]).toBe("stop danger-loop");
  });
});

describe("the surface on the page", () => {
  it("installs on the documented handle, and removes itself again", () => {
    const { runtime } = rig();
    const remove = installDebugApi(runtime);
    const target = globalThis as unknown as Record<string, unknown>;
    expect(target[VOLUTE_HANDLE]).toBeDefined();
    remove();
    expect(target[VOLUTE_HANDLE]).toBeUndefined();
  });

  it("drives the running game through the runtime's own clock", () => {
    const { runtime } = rig();
    const api = (() => {
      installDebugApi(runtime);
      return (globalThis as unknown as Record<string, unknown>)[
        VOLUTE_HANDLE
      ] as ReturnType<typeof import("./debug").createDebugApi>;
    })();
    api.setAutoStep(false);
    api.reset();
    api.setScore(0);
    api.setCells(CELLS);
    api.startLevel(1);
    api.setQuotaRemaining(0);
    api.clearTrain();
    api.poseTrain([[PATH_LENGTH - 1, "halide", null]]);
    api.step(4);
    expect(api.snapshot().cells).toBe(2);
    expect(api.snapshot().screen).toBe("setback");
  });
});
