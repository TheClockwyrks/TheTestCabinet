// Floe — the runtime the game stands on.
//
// This build runs on no engine, so the layer every browser game needs is part of
// it (specs/overview.md). This file is that layer's core, sized for THIS game
// rather than for every 2D game: the frame loop and its fixed-tick accumulator,
// the canvas fit, and the wiring that hands the game a keyboard
// (`src/keyboard.ts`), an audio bus (`src/audio-bus.ts`), a viewport
// (`src/viewport.ts`) and an overlay (`src/overlay.ts`).
//
// THE CONTRACT is `Game<S>`: an `initialize` that runs once and returns the whole
// state, an `update(state, api, dt)` per TICK, and a `render(state, api)` per
// FRAME. The state is the only channel between the three.
//
// THE TIMESTEP IS FIXED (specs/overview.md). A frame reports how much time has
// elapsed; the accumulator below runs the whole `TICK_DT` ticks that elapsed time
// completes and carries the remainder into the next frame, so the number of ticks
// run over an interval of game time is the same however that interval was divided
// into frames. The leftover fraction is handed to `render` as `alpha`, which is
// what lets the renderer draw BETWEEN two ticks instead of snapping 120 times a
// second.
//
// THE CLOCK CAN BE TAKEN AWAY. `setAutoStep(false)` stops the loop advancing the
// simulation from the wall clock and `advance(ticks)` runs an exact number of
// whole ticks, which is what `specs/instrumentation.md` exposes on
// `window.__floe` and what makes a driven scenario reproducible on any machine.
// Drawing is unaffected either way: the loop keeps presenting, so the canvas
// always shows the state the most recent tick left.

import { TICK_DT } from "./constants";
import { AudioBus, type AudioContextSource, type CueSpec } from "./audio-bus";
import { Keyboard, asKeyboardEvent } from "./keyboard";
import { Diagnostics, OVERLAY_KEY } from "./overlay";
import { Pointer, type PointerEdge } from "./pointer";
import {
  deviceSize,
  domSurface,
  fitViewport,
  type Surface,
  type Viewport,
} from "./viewport";

/**
 * The most game time one frame may be worth, in seconds.
 *
 * A backgrounded tab resumes with a gap measured in seconds, and running
 * thousands of ticks in one frame to catch up would stall the page rather than
 * recover it. The clamp trades a moment of slow motion on resume for a simulation
 * that survives it.
 */
export const MAX_FRAME_SECONDS = 0.25;

/** Where the simulation's clock stands. */
export interface TickInfo {
  /** Ticks run since the runtime started. */
  count: number;
  /** Total simulated time, in seconds: `count * TICK_DT`. */
  time: number;
  /** The fraction of the next tick already elapsed, in `[0, 1)`. */
  alpha: number;
}

/** What the game may reach while it initializes, once, before the first tick. */
export interface InitApi {
  readonly input: {
    /** Bind an intent to the `KeyboardEvent.code` values that drive it. */
    register(name: string, keys: readonly string[]): void;
  };
  readonly audio: {
    /** Declare a synthesized cue under a name. */
    define(cue: string, spec: CueSpec): void;
  };
  readonly diagnostics: {
    /** Name a value for the overlay. The source is called on every draw. */
    register(name: string, source: () => unknown): void;
  };
}

/**
 * What the game may reach while it updates. Nothing here draws, which is what
 * lets the simulation be stepped and read with no drawing taking part in the
 * result.
 */
export interface UpdateApi {
  readonly input: {
    /** Whether the intent is being asked for, as `1` or `0`. */
    value(name: string): number;
    /** Whether the intent went down since the last tick. Consumes the edge. */
    pressed(name: string): boolean;
    /**
     * Every pointer and touch edge raised since the last tick, in the order the
     * browser raised them, in logical stage units.
     *
     * A list rather than an edge, because a gesture can be a landing, a travel
     * and a lift inside one tick and `specs/ui.md` decides a confirm from the
     * pair rather than from the last of them.
     */
    pointer(): readonly PointerEdge[];
  };
  readonly audio: {
    /** Play a declared cue. */
    play(cue: string): void;
    /** Mute or unmute the bus. */
    setMuted(muted: boolean): void;
    /** Whether the bus is muted. */
    muted(): boolean;
  };
}

/**
 * What the game may reach while it renders: the destination, already cleared to
 * the background and already carrying the stage transform, and how far into the
 * next tick the picture stands.
 */
export interface RenderApi {
  readonly ctx: CanvasRenderingContext2D;
  /** The fraction of the next tick already elapsed, for interpolation. */
  readonly alpha: number;
}

