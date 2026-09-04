// Fathom — the runtime the game stands on.
//
// This build runs on no engine, so the layer every browser game needs is part of
// it (`specs/overview.md`). This file is that layer's core, and it is
// deliberately sized for THIS game rather than for every 2D game: a
// fixed-timestep frame loop, the canvas fit, and the wiring that hands the game
// a keyboard (`src/keyboard.ts`), an audio bus (`src/audio-bus.ts`), a viewport
// (`src/viewport.ts`), and a diagnostics overlay (`src/overlay.ts`). The image
// loader is a runtime module of its own (`src/images.ts`), because the art is
// loaded before the game is built rather than during a frame.
//
// THE CONTRACT is `Game<S>`: an `initialize` that runs once and returns the
// whole state, then a `tick(state, api, dt)` per simulation step and a
// `render(state, api)` per presented frame. The state is the only channel
// between the three.
//
// THE TIMESTEP IS FIXED. `specs/movement.md` fixes the simulation at TICK_HZ
// steps a second, so the loop measures the wall clock, accumulates it, and runs
// the whole TICK_DT ticks that elapsed time completes, carrying the remainder
// into the next frame. The number of ticks run over an interval of game time is
// therefore the same however that interval was divided into frames, and the
// renderer is handed the leftover as `alpha` so a body is drawn between the two
// states either side of the current instant.
//
// THE CLOCK CAN BE TAKEN AWAY. `setAutoStep(false)` stops the loop advancing the
// simulation from the wall clock and `advance(ticks)` runs an exact number of
// whole ticks, which is what `specs/instrumentation.md` exposes on
// `window.__fathom` and what makes a driven scenario reproducible on any
// machine. Drawing is unaffected either way: the loop keeps presenting, so the
// canvas always shows the state the most recent tick left.

import { AudioBus, type AudioContextSource, type CueSpec } from "./audio-bus";
import { Keyboard, asKeyboardEvent } from "./keyboard";
import { Diagnostics, OVERLAY_KEY } from "./overlay";
import { Pointer, type PointerSample } from "./pointer";
import {
  deviceSize,
  domSurface,
  fitViewport,
  type Surface,
  type Viewport,
} from "./viewport";

/**
 * The largest stretch of wall clock a single frame may hand the simulation, in
 * seconds.
 *
 * A backgrounded tab resumes with a gap measured in seconds, and a game asked to
 * catch up on half a minute of ticks in one frame stalls the page doing it. The
 * clamp trades a moment of slow motion on resume for a loop that survives it.
 */
export const MAX_FRAME_SECONDS = 0.25;

/** The loop's position. `time` is the sum of the ticks actually run. */
export interface TickInfo {
  /** Simulation ticks run since the runtime started. */
  count: number;
  /** Total simulated time, in seconds. */
  time: number;
}

