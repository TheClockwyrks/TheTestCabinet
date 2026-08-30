// Refract — the runtime the game stands on.
//
// This build runs on no engine, so the layer every browser game needs is part
// of it (specs/overview.md). This file is that layer's core, and it is
// deliberately sized for THIS game rather than for every 2D game: a frame
// loop, the canvas fit, and the wiring that hands the game a keyboard
// (`src/keyboard.ts`), a pointer in logical stage units (`src/pointer.ts`), an
// audio bus (`src/audio-bus.ts`), a viewport (`src/viewport.ts`), and an
// overlay (`src/overlay.ts`). There is no asset loader, because Refract loads
// nothing.
//
// THE CONTRACT is `Game<S, D>`: an `initialize` that runs once and returns the
// whole state beside the game's debug surface, then an `update(state, api,
// dt)` and a `render(state, api)` per frame, in that order. The state is a
// VALUE and the only channel between the three: the runtime hands `update` the
// current state and stores what it returns, and `render` draws that. Nothing
// in the game writes to a state it was handed.
//
// THE DELTA IS SECONDS, measured between consecutive frames and clamped at
// MAX_FRAME_SECONDS. Every rate in this game is per second and is integrated
// against it; nothing here imposes a timestep, and nothing counts frames as a
// unit of time.
//
// THE CLOCK CAN BE TAKEN AWAY. `setAutoStep(false)` stops the loop advancing
// the simulation from the wall clock and `advance(seconds, frames)` runs an
// exact number of whole frames at an exact delta, which is what
// `specs/instrumentation.md` exposes on `window.__refract` and what makes a
// driven scenario reproducible on any machine. Drawing is unaffected either
// way: the loop keeps presenting, so the canvas always shows the state the
// most recent frame left.

import { AudioBus, type AudioContextSource, type CueSpec } from "./audio-bus";
import { Keyboard, asKeyboardEvent } from "./keyboard";
import { Diagnostics, OVERLAY_KEY } from "./overlay";
import {
  claimGestures,
  Pointer,
  type PointerPosition,
  type PointerSample,
} from "./pointer";
import {
  clientToStage,
  deviceSize,
  domSurface,
  fitViewport,
  type Surface,
  type Viewport,
} from "./viewport";

/**
 * The largest delta a frame may be worth, in seconds.
 *
 * A backgrounded tab resumes with a gap measured in seconds, and a game asked
 * to integrate half a minute in one step is not the game the player left. The
 * clamp trades a moment of slow motion on resume for a simulation that
 * survives it.
 */
export const MAX_FRAME_SECONDS = 0.1;

/** The frame loop's position. `time` is the sum of the deltas actually run. */
export interface FrameInfo {
  /** Frames run since the runtime started. */
  count: number;
  /** Total simulated time, in seconds. */
  time: number;
  /** The delta the most recent frame was stepped by, in seconds. */
  dt: number;
}

/** What the game may reach while it initializes, once, before the first frame. */
export interface InitApi<S> {
  readonly input: {
    /** Bind an action name to the `KeyboardEvent.code` values that drive it. */
    register(name: string, keys: readonly string[]): void;
  };
  readonly audio: {
    /** Declare a synthesized cue under a name. */
    define(cue: string, spec: CueSpec): void;
  };
  readonly diagnostics: {
    /** Name a value for the overlay. The source is a pure read of the state
     * it is handed, called on every draw. */
    register(name: string, source: (state: S) => unknown): void;
  };
}

/**
 * What the game may reach while it updates. Nothing here draws, which is what
 * lets the simulation be stepped and read with no drawing taking part in the
 * result.
 */