/** The three functions and the state type the game supplies. */
export interface Game<S> {
  /** Declare the bindings, cues and diagnostics, and build the whole state. */
  initialize(api: InitApi): S;
  /** Advance the simulation by exactly one tick of `dt` seconds. */
  update(state: S, api: UpdateApi, dt: number): void;
  /** Draw the state the ticks left behind. */
  render(state: S, api: RenderApi): void;
}

/** What `createRuntime` is handed. */
export interface RuntimeOptions<S> {
  /** The canvas the runtime sizes, clears, and renders through. */
  canvas: HTMLCanvasElement;
  /** The stage's logical width. */
  width: number;
  /** The stage's logical height. */
  height: number;
  /** The game this runtime drives, bound for its lifetime. */
  game: Game<S>;
  /** The CSS color the whole canvas, letterbox bars included, is cleared to. */
  background: string;
  /** Where size, pixel density and key events come from; defaults to the DOM. */
  surface?: Surface;
  /** Where the audio bus gets its context; defaults to the platform's. */
  audioContext?: AudioContextSource;
}

/** The runtime, as the build holds it. */
export interface Runtime<S> {
  /** The state `initialize` built, live. Throws before then. */
  readonly state: S;
  /** Build the state, arm the listeners, and fit the canvas. Runs no tick. */
  initialize(): S;
  /** Start the frame loop. */
  start(): void;
  /** Stop the frame loop. The state is left exactly as the last tick left it. */
  stop(): void;
  /** Whether the loop advances the simulation from the wall clock. */
  autoStep(): boolean;
  /** Take the game off the wall clock, or give it back. */
  setAutoStep(enabled: boolean): void;
  /** Run `ticks` whole simulation ticks immediately and in order, then present. */
  advance(ticks: number): void;
  /** The tick counter, the simulated time, and the interpolation fraction. */
  tick(): TickInfo;
  /** The current stage-to-device fit. */
  viewport(): Viewport;
  /** Halt the loop, drop every listener, and release the canvas. */
  destroy(): void;
}

/**
 * Build the runtime over `canvas` and bind it to one game.
 *
 * Nothing the game supplies runs here: `initialize` is a separate call, so a
 * caller can take the game off the clock before it has run a single tick.
 */
