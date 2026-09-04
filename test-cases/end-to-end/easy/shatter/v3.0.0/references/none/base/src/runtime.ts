// Shatter — the runtime the game stands on.
//
// This build runs on no engine, so the layer every browser game needs is part of
// it (`specs/overview.md`). This file is that layer's core, sized for THIS game
// rather than for every 2D game: a frame loop, the canvas fit, and the wiring
// that hands the game a keyboard (`src/keyboard.ts`), an audio bus
// (`src/audio-bus.ts`), a viewport (`src/viewport.ts`) and an overlay
// (`src/overlay.ts`). There is no asset loader, because Shatter loads nothing.
//
// THE CONTRACT is `Game<S>`: an `initialize` that runs once and returns the whole
// state, then per frame an `update(state, api, dt)` and a `render(state, api)`,
// in that order. The state is the only channel between the three.
//
// THE DELTA IS SECONDS AND THE GAME OWNS THE TIMESTEP. `specs/simulation.md` puts
// the fixed step inside the game — the runtime measures how much real time a
// frame covered, hands it over, and the game converts it into whole ticks and
// carries the remainder. So this file counts ticks but never decides what one is
// worth, and `advance(ticks)` asks the game for exactly that many.
//
// THE CLOCK CAN BE TAKEN AWAY. `setAutoStep(false)` stops the loop advancing the
// simulation from the wall clock and `advance(ticks)` runs an exact number of
// whole ticks, which is what `specs/instrumentation.md` exposes on
// `window.__shatter` and what makes a driven scenario reproducible on any
// machine. Drawing is unaffected either way: the loop keeps presenting, so the
// canvas always shows the state the most recent tick left.

import { AudioBus, type AudioContextSource, type CueSpec } from "./audio-bus";
import { Keyboard, asKeyboardEvent } from "./keyboard";
import { Diagnostics, OVERLAY_KEY } from "./overlay";
import {
  deviceSize,
  domSurface,
  fitViewport,
  type Surface,
  type Viewport,
} from "./viewport";

/**
 * The largest delta a frame may be worth, in seconds.
 *
 * A backgrounded tab resumes with a gap measured in seconds, and a game asked to
 * run four thousand ticks in one frame stalls the page for as long as that takes.
 * The clamp trades a moment of slow motion on resume for a loop that survives it.
 */
export const MAX_FRAME_SECONDS = 0.1;

/** The runtime's position: how many ticks have run, and off what real delta. */
export interface FrameInfo {
  /** Simulation ticks run since the runtime started. */
  count: number;
  /** The seconds of real time the most recent frame measured. */
  dt: number;
}

/** What the game may reach while it initializes, once, before the first frame. */
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
 * What the game may reach while it updates. Nothing here draws, which is what
 * lets the simulation be stepped and read with no drawing taking part in the
 * result.
 */
export interface UpdateApi {
  readonly input: {
    /** Whether the action is held, as `1` or `0`. */
    value(name: string): number;
    /** Whether the action went down since the last frame. Consumes the edge. */
    pressed(name: string): boolean;
  };
  readonly audio: {
    /** Play a declared one-shot cue, once. */
    play(cue: string): void;
    /** Start or stop a declared held cue. Idempotent in both directions. */
    setHeld(cue: string, sounding: boolean): void;
    /** Mute or unmute the bus. */
    setMuted(muted: boolean): void;
    /** Whether the bus is muted. */
    muted(): boolean;
  };
}

/**
 * What the game may reach while it renders: the destination, already cleared to
 * the background and already carrying the logical transform. Nothing here reads
 * input or plays a cue, so what a tick does is decided entirely by its update.
 */
export interface RenderApi {
  readonly ctx: CanvasRenderingContext2D;
}

