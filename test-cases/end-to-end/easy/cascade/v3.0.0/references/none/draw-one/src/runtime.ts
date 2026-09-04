// Cascade — the runtime the game stands on.
//
// This build runs on no engine, so the layer every browser game needs is part
// of it (`specs/overview.md`). This file is that layer's core, and it is
// deliberately sized for THIS game rather than for every 2D game: a frame loop,
// the canvas fit, and the wiring that hands the game a pointer in logical stage
// units (`src/pointer.ts`), an audio bus (`src/audio-bus.ts`), a viewport
// (`src/viewport.ts`) and an overlay (`src/overlay.ts`), plus the one key the
// build listens for (`src/keyboard.ts`). There is no asset loader, because
// Cascade loads nothing: every card is drawn in code.
//
// THE CONTRACT is `Game<S>`: an `initialize` that runs once and returns the
// whole state, then an `update(state, api, dt)` and a `render(state, api)` per
// frame, in that order. The state is the only channel between the three.
//
// THE DELTA IS SECONDS, measured between consecutive frames and clamped at
// MAX_FRAME_SECONDS. Every rate in this game is per second and is integrated
// against it (`specs/victory.md`); nothing here imposes a timestep, and nothing
// counts frames as a unit of time.
//
// THE CLOCK CAN BE TAKEN AWAY. `setAutoStep(false)` stops the loop advancing
// the simulation from the wall clock and `advance(seconds, frames)` runs an
// exact number of whole frames at an exact delta, which is what
// `specs/instrumentation.md` exposes on `window.__cascade` and what makes a
// driven scenario reproducible on any machine. Drawing is unaffected either
// way: the loop keeps presenting, so the canvas always shows the state the most
// recent frame left.

import {
  AudioBus,
  type AudioContextSource,
  type AudioPort,
  type CueSpec,
} from "./audio-bus";
import {
  KeyWatcher,
  MenuKeys,
  type MenuAction,
  type MenuBindings,
} from "./keyboard";
import { Diagnostics, OVERLAY_KEY } from "./overlay";
import { Pointer, type PointerPosition, type PointerSample } from "./pointer";
import {
  clientToStage,
  deviceSize,
  domSurface,
  fitViewport,
  type Surface,
  type Viewport,
} from "./viewport";

/**
 * The largest delta a frame measured from the wall clock may be worth, in
 * seconds.
 *
 * A backgrounded tab resumes with a gap measured in seconds, and a game asked
 * to integrate half a minute in one step is not the game the player left. The
 * clamp trades a moment of slow motion on resume for a simulation that survives
 * it. `advance` is deliberately not clamped: a driven frame is worth exactly
 * what its caller asked for.
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
export interface InitApi {
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
  readonly pointer: {
    /** This frame's samples, in arrival order. Consumes them. */
    samples(): PointerSample[];
    /** The pointer's logical position and whether it is pressed, now. */
    current(): PointerPosition;
  };
  readonly keys: {
    /** This frame's menu-action press edges, in arrival order. Consumes them. */
    edges(): MenuAction[];
  };
  readonly audio: AudioPort;
}

/**
 * What the game may reach while it renders: the destination, already cleared to
 * the background and already carrying the logical transform. Nothing here reads
 * input or plays a cue, so what a frame does is decided entirely by its update.
 */
export interface RenderApi {
  readonly ctx: CanvasRenderingContext2D;
}

/** The three functions and the state type the game supplies. */
export interface Game<S> {
  /** Declare the cues and the diagnostics, and build the whole state. */
  initialize(api: InitApi): S;
  /** Advance the simulation by `dt` seconds. */
  update(state: S, api: UpdateApi, dt: number): void;
  /** Draw the state the update left behind. */
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
  /** The CSS colour the whole canvas, letterbox bars included, is cleared to. */
  background: string;
  /** Where size, position, pixel density and events come from; defaults to the DOM. */
  surface?: Surface;
  /** Which `KeyboardEvent.code`s raise each of the four menu actions. */
  menuBindings: MenuBindings;
  /** Where the audio bus gets its context; defaults to the platform's. */
  audioContext?: AudioContextSource;
}

/** The runtime, as the build holds it. */
export interface Runtime<S> {
  /** The state `initialize` built, live. Throws before then. */
  readonly state: S;
  /** The audio bus, which the debug surface reaches for the mute bit. */
  readonly audio: AudioPort;
  /** Build the state, arm the listeners, and fit the canvas. Runs no frame. */
  initialize(): S;
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
  /** Whether the diagnostics overlay is showing. */
  overlayVisible(): boolean;
  /** Halt the loop, drop every listener, and release the canvas. */
  destroy(): void;
}

