// Volute — the runtime the game stands on.
//
// This build runs on no engine, so the layer every browser game needs is part of
// it (specs/overview.md). This file is that layer: the frame loop and the delta it
// measures, the canvas fit, the wiring that hands the game a keyboard and a
// pointer (`src/input.ts`), an audio bus (`src/audio.ts`), and an overlay
// (`src/overlay.ts`), and the tick accumulator that makes the simulation
// steppable.
//
// THE SIMULATION ADVANCES IN WHOLE TICKS. A frame measures its delta from the wall
// clock, adds it to the accumulator, and consumes as many whole `TICK_DT` ticks as
// it holds; the remainder waits for the next frame. So an interval of game time
// reaches the same state however it was divided into frames, and a scenario
// stepped from code runs the very same ticks the wall clock would have run.
//
// THE CLOCK CAN BE TAKEN AWAY. `setAutoStep(false)` stops the loop feeding the
// wall clock into the accumulator, and `step(n)` runs exactly `n` ticks. Drawing
// is unaffected either way: the loop keeps presenting, so the canvas always shows
// the state the most recent tick left.
//
// INPUT ANSWERS ON EVERY SCREEN. A screen that advances nothing still gets a tick
// worth zero seconds each frame, which is how the title's confirm, a pause and a
// dismissed ending are read without the simulation moving. An edge that no tick
// consumed is KEPT rather than discarded, so a shot raised in the sliver between
// two ticks is still fired.

import {
  BINDINGS,
  DANGER_BED,
  FIELD_H,
  FIELD_W,
  HALL_BED,
  OVERLAY_KEY,
  TICK_DT,
} from "./constants";
import type { CueName } from "./constants";
import { AudioBus, type AudioContextSource } from "./audio";
import type { Assets } from "./assets";
import {
  Controls,
  MOUSE_PRIMARY,
  MOUSE_SECONDARY,
  asKeyboardEvent,
} from "./input";
import { Diagnostics } from "./overlay";
import { Effects, type CanvasFactory } from "./fx";
import { newReport } from "./events";
import type { FxEvent } from "./events";
import { renderFrame } from "./render";
import { createState } from "./state";
import { advancesSimulation, inDanger, tick } from "./sim";
import { effectiveFeed } from "./train";
import { COLOR } from "./theme";
import type { VoluteState } from "./types";
import {
  deviceSize,
  domSurface,
  fitViewport,
  toLogical,
  type Surface,
  type Viewport,
} from "./viewport";

/**
 * The largest delta a frame may be worth, in seconds.
 *
 * A backgrounded tab resumes with a gap measured in seconds, and a game asked to
 * integrate half a minute in one go would run hundreds of ticks in one frame. The
 * clamp trades a moment of slow motion on resume for a frame that always returns.
 */
export const MAX_FRAME_SECONDS = 0.1;

/** What `createRuntime` is handed. */
export interface RuntimeOptions {
  /** The canvas the runtime sizes, clears, and renders through. */
  canvas: HTMLCanvasElement;
  /** The produced files the renderer and the audio bus draw and play. */
  assets: Assets;
  /** The seed the game's one generator opens on. */
  seed: number;
  /** Where size, pixel density and events come from; defaults to the DOM. */
  surface?: Surface;
  /** Where the audio bus gets its context; defaults to the platform's. */
  audioContext?: AudioContextSource;
  /** Where the effects layer gets its scratch canvases; defaults to the page's. */
  createCanvas?: CanvasFactory;
}

/** The runtime, as the build holds it. */
export interface Runtime {
  /** The game's state, live. */
  readonly state: VoluteState;
  /** The live effects, so a pose that re-opens the hall can clear them. */
  readonly effects: Effects;
  /** The audio bus, so the beds can be checked from outside. */
  readonly audio: AudioBus;
  /** Hold a cue a pose raised until the next tick sounds it. */
  queueCue(cue: CueName): void;
  /** Play an effect over the hall, for a pose that raised one. */
  spawnFx(event: FxEvent): void;
  /** Drop every live effect: what a pose that re-opens the hall leaves behind. */
  clearEffects(): void;
  /** Start the frame loop. */
  start(): void;
  /** Stop the frame loop. The state is left exactly as the last tick left it. */
  stop(): void;
  /** Whether the loop advances the simulation from the wall clock. */
  autoStep(): boolean;
  /** Take the game off the wall clock, or give it back. */
  setAutoStep(enabled: boolean): void;
  /** Run `ticks` whole simulation ticks, each the full tick followed by a render. */
  step(ticks: number): void;
  /** Redraw the state the last tick left, advancing nothing. */
  present(): void;
  /** How many ticks the simulation has run. */
  ticksRun(): number;
  /** The current logical-to-device fit. */
  viewport(): Viewport;
  /** Halt the loop, drop every listener, and release the canvas. */
  destroy(): void;
}