/** The four functions and the state type the game supplies. */
export interface Game<S> {
  /** Declare the bindings, cues and diagnostics, and build the whole state. */
  initialize(api: InitApi): S;
  /**
   * Advance from `dt` seconds of real time, running whole ticks and carrying the
   * remainder. Returns how many ticks it ran.
   */
  update(state: S, api: UpdateApi, dt: number): number;
  /** Run exactly one whole simulation tick, whatever the wall clock says. */
  tick(state: S, api: UpdateApi): void;
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
  /** The game this runtime drives, bound for its lifetime. */
  game: Game<S>;
  /** The CSS color the whole canvas is cleared to before every frame. */
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
   * Run `ticks` whole simulation ticks immediately and in order, then draw what
   * they left. Each is a real tick, the same one the loop runs. `advance(0)` runs
   * nothing at all.
   */
  advance(ticks: number): void;
  /** The tick counter and the most recent measured delta. */
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
 * caller can take the game off the clock before it has run a single tick.
 */
export function createRuntime<S>(options: RuntimeOptions<S>): Runtime<S> {
  const { canvas, width, height, game, background } = options;
  const surface = options.surface ?? domSurface(canvas);
  const keyboard = new Keyboard(surface.events());
  const audio = new AudioBus(options.audioContext);
  const diagnostics = new Diagnostics();

  let live: { value: S } | null = null;
  let viewport = fit();
  let context: CanvasRenderingContext2D | null = null;

  let count = 0;
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
   * depends on the element's size, on the device pixel ratio, and on the logical
   * field; re-deriving it costs three reads, while a listener would have to be
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
      throw new Error("Shatter: the canvas has no 2D context");
    }
    return context;
  }

  /** Clear to the background — the letterbox bars included — and install the
   * logical transform. */
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
    },
    audio: {
      play: (cue) => audio.play(cue),
      setHeld: (cue, sounding) => audio.setHeld(cue, sounding),
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
   * Draw the state as it stands, over a freshly cleared canvas.
   *
   * The game draws inside a clip of the logical field. The field wraps, so a body
   * on a seam is drawn at both edges at once and each copy reaches past the edge
   * it straddles; without the clip that overhang lands on the letterbox bars,
   * which `specs/overview.md` fixes as carrying the field's background colour.
   * The clip is lifted before the overlay, because the panel is chrome in device
   * space rather than part of the field.
   */
  function draw(state: S): void {
    const ctx = openFrame();
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, width, height);
    ctx.clip();
    game.render(state, { ctx });
    ctx.restore();
    // Drawn after the game and through the same context, with the transform
    // reset: the panel is chrome over the finished picture, not part of it.
    diagnostics.draw(ctx, { count, dt });
  }

  /** One whole frame off the wall clock: update by `seconds`, then draw. */
  function runFrame(seconds: number): void {
    const state = live;
    if (state === null) return;
    dt = seconds;
    try {
      count += game.update(state.value, updateApi, seconds);
      draw(state.value);
    } finally {
      // An edge nothing consumed is discarded even when the frame threw, so one
      // bad frame cannot leave a press to surface later, out of order.
      keyboard.endFrame();
    }
  }

  /**
   * Redraw the state the last tick left, advancing nothing.
   *
   * What the loop does while the game is off the wall clock. Input edges are
   * deliberately NOT discarded here: a key pressed between two `advance` calls
   * belongs to the next tick that actually runs, and dropping it would make what
   * a driven scenario sees depend on how many times the browser happened to
   * repaint.
   */
  function present(): void {
    if (live === null) return;
    draw(live.value);
  }

  /** This frame's delta in seconds: never negative, never longer than the clamp. */
  function measure(nowMs: number): number {
    const previous = previousMs;
    previousMs = nowMs;
    // The first frame is worth nothing: a delta is measured between two frames,
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
      // The wall clock is read on every frame, stepping or not, so giving the
      // game back its clock does not hand it the whole interval it spent held.
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
        "Shatter: this environment has no requestAnimationFrame; drive the game with advance() instead",
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
        throw new Error("Shatter: the runtime has not initialized yet");
      }
      return live.value;
    },

    initialize(): S {
      if (destroyed) {
        throw new Error("Shatter: this runtime has been destroyed");
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
      // Dropped, so the first frame after a start measures from that frame rather
      // than from whenever the loop last stopped.
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
          `Shatter: advance() needs a whole, non-negative number of ticks, got ${ticks}`,
        );
      }
      // `specs/instrumentation.md`: advance(0) runs nothing at all — not a tick,
      // not a draw, and not the discard of an input edge that a later call to
      // advance is entitled to see.
      if (ticks === 0) return;
      const state = live;
      if (state === null) return;
      try {
        for (let i = 0; i < ticks; i += 1) {
          game.tick(state.value, updateApi);
          count += 1;
        }
        draw(state.value);
      } finally {
        keyboard.endFrame();
      }
    },

    frame: () => ({ count, dt }),

    viewport: () => viewport,

    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      stopLoop();
      surface.events().removeEventListener("keydown", onOverlayKey);
      keyboard.detach();
      audio.dispose();
      live = null;
    },
  };
}