/**
 * Build the runtime over `canvas` and bind it to one game.
 *
 * Nothing the game supplies runs here: `initialize` is a separate call, so a
 * caller can take the game off the clock before it has run a single frame.
 */
export function createRuntime<S>(options: RuntimeOptions<S>): Runtime<S> {
  const { canvas, width, height, game, background } = options;
  const surface = options.surface ?? domSurface(canvas);
  const pointer = new Pointer(surface.events(), (clientX, clientY) =>
    clientToStage(viewport, surface.origin(), surface.dpr(), clientX, clientY),
  );
  const audio = new AudioBus(options.audioContext);
  const diagnostics = new Diagnostics();

  let live: { value: S } | null = null;
  let viewport = fit();
  let context: CanvasRenderingContext2D | null = null;
  let overlayKey: KeyWatcher | null = null;
  let menuKeys: MenuKeys | null = null;

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
      throw new Error("Cascade: the canvas has no 2D context");
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
    pointer: {
      samples: () => pointer.samples(),
      current: () => pointer.current(),
    },
    keys: { edges: () => menuKeys?.edges() ?? [] },
    audio,
  };

  const initApi: InitApi = {
    audio: { define: (cue, spec) => audio.define(cue, spec) },
    diagnostics: {
      register: (name, source) => diagnostics.register(name, source),
    },
  };

  /** One whole frame: update by `seconds`, then draw what it left. */
  function runFrame(seconds: number): void {
    const state = live;
    if (state === null) return;
    count += 1;
    time += seconds;
    dt = seconds;

    const ctx = openFrame();
    try {
      game.update(state.value, updateApi, seconds);
      game.render(state.value, { ctx });
      // Drawn after the game and through the same context, with the transform
      // reset: the panel is chrome over the finished picture, not part of it.
      diagnostics.draw(ctx, { count, dt });
    } finally {
      // A sample nothing consumed is discarded even when the frame threw, so
      // one bad frame cannot leave a press to surface later, out of order. The
      // key edges go the same way, for the same reason.
      pointer.endFrame();
      menuKeys?.endFrame();
    }
  }

  /**
   * Redraw the state the last frame left, advancing nothing.
   *
   * What the loop does while the game is off the wall clock. Pointer samples
   * are deliberately NOT discarded here: an event delivered between two
   * `advance` calls belongs to the next frame that actually runs, and dropping
   * it would make what a driven scenario sees depend on how many times the
   * browser happened to repaint.
   */
  function present(): void {
    if (live === null) return;
    const ctx = openFrame();
    game.render(live.value, { ctx });
    diagnostics.draw(ctx, { count, dt });
  }

  /** This tick's delta in seconds: never negative, never longer than the clamp. */
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
        "Cascade: this environment has no requestAnimationFrame; drive the game with advance() instead",
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

  return {
    get state(): S {
      if (live === null) {
        throw new Error("Cascade: the runtime has not initialized yet");
      }
      return live.value;
    },

    audio,

    initialize(): S {
      if (destroyed) {
        throw new Error("Cascade: this runtime has been destroyed");
      }
      if (live !== null) return live.value;
      audio.armUnlock(surface.events());
      overlayKey = new KeyWatcher(surface.events(), OVERLAY_KEY, () => {
        diagnostics.toggle();
      });
      menuKeys = new MenuKeys(surface.events(), options.menuBindings);
      syncCanvas();
      live = { value: game.initialize(initApi) };
      return live.value;
    },

    start(): void {
      if (running || destroyed) return;
      running = true;
      // Dropped, so the first tick after a start measures from that tick rather
      // than from whenever the loop last stopped.
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
          `Cascade: advance() needs a finite, non-negative number of seconds, got ${seconds}`,
        );
      }
      if (!Number.isInteger(frames) || frames < 1) {
        throw new RangeError(
          `Cascade: advance() needs a whole, positive frame count, got ${frames}`,
        );
      }
      const step = seconds / frames;
      for (let i = 0; i < frames; i += 1) runFrame(step);
    },

    frame: () => ({ count, time, dt }),

    viewport: () => viewport,

    overlayVisible: () => diagnostics.visible(),

    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      stopLoop();
      overlayKey?.detach();
      overlayKey = null;
      menuKeys?.detach();
      menuKeys = null;
      pointer.detach();
      audio.dispose();
      live = null;
    },
  };
}