export interface UpdateApi {
  readonly input: {
    /** Whether the action went down since the last frame. Consumes the edge. */
    pressed(name: string): boolean;
    /** The pointer's logical position and whether it is pressed, now. */
    pointer(): PointerPosition;
    /** This frame's pointer samples, in arrival order. Consumes them. */
    pointerSamples(): PointerSample[];
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
 * What the game may reach while it renders: the destination, already cleared
 * to the background and already carrying the logical transform. Nothing here
 * reads input or plays a cue, so what a frame does is decided entirely by its
 * update.
 */
export interface RenderApi {
  readonly ctx: CanvasRenderingContext2D;
}

/** The three functions, the state type, and the debug surface the game supplies. */
export interface Game<S, D> {
  /** Declare the bindings, cues and diagnostics, and build the whole state,
   * returned beside the game's debug surface. */
  initialize(api: InitApi<S>): [S, D];
  /** The next state, advanced by `dt` seconds from the current one. */
  update(state: S, api: UpdateApi, dt: number): S;
  /** Draw the state the update left behind. */
  render(state: S, api: RenderApi): void;
}

/** What `createRuntime` is handed. */
export interface RuntimeOptions<S, D> {
  /** The canvas the runtime sizes, clears, and renders through. */
  canvas: HTMLCanvasElement;
  /** The logical design width the game draws in. */
  width: number;
  /** The logical design height the game draws in. */
  height: number;
  /** The game this runtime drives, bound for its lifetime. */
  game: Game<S, D>;
  /** The CSS color the whole canvas is cleared to before every frame. */
  background: string;
  /** Where size, position, pixel density and events come from; defaults to the DOM. */
  surface?: Surface;
  /** Where the audio bus gets its context; defaults to the platform's. */
  audioContext?: AudioContextSource;
}

/** The runtime, as the build holds it. */
export interface Runtime<S, D> {
  /** The state the most recent frame or pose left. Throws before `initialize`. */
  readonly state: S;
  /** The debug surface the game's `initialize` returned. Throws before then. */
  readonly debug: D;
  /** Build the state, arm the listeners, and fit the canvas. Runs no frame. */
  initialize(): S;
  /** Replace the state with what `pose` returns for it. No frame runs. */
  apply(pose: (state: S) => S): void;
  /** Start the frame loop. */
  start(): void;
  /** Stop the frame loop. The state is left exactly as the last frame left it. */
  stop(): void;
  /** Whether the loop advances the simulation from the wall clock. */
  autoStep(): boolean;
  /** Take the game off the wall clock, or give it back. */
  setAutoStep(enabled: boolean): void;
  /**
   * Run `frames` whole frames covering `seconds` of game time, each worth
   * `seconds / frames`, immediately and in order. Each is a real frame — the
   * same update the loop runs, then a render.
   */
  advance(seconds: number, frames?: number): void;
  /** The frame counter, the simulated time, and the most recent delta. */
  frame(): FrameInfo;
  /** The current logical-to-device fit. */
  viewport(): Viewport;
  /** Halt the loop, drop every listener, and release the canvas. */
  destroy(): void;
}

/**
 * Build the runtime over `canvas` and bind it to one game.
 *
 * Nothing the game supplies runs here: `initialize` is a separate call, so a
 * caller can take the game off the clock before it has run a single frame.
 */
export function createRuntime<S, D>(
  options: RuntimeOptions<S, D>,
): Runtime<S, D> {
  const { canvas, width, height, game, background } = options;
  const surface = options.surface ?? domSurface(canvas);
  const keyboard = new Keyboard(surface.events());
  const pointer = new Pointer(
    surface.events(),
    (clientX, clientY) =>
      clientToStage(viewport, surface.origin(), surface.dpr(), clientX, clientY),
    canvas,
  );
  // The browser's own gestures on the canvas belong to the game while it runs:
  // without the claim a touch drag is taken for a pan and cancelled part way
  // through, and the secondary button opens a menu over the board
  // (specs/controls.md, The pointer).
  const releaseGestures = claimGestures(canvas);
  const audio = new AudioBus(options.audioContext);
  const diagnostics = new Diagnostics<S>();

  let live: { state: S; debug: D } | null = null;
  let viewport = fit();
  let context: CanvasRenderingContext2D | null = null;

  let count = 0;
  let time = 0;
  let dt = 0;

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
   * depends on the element's size, on the device pixel ratio, and on the
   * logical stage; re-deriving it costs three reads, while a listener would
   * have to be armed, disarmed, and kept in step with the ratio changing under
   * a window dragged between displays.
   */
  function syncCanvas(): void {
    const dpr = surface.dpr();
    const deviceW = deviceSize(surface.cssWidth(), dpr);
    const deviceH = deviceSize(surface.cssHeight(), dpr);
    // Assigning either dimension clears the canvas and resets the context
    // state, so both are written only when they actually changed.
    if (canvas.width !== deviceW) canvas.width = deviceW;
    if (canvas.height !== deviceH) canvas.height = deviceH;
    viewport = fit();
  }

  function drawingContext(): CanvasRenderingContext2D {
    context ??= canvas.getContext("2d");
    if (context === null) {
      throw new Error("Refract: the canvas has no 2D context");
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

  const updateApi: UpdateApi = {
    input: {
      pressed: (name) => keyboard.pressed(name),
      pointer: () => pointer.current(),
      pointerSamples: () => pointer.samples(),
    },
    audio: {
      play: (cue) => audio.play(cue),
      setMuted: (muted) => audio.setMuted(muted),
      muted: () => audio.muted(),
    },
  };

  const initApi: InitApi<S> = {
    input: { register: (name, keys) => keyboard.register(name, keys) },
    audio: { define: (cue, spec) => audio.define(cue, spec) },
    diagnostics: {
      register: (name, source) => diagnostics.register(name, source),
    },
  };

  /** One whole frame: update by `seconds`, then draw what it left. */
  function runFrame(seconds: number): void {
    const held = live;
    if (held === null) return;
    count += 1;
    time += seconds;
    dt = seconds;

    const ctx = openFrame();
    try {
      held.state = game.update(held.state, updateApi, seconds);
      game.render(held.state, { ctx });
      // Drawn after the game and through the same context, with the transform
      // reset: the panel is chrome over the finished picture, not part of it.
      diagnostics.draw(ctx, { count, dt }, held.state);
    } finally {
      // Input nothing consumed is discarded even when the frame threw, so one
      // bad frame cannot leave a press to surface later, out of order.
      keyboard.endFrame();
      pointer.endFrame();
    }
  }

  /**
   * Redraw the state the last frame left, advancing nothing.
   *
   * What the loop does while the game is off the wall clock. Input edges and
   * pointer samples are deliberately NOT discarded here: a press made between
   * two `advance` calls belongs to the next frame that actually runs, and
   * dropping it would make what a driven scenario sees depend on how many
   * times the browser happened to repaint.
   */
  function present(): void {
    if (live === null) return;
    const ctx = openFrame();
    game.render(live.state, { ctx });
    diagnostics.draw(ctx, { count, dt }, live.state);
  }

  /** This tick's delta in seconds: never negative, never past the clamp. */
  function measure(nowMs: number): number {
    const previous = previousMs;
    previousMs = nowMs;
    // The first tick is worth nothing: a delta is measured between two frames,
    // and there is no earlier frame to measure from.
    if (previous === null) return 0;
    const elapsed = (nowMs - previous) / 1000;
    if (!(elapsed > 0)) return 0;
    return Math.min(elapsed, MAX_FRAME_SECONDS);
  }

  function pump(nowMs: number): void {
    handle = null;
    if (!running) return;
    try {
      // The wall clock is read on every tick, stepping or not, so giving the
      // game back its clock does not hand it the whole interval it spent
      // paused.
      const elapsed = measure(nowMs);
      if (stepping) runFrame(elapsed);
      else present();
    } finally {
      // Re-armed in `finally`, so a throw out of the game surfaces where it is
      // visible instead of freezing the game forever on one bad frame.
      if (running && handle === null) arm();
    }
  }

  function arm(): void {
    if (typeof globalThis.requestAnimationFrame !== "function") {
      throw new Error(
        "Refract: this environment has no requestAnimationFrame; drive the game with advance() instead",
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

  function held(): { state: S; debug: D } {
    if (live === null) {
      throw new Error("Refract: the runtime has not initialized yet");
    }
    return live;
  }

  return {
    get state(): S {
      return held().state;
    },

    get debug(): D {
      return held().debug;
    },

    initialize(): S {
      if (destroyed) {
        throw new Error("Refract: this runtime has been destroyed");
      }
      if (live !== null) return live.state;
      audio.armUnlock(surface.events());
      surface.events().addEventListener("keydown", onOverlayKey);
      syncCanvas();
      const [state, debug] = game.initialize(initApi);
      live = { state, debug };
      return state;
    },

    apply(pose: (state: S) => S): void {
      const current = held();
      current.state = pose(current.state);
    },

    start(): void {
      if (running || destroyed) return;
      running = true;
      // Dropped, so the first tick after a start measures from that tick
      // rather than from whenever the loop last stopped.
      previousMs = null;
      arm();
    },

    stop: stopLoop,

    autoStep: () => stepping,

    setAutoStep(enabled: boolean): void {
      stepping = enabled;
    },

    advance(seconds: number, frames = 1): void {
      if (!Number.isFinite(seconds) || seconds < 0) {
        throw new RangeError(
          `Refract: advance() needs a finite, non-negative number of seconds, got ${seconds}`,
        );
      }
      if (!Number.isInteger(frames) || frames < 1) {
        throw new RangeError(
          `Refract: advance() needs a whole, positive frame count, got ${frames}`,
        );
      }
      const step = seconds / frames;
      for (let i = 0; i < frames; i += 1) runFrame(step);
    },

    frame: () => ({ count, time, dt }),

    viewport: () => viewport,

    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      stopLoop();
      surface.events().removeEventListener("keydown", onOverlayKey);
      keyboard.detach();
      pointer.detach();
      releaseGestures();
      audio.dispose();
      live = null;
    },
  };
}