export function createRuntime<S>(options: RuntimeOptions<S>): Runtime<S> {
  const { canvas, width, height, game, background } = options;
  const surface = options.surface ?? domSurface(canvas);
  const keyboard = new Keyboard(surface.events());
  const pointer = new Pointer({
    bounds: () => surface.bounds?.() ?? { left: 0, top: 0 },
    dpr: () => surface.dpr(),
    viewport: () => viewport,
    events: () => surface.events(),
  });
  const audio = new AudioBus(options.audioContext);
  const diagnostics = new Diagnostics();

  let live: { value: S } | null = null;
  let viewport = fit();
  let context: CanvasRenderingContext2D | null = null;

  let count = 0;
  let carry = 0;

  let stepping = true;
  let running = false;
  let handle: number | null = null;
  let previousMs: number | null = null;
  let destroyed = false;

  function fit(): Viewport {
    return fitViewport(
      width,
      height,
      surface.cssWidth(),
      surface.cssHeight(),
      surface.dpr(),
    );
  }

  /**
   * Resize the backing store to the element's laid-out size and recompute the
   * fit.
   *
   * Run at the top of every frame rather than from a resize observer. The fit
   * depends on the element's size, on the device pixel ratio and on the stage;
   * re-deriving it costs three reads, while a listener would have to be armed,
   * disarmed, and kept in step with the ratio changing under a window dragged
   * between displays.
   */
  function syncCanvas(): void {
    const dpr = surface.dpr();
    const deviceW = deviceSize(surface.cssWidth(), dpr);
    const deviceH = deviceSize(surface.cssHeight(), dpr);
    // Assigning either dimension clears the canvas and resets the context state,
    // so both are written only when they actually changed.
    if (canvas.width !== deviceW) canvas.width = deviceW;
    if (canvas.height !== deviceH) canvas.height = deviceH;
    viewport = fit();
  }

  function drawingContext(): CanvasRenderingContext2D {
    context ??= canvas.getContext("2d");
    if (context === null) {
      throw new Error("Floe: the canvas has no 2D context");
    }
    return context;
  }

  /** Clear to the background and install the stage transform. */
  function openFrame(): CanvasRenderingContext2D {
    syncCanvas();
    const ctx = drawingContext();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(
      viewport.scale,
      0,
      0,
      viewport.scale,
      viewport.offsetX,
      viewport.offsetY,
    );
    return ctx;
  }

  const updateApi: UpdateApi = {
    input: {
      value: (name) => keyboard.value(name),
      pressed: (name) => keyboard.pressed(name),
      pointer: () => pointer.samples(),
    },
    audio: {
      play: (cue) => audio.play(cue),
      setMuted: (muted) => audio.setMuted(muted),
      muted: () => audio.muted(),
    },
  };

  const initApi: InitApi = {
    input: { register: (name, keys) => keyboard.register(name, keys) },
    audio: { define: (cue, spec) => audio.define(cue, spec) },
    diagnostics: {
      register: (name, source) => diagnostics.register(name, source),
    },
  };

  /** One simulation tick, of exactly `TICK_DT`. */
  function runTick(): void {
    const state = live;
    if (state === null) return;
    count += 1;
    try {
      game.update(state.value, updateApi, TICK_DT);
    } finally {
      // An edge nothing consumed is discarded even when the tick threw, so one
      // bad tick cannot leave a press to surface later, out of order. The
      // pointer's queue goes the same way and for the same reason.
      keyboard.endTick();
      pointer.endTick();
    }
  }

  /** Draw the state the ticks left, `carry` of a tick into the next one. */
  function present(): void {
    if (live === null) return;
    const ctx = openFrame();
    game.render(live.value, { ctx, alpha: carry / TICK_DT });
    // Drawn after the game and through the same context, with the transform
    // reset: the panel is chrome over the finished picture, not part of it.
    diagnostics.draw(ctx, { count, time: count * TICK_DT });
  }

  /** This frame's elapsed time in seconds: never negative, never past the clamp. */
  function measure(nowMs: number): number {
    const previous = previousMs;
    previousMs = nowMs;
    // The first frame is worth nothing: elapsed time is measured between two
    // frames, and there is no earlier frame to measure from.
    if (previous === null) return 0;
    const elapsed = (nowMs - previous) / 1000;
    if (!(elapsed > 0)) return 0;
    return Math.min(elapsed, MAX_FRAME_SECONDS);
  }

  function pump(nowMs: number): void {
    handle = null;
    if (!running) return;
    try {
      // The wall clock is read on every frame, stepping or not, so giving the
      // game back its clock does not hand it the whole interval it spent paused.
      const elapsed = measure(nowMs);
      if (stepping) {
        carry += elapsed;
        while (carry >= TICK_DT) {
          carry -= TICK_DT;
          runTick();
        }
      }
      present();
    } finally {
      // Re-armed in `finally`, so a throw out of the game surfaces where it is
      // visible instead of freezing the game forever on one bad frame.
      if (running && handle === null) arm();
    }
  }

  function arm(): void {
    if (typeof globalThis.requestAnimationFrame !== "function") {
      throw new Error(
        "Floe: this environment has no requestAnimationFrame; drive the game with advance() instead",
      );
    }
    handle = globalThis.requestAnimationFrame(pump);
  }

  /** Halt the loop and cancel any frame already asked for. */
  function stopLoop(): void {
    running = false;
    if (handle === null) return;
    if (typeof globalThis.cancelAnimationFrame === "function") {
      globalThis.cancelAnimationFrame(handle);
    }
    handle = null;
  }

  const onOverlayKey = (event: Event): void => {
    const key = asKeyboardEvent(event);
    if (key === null || key.code !== OVERLAY_KEY) return;
    diagnostics.toggle();
  };

  return {
    get state(): S {
      if (live === null) {
        throw new Error("Floe: the runtime has not initialized yet");
      }
      return live.value;
    },

    initialize(): S {
      if (destroyed) throw new Error("Floe: this runtime has been destroyed");
      if (live !== null) return live.value;
      audio.armUnlock(surface.events());
      surface.events().addEventListener("keydown", onOverlayKey);
      syncCanvas();
      live = { value: game.initialize(initApi) };
      return live.value;
    },

    start(): void {
      if (running || destroyed) return;
      running = true;
      // Dropped, so the first frame after a start measures from that frame
      // rather than from whenever the loop last stopped.
      previousMs = null;
      arm();
    },

    stop: stopLoop,

    autoStep: () => stepping,

    setAutoStep(enabled: boolean): void {
      stepping = enabled;
    },

    advance(ticks: number): void {
      if (!Number.isInteger(ticks) || ticks < 0) {
        throw new RangeError(
          `Floe: advance() needs a whole, non-negative number of ticks, got ${ticks}`,
        );
      }
      for (let i = 0; i < ticks; i += 1) runTick();
      // The picture is left showing what the ticks produced, so a driven scenario
      // can be looked at as well as read.
      if (typeof canvas.getContext === "function") present();
    },

    tick: () => ({ count, time: count * TICK_DT, alpha: carry / TICK_DT }),

    viewport: () => viewport,

    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      stopLoop();
      surface.events().removeEventListener("keydown", onOverlayKey);
      keyboard.detach();
      pointer.detach();
      audio.dispose();
      live = null;
    },
  };
}