/** Build the runtime over `canvas` and bind it to one game. */
export function createRuntime(options: RuntimeOptions): Runtime {
  const { canvas, assets } = options;
  const surface = options.surface ?? domSurface(canvas);
  const audio = new AudioBus(options.audioContext);
  const diagnostics = new Diagnostics();
  const effects = new Effects(assets, options.createCanvas);
  const state = createState(options.seed);

  let viewport = fit();
  let context: CanvasRenderingContext2D | null = null;
  let ticks = 0;
  let bed: CueName | null = null;
  const pending = new Set<CueName>();
  let running = false;
  let handle: number | null = null;
  let previousMs: number | null = null;
  let destroyed = false;

  const controls = new Controls(
    surface.events(),
    surface.pointerEvents(),
    (clientX, clientY) => {
      const bounds = surface.bounds();
      return toLogical(
        viewport,
        surface.dpr(),
        clientX - bounds.left,
        clientY - bounds.top,
      );
    },
  );
  for (const [action, codes] of Object.entries(BINDINGS)) {
    controls.register(action, codes);
  }
  // The two mouse buttons are two more sources on two existing actions.
  controls.register("fire", [...BINDINGS.fire, MOUSE_PRIMARY]);
  controls.register("swap", [...BINDINGS.swap, MOUSE_SECONDARY]);

  audio.load(assets.audio);
  audio.armUnlock(surface.events());
  registerDiagnostics();

  const ports = {
    input: {
      value: (action: string) => controls.value(action),
      pressed: (action: string) => controls.pressed(action),
      pointer: () => controls.pointer(),
    },
    audio: {
      muted: () => audio.muted(),
      setMuted: (muted: boolean) => audio.setMuted(muted),
    },
  };

  function fit(): Viewport {
    return fitViewport(
      FIELD_W,
      FIELD_H,
      surface.cssWidth(),
      surface.cssHeight(),
      surface.dpr(),
    );
  }

  /**
   * Resize the backing store to the element's laid-out size and recompute the fit.
   *
   * Run at the top of every frame rather than from a resize observer: the fit
   * depends on the element's size, on the device pixel ratio and on the logical
   * field, and re-deriving it costs three reads, while a listener would have to be
   * armed, disarmed, and kept in step with the ratio changing under a window
   * dragged between displays.
   */
  function syncCanvas(): void {
    const dpr = surface.dpr();
    const deviceW = deviceSize(surface.cssWidth(), dpr);
    const deviceH = deviceSize(surface.cssHeight(), dpr);
    // Assigning either dimension clears the canvas and resets the context state,
    // so both are written only when they actually changed.
    if (canvas.width !== deviceW && deviceW > 0) canvas.width = deviceW;
    if (canvas.height !== deviceH && deviceH > 0) canvas.height = deviceH;
    viewport = fit();
  }

  function drawingContext(): CanvasRenderingContext2D {
    context ??= canvas.getContext("2d");
    if (context === null) {
      throw new Error("Volute: the canvas has no 2D context");
    }
    return context;
  }

  /** Clear the whole canvas to the field's own color and install the fit. */
  function openFrame(): CanvasRenderingContext2D {
    syncCanvas();
    const ctx = drawingContext();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = COLOR.field;
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

  /**
   * One whole tick, and everything the tick raised.
   *
   * A pose queues its cues rather than sounding them, so "audio belongs to the
   * ticks" holds: the cues a scenario hears all come from the ticks run after the
   * pose that arranged the hall.
   */
  function runTick(dt: number): void {
    const report = newReport();
    for (const cue of pending) report.cues.add(cue);
    pending.clear();
    tick(state, ports, dt, report);
    if (dt > 0) ticks += 1;
    for (const event of report.fx) effects.spawn(event);
    for (const cue of report.cues) audio.play(cue);
    syncBeds();
  }

  /**
   * Exactly one bed loops on `playing`, and neither on any other screen.
   *
   * The change happens on the tick the condition changes: the running bed stops
   * and the other starts at once, so the two never sound together.
   *
   * Reconciled against what the bus is ACTUALLY looping rather than against what
   * was last asked for, because a bed asked for before the produced file finished
   * decoding cannot start yet. Asking again on the next tick is what gets it going
   * the moment the decode lands.
   */
  function syncBeds(): void {
    const wanted =
      state.screen === "playing"
        ? inDanger(state)
          ? DANGER_BED
          : HALL_BED
        : null;
    if (bed !== null && bed !== wanted) audio.stop(bed);
    if (wanted !== null && !audio.looping(wanted)) audio.loop(wanted);
    bed = wanted;
  }

  /** Draw the state the last tick left, and age the effects by `dt`. */
  function draw(dt: number): void {
    effects.update(dt);
    const ctx = openFrame();
    if (viewport.scale > 0) renderFrame(ctx, state, assets, effects, dt);
    diagnostics.draw(ctx);
  }

  /** One frame: the whole ticks the accumulator holds, then a draw. */
  function runFrame(seconds: number): void {
    state.simTime += seconds;

    let ran = 0;
    if (advancesSimulation(state.screen)) {
      state.accumulator += seconds;
      while (state.accumulator >= TICK_DT) {
        state.accumulator -= TICK_DT;
        runTick(TICK_DT);
        ran += 1;
        // A screen that stops advancing discards the delta left unconsumed.
        if (!advancesSimulation(state.screen)) {
          state.accumulator = 0;
          break;
        }
      }
    } else {
      state.accumulator = 0;
      // A tick worth no time: the screen's own controls are read, and nothing
      // advances.
      runTick(0);
      ran = 1;
    }

    draw(seconds);
    // An edge nothing consumed is discarded only once a tick has actually had the
    // chance to see it.
    if (ran > 0) controls.endFrame();
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
      // The wall clock is read on every frame, stepping or not, so giving the game
      // back its clock does not hand it the whole interval it spent paused.
      const elapsed = measure(nowMs);
      if (state.autoStep) runFrame(elapsed);
      else draw(0);
    } finally {
      // Re-armed in `finally`, so a throw out of the game surfaces where it is
      // visible instead of freezing the game forever on one bad frame.
      if (running && handle === null) arm();
    }
  }

  function arm(): void {
    if (typeof globalThis.requestAnimationFrame !== "function") {
      throw new Error(
        "Volute: this environment has no requestAnimationFrame; drive the game with step() instead",
      );
    }
    handle = globalThis.requestAnimationFrame(pump);
  }

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
  surface.events().addEventListener("keydown", onOverlayKey);

  /** The read-only window `specs/instrumentation.md` asks the overlay to carry. */
  function registerDiagnostics(): void {
    diagnostics.register("screen", () => state.screen);
    diagnostics.register("level", () => `${state.level}  score ${state.score}`);
    diagnostics.register("cells", () => state.cells);
    diagnostics.register("quota", () => state.quotaRemaining);
    diagnostics.register(
      "pressure",
      () =>
        `${state.pressure.toFixed(2)}  feed ${effectiveFeed(state).toFixed(2)}`,
    );
    diagnostics.register(
      "chain",
      () => `${state.chainStep}  in ${state.chainTimer.toFixed(2)}s`,
    );
    diagnostics.register(
      "cores",
      () =>
        `${state.cores.length}  head ${
          state.cores.length > 0 ? state.cores[0].s.toFixed(1) : "-"
        }`,
    );
    diagnostics.register("segments", () => state.segments.length);
    diagnostics.register("danger", () => (inDanger(state) ? "yes" : "no"));
    diagnostics.register(
      "injector",
      () =>
        `${state.loaded ?? "-"}/${state.queued ?? "-"}  aim ${state.aim.toFixed(
          1,
        )}  cd ${state.fireCooldown.toFixed(2)}`,
    );
    diagnostics.register("projectiles", () => state.projectiles.length);
    diagnostics.register("machinery", () =>
      state.machinery === null
        ? "none"
        : `${state.machinery.kind} ${state.machinery.remaining.toFixed(2)}s`,
    );
  }

  return {
    state,
    effects,
    audio,

    queueCue(cue: CueName): void {
      pending.add(cue);
    },

    spawnFx(event: FxEvent): void {
      effects.spawn(event);
    },

    clearEffects(): void {
      effects.clear();
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

    autoStep: () => state.autoStep,

    setAutoStep(enabled: boolean): void {
      state.autoStep = Boolean(enabled);
      previousMs = null;
    },

    step(count: number): void {
      const whole = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
      for (let i = 0; i < whole; i += 1) {
        state.simTime += TICK_DT;
        runTick(TICK_DT);
        draw(TICK_DT);
        // A stepped tick is a frame, so it closes one: an edge no screen consumed
        // is discarded here exactly as `runFrame` discards it. Without this a
        // `Space` press the title consumed as `confirm` would leave its `fire`
        // edge armed for the first `playing` tick, and a stepped scenario would
        // diverge from the same scenario played on the wall clock.
        controls.endFrame();
      }
    },

    present(): void {
      draw(0);
    },

    ticksRun: () => ticks,

    viewport: () => viewport,

    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      stopLoop();
      surface.events().removeEventListener("keydown", onOverlayKey);
      controls.detach();
      audio.dispose();
    },
  };
}