/** What the game may reach while it initializes, once, before the first tick. */
export interface InitApi {
  readonly input: {
    /** Bind an action name to the `KeyboardEvent.code` values that drive it. */
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
 * What the game may reach while it ticks. Nothing here draws, which is what lets
 * the simulation be stepped and read with no drawing taking part in the result.
 */
export interface TickApi {
  readonly input: {
    /** Whether the action is held, as `1` or `0`. */
    value(name: string): number;
    /** Whether the action went down since the last tick. Consumes the edge. */
    pressed(name: string): boolean;
    /**
     * What the pointer did since the last tick, in arrival order and in logical
     * units. Reading does not consume the list; it is dropped at the tick's end.
     */
    pointer(): readonly PointerSample[];
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
 * the background and already carrying the logical transform, and how far past
 * the most recent tick the picture stands. Nothing here reads input or plays a
 * cue, so what a tick does is decided entirely by the tick.
 */
export interface RenderApi {
  readonly ctx: CanvasRenderingContext2D;
  /**
   * The fraction of a tick the wall clock has covered since the last one, in
   * `[0, 1)`. The renderer draws a moving body between where it stood at the
   * start of that tick and where it stands now, so motion is smooth even though
   * the simulation moves in whole steps. It is `0` whenever the game is off the
   * wall clock, so a posed scenario is drawn exactly as it was stepped.
   */
  readonly alpha: number;
}

/** The three functions and the state type the game supplies. */
export interface Game<S> {
  /** Declare the bindings, cues and diagnostics, and build the whole state. */
  initialize(api: InitApi): S;
  /** Advance the simulation by exactly one fixed tick of `dt` seconds. */
  tick(state: S, api: TickApi, dt: number): void;
  /** Draw the state the ticks left behind. */
  render(state: S, api: RenderApi): void;
}

/** What `createRuntime` is handed. */
export interface RuntimeOptions<S> {
  /** The canvas the runtime sizes, clears, and renders through. */
  canvas: HTMLCanvasElement;
  /** The logical design width the game draws in. */
  width: number;
  /** The logical design height the game draws in. */
  height: number;
  /** The length of one simulation tick, in seconds. */
  tickSeconds: number;
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
  /**
   * Run `ticks` whole simulation ticks immediately and in order, each worth
   * exactly one tick of game time, then redraw. Each is a real tick, the same
   * one the loop runs.
   */
  advance(ticks: number): void;
  /** The tick counter and the simulated time. */
  tick(): TickInfo;
  /** The current logical-to-device fit. */
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
  const { canvas, width, height, tickSeconds, game, background } = options;
  const surface = options.surface ?? domSurface(canvas);
  const keyboard = new Keyboard(surface.events());
  const pointer = new Pointer(
    surface.events(),
    () => viewport,
    () => surface.dpr(),
  );
  const audio = new AudioBus(options.audioContext);
  const diagnostics = new Diagnostics();

  let live: { value: S } | null = null;
  let viewport = fit();
  let context: CanvasRenderingContext2D | null = null;

  let count = 0;
  let time = 0;
  /** Wall-clock time measured but not yet spent on a whole tick, in seconds. */
  let carried = 0;

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
   * depends on the element's size, on the device pixel ratio, and on the logical
   * stage; re-deriving it costs three reads, while a listener would have to be
   * armed, disarmed, and kept in step with the ratio changing under a window
   * dragged between displays.
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
      throw new Error("Fathom: the canvas has no 2D context");
    }
    return context;
  }

  /** Clear to the background and install the logical transform. */
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

  const tickApi: TickApi = {
    input: {
      value: (name) => keyboard.value(name),
      pressed: (name) => keyboard.pressed(name),
      pointer: () => pointer.read(),
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

  /**
   * One whole simulation tick.
   *
   * Input edges are discarded at the END OF EVERY TICK rather than at the end of
   * every frame, because a frame may run two ticks or none: clearing per frame
   * would let one press be read by both ticks of a busy frame, and clearing on a
   * frame that ran no tick would swallow the press entirely.
   */
  function runTick(): void {
    const state = live;
    if (state === null) return;
    count += 1;
    time += tickSeconds;
    try {
      game.tick(state.value, tickApi, tickSeconds);
    } finally {
      keyboard.endTick();
      pointer.endTick();
    }
  }

  /** Draw the state the last tick left, advancing nothing. */
  function present(alpha: number): void {
    if (live === null) return;
    const ctx = openFrame();
    game.render(live.value, { ctx, alpha });
    // Drawn after the game and through the same context, with the transform
    // reset: the panel is chrome over the finished picture, not part of it.
    diagnostics.draw(ctx);
  }

  /** This frame's elapsed wall clock: never negative, never past the clamp. */
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
        carried += elapsed;
        while (carried >= tickSeconds) {
          carried -= tickSeconds;
          runTick();
        }
        present(carried / tickSeconds);
      } else {
        present(0);
      }
    } finally {
      // Re-armed in `finally`, so a throw out of the game surfaces where it is
      // visible instead of freezing the game forever on one bad frame.
      if (running && handle === null) arm();
    }
  }

  function arm(): void {
    if (typeof globalThis.requestAnimationFrame !== "function") {
      throw new Error(
        "Fathom: this environment has no requestAnimationFrame; drive the game with advance() instead",
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
        throw new Error("Fathom: the runtime has not initialized yet");
      }
      return live.value;
    },

    initialize(): S {
      if (destroyed) {
        throw new Error("Fathom: this runtime has been destroyed");
      }
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
      // The remainder belongs to the clock that measured it. Keeping it would
      // hand the first tick after the game is given its clock back a head start
      // it did not earn.
      carried = 0;
    },

    advance(ticks: number): void {
      if (!Number.isInteger(ticks) || ticks < 0) {
        throw new RangeError(
          `Fathom: advance() needs a whole, non-negative tick count, got ${ticks}`,
        );
      }
      for (let i = 0; i < ticks; i += 1) runTick();
      // The canvas reflects what was just run, so a driven scenario can be
      // watched and captured exactly as it is stepped.
      present(0);
    },

    tick: () => ({ count, time }),

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
