// The frame loop and what a frame does.
//
// This engineless build measures the real delta itself, gathers it, and
// consumes whole `1 / TICK_HZ` ticks from it while a run is in progress, so
// every run is the same sequence of ticks whatever the frame rate
// (`specs/overview.md`). Outside a run nothing ticks: the menus and the editor
// respond to input as it arrives, and the camera moves against the frame's
// delta. `simTime` accumulates every update's delta whatever the screen.
//
// The game is one value, `Game.state`, built and replaced by the pure
// transitions of `src/state.ts` and the systems around it. Nothing the game
// carries from one frame to the next lives anywhere else.

import {
  CLICK_SLOP,
  CREAK_COOLDOWN,
  CREAK_THRESHOLD,
  ORBIT_KEY_RATE,
  ORBIT_PER_PX,
  RUN_SPEEDS,
  SITE_COUNT,
  TICK_HZ,
  ZOOM_RATE,
  type ActionName,
  type CueName,
} from "./constants";
import { loadAssets } from "./assets";
import { installDebugSurface } from "./debug";
import { applyClick as applyEditorClick } from "./editor";
import { createRenderer } from "./render";
import type { DrawnEntry } from "./render-drawn";
import { createRuntime, type Runtime, type StagePointerEvent } from "./runtime";
import { handleAction, handlePointer, type ScreenIo } from "./screens";
import { advanceRun, AXIS_NAMES, readiness, type RunContext } from "./sim";
import {
  beginRun,
  craneCost,
  currentProgram,
  currentSite,
  currentStructure,
  isYardScreen,
  poseCamera,
  recordBest,
  titleState,
  type GameRun,
  type GantryState,
} from "./state";

/** A tick covers this many seconds (`specs/overview.md`). */
export const TICK_DT = 1 / TICK_HZ;

/**
 * The most elapsed time one frame is allowed to carry into the game. A tab
 * left in the background hands the loop a delta of many seconds, and playing
 * all of it back at once would be neither watchable nor useful; the game
 * simply loses that time instead.
 */
export const MAX_FRAME_DT = 0.1;

/** The creak cooldown, as the whole tick count `specs/ui.md` counts it in. */
const CREAK_COOLDOWN_TICKS = CREAK_COOLDOWN * TICK_HZ;

/** What the frame loop needs from the layers around it. */
export interface GameDeps {
  runtime: Runtime;
  /** Draw one frame. Reads the state and writes nothing. */
  draw(state: GantryState): void;
  /**
   * What the last frame drew, as `specs/instrumentation.md` has `drawn()` report
   * it. The layer that drew the frame is the only one that knows, so the loop
   * carries the question through rather than answering it.
   */
  lastDrawn(): DrawnEntry[];
}

/** Whether any axis is turning, which is what the `motor` loop reads. */
const anyAxisMoving = (run: GameRun): boolean =>
  AXIS_NAMES.some((name) => run.axes[name].rate !== 0);

/**
 * The game: the state, the loop that advances it, and the clock the debug
 * surface takes it off (`specs/instrumentation.md`).
 */
export class Game implements ScreenIo {
  /** The whole of the game. */
  state: GantryState = titleState();

  /**
   * Whether the loop advances the game from the wall clock. `false` leaves the
   * loop drawing and nothing else, so `advance` is exact.
   */
  autoStep = true;

  private readonly deps: GameDeps;
  private looping = false;
  private handle = 0;
  private lastFrameMs = 0;

  constructor(deps: GameDeps) {
    this.deps = deps;
    deps.runtime.setDiagnostics(() => diagnosticLines(this.state));
  }

  /** The runtime layer, which the debug surface's input operations feed. */
  get runtime(): Runtime {
    return this.deps.runtime;
  }

  // ---- ScreenIo -----------------------------------------------------------

  playCue(cue: CueName): void {
    this.deps.runtime.playCue(cue);
  }

  toggleMute(): void {
    this.deps.runtime.toggleMute();
  }

  // ---- The loop -----------------------------------------------------------

  /** Start running the loop off the wall clock. */
  start(): void {
    if (this.looping) return;
    this.looping = true;
    this.lastFrameMs = performance.now();
    const loop = (nowMs: number): void => {
      if (!this.looping) return;
      this.handle = requestAnimationFrame(loop);
      const elapsed = Math.max(0, (nowMs - this.lastFrameMs) / 1000);
      this.lastFrameMs = nowMs;
      if (this.autoStep) this.update(Math.min(MAX_FRAME_DT, elapsed));
      this.deps.draw(this.state);
    };
    this.handle = requestAnimationFrame(loop);
  }

  /** Stop the loop. */
  stop(): void {
    this.looping = false;
    if (this.handle !== 0) cancelAnimationFrame(this.handle);
    this.handle = 0;
  }

  /** What the last frame drew (`specs/instrumentation.md`). */
  lastDrawn(): DrawnEntry[] {
    // The overlay is drawn OUTSIDE the canvas, by the runtime layer rather than
    // by the renderer, so its lines are joined on here — `drawn()` reports the
    // text a frame drew "wherever it is drawn", and a panel the player is
    // looking at is text the frame drew.
    const lines = this.deps.runtime.overlayLines();
    return [
      ...this.deps.lastDrawn(),
      ...lines.map((text) => ({
        kind: "text" as const,
        name: "overlay",
        id: null,
        source: null,
        x: 0,
        y: 0,
        z: 0,
        yaw: 0,
        size: [0, 0, 0] as readonly [number, number, number],
        color: [255, 255, 255] as readonly [number, number, number],
        text,
      })),
    ];
  }

  /** One whole frame: advance the game by `dt` seconds, then draw it. */
  frame(dt: number): void {
    this.update(dt);
    this.deps.draw(this.state);
  }

  /**
   * Run `ticks` whole frames, immediately and in order, each covering
   * `1 / TICK_HZ` seconds of elapsed time and each followed by a render
   * (`specs/instrumentation.md`).
   */
  advance(ticks = 1): void {
    const count = Math.trunc(ticks);
    for (let i = 0; i < count; i++) this.frame(TICK_DT);
  }

  /**
   * Advance the game by one frame's delta time, drawing nothing.
   *
   * The order is fixed: the frame's own bookkeeping, then the input that
   * arrived since the last frame, then the camera against this frame's delta,
   * then whatever whole ticks the accumulation now covers.
   */
  update(dt: number): void {
    const rt = this.deps.runtime;
    let s: GantryState = {
      ...this.state,
      simTime: this.state.simTime + dt,
      muted: rt.isMuted(),
    };

    const input = rt.takeInput();
    for (const event of input.pointer) s = this.applyPointerEvent(s, event);
    // Every update reads the pointer's current position, so a `reset` shows in
    // it only until the next one (`specs/instrumentation.md`).
    s = {
      ...s,
      pointer: { ...s.pointer, x: rt.pointerX(), y: rt.pointerY() },
    };
    for (const action of input.actions) s = handleAction(s, action, this);
    s = applyCameraKeys(s, dt, rt);
    s = this.advanceTicks(s, dt);

    this.state = s;
    rt.setMotor(s.run.phase === "running" && anyAxisMoving(s.run));
  }

  /**
   * Pose the `run` action from outside the screens: the same refusals, the
   * same `run-start`, and the same move to the run screen. Answers whether a
   * run began.
   */
  requestRun(): boolean {
    const next = beginRun(this.state);
    if (next === null) return false;
    this.playCue("run-start");
    this.state = next;
    return true;
  }

  // ---- The pieces of a frame ----------------------------------------------

  /**
   * Consume whole ticks from the accumulation. The accumulation belongs to the
   * run — it is empty when one starts — and the watch speed scales what a
   * frame covers and nothing else (`specs/program.md`).
   */
  private advanceTicks(state: GantryState, dt: number): GantryState {
    let s = state;
    if (s.run.phase !== "running") return s;
    const context: RunContext = {
      site: currentSite(s),
      structure: currentStructure(s),
      tape: currentProgram(s),
    };
    const speed = RUN_SPEEDS[s.run.speedIndex] ?? RUN_SPEEDS[0];
    let accumulator = s.run.accumulator + dt * speed;
    let run = s.run;
    while (accumulator >= TICK_DT && run.phase === "running") {
      accumulator -= TICK_DT;
      const before = run;
      const advanced = advanceRun(before, context);
      run = {
        ...advanced,
        speedIndex: before.speedIndex,
        accumulator: 0,
        lastCreakTick: before.lastCreakTick,
      };
      run = this.raiseTickCues(before, run);
    }
    s = { ...s, run: { ...run, accumulator } };
    return run.phase === "running" ? s : this.endRun(s);
  }

  /** The cues one tick raises (`specs/ui.md`). */
  private raiseTickCues(before: GameRun, after: GameRun): GameRun {
    if (after.brokeThisTick) this.playCue("break");

    // A cue plays "at most once on a given tick" (`specs/ui.md`), so each is
    // raised by the tick rather than by the load: an `attach` or a `release`
    // moves one load today, and this holds the rule whatever moves several.
    let attached = false;
    let placed = false;
    for (let i = 0; i < after.loads.length; i++) {
      const was = before.loads[i];
      const now = after.loads[i];
      if (was !== undefined && was.phase === now.phase) continue;
      if (now.phase === "attached") attached = true;
      else if (now.phase === "placed") placed = true;
    }
    if (attached) this.playCue("attach");
    if (placed) this.playCue("placed");

    // A member creaks on reaching CREAK_THRESHOLD having been below it on the
    // tick before, at most once across the structure per cooldown, and never
    // on a run's first tick.
    let lastCreakTick = after.lastCreakTick;
    if (after.tick > 1) {
      const previous = new Map(before.forces.map((f) => [f.id, f.utilization]));
      const eligible = after.forces.some(
        (f) =>
          f.utilization >= CREAK_THRESHOLD &&
          (previous.get(f.id) ?? 0) < CREAK_THRESHOLD,
      );
      const ready =
        lastCreakTick === null ||
        after.tick - lastCreakTick >= CREAK_COOLDOWN_TICKS;
      if (eligible && ready) {
        this.playCue("creak");
        lastCreakTick = after.tick;
      }
    }
    return lastCreakTick === after.lastCreakTick
      ? after
      : { ...after, lastCreakTick };
  }

  /**
   * What the tick that ended a run leaves: a cleared run records the site's
   * score and moves to the results screen, a failed one stays on the run
   * screen with its cause (`specs/ui.md`).
   */
  private endRun(state: GantryState): GantryState {
    const run = state.run;
    if (run.phase === "failed") {
      if (run.cause === "collapse" || run.cause === "ring-overload") {
        this.playCue("collapse");
      }
      this.playCue("fail");
      return state;
    }
    if (run.phase !== "cleared") return state;
    this.playCue("complete");
    const index = state.siteIndex;
    const score = { cost: craneCost(state), time: run.tick / TICK_HZ };
    const scored = recordBest(state, index, score);
    return {
      ...scored,
      cleared: scored.cleared.map((was, i) => (i === index ? true : was)),
      screen: "results",
      menuIndex: 0,
    };
  }

  /**
   * One pointer act. The press is followed here rather than read afresh, so a
   * click and an orbit drag are told apart by what the state kept
   * (`specs/controls.md`).
   */
  private applyPointerEvent(
    state: GantryState,
    event: StagePointerEvent,
  ): GantryState {
    const pointer = state.pointer;

    if (event.kind === "down") {
      const pressed: GantryState = {
        ...state,
        pointer: {
          x: event.x,
          y: event.y,
          down: true,
          pressX: event.x,
          pressY: event.y,
          dragging: false,
          captured: false,
        },
      };
      if (pressed.screen !== "program") return pressed;
      const outcome = handlePointer(pressed, event, this);
      if (!outcome.consumed) return outcome.state;
      return {
        ...outcome.state,
        pointer: { ...outcome.state.pointer, captured: true },
      };
    }

    if (event.kind === "move") {
      const moved: GantryState = {
        ...state,
        pointer: { ...pointer, x: event.x, y: event.y },
      };
      if (pointer.captured) return handlePointer(moved, event, this).state;
      if (!pointer.down) return moved;
      if (!pointer.dragging) {
        const travelled = Math.hypot(
          event.x - pointer.pressX,
          event.y - pointer.pressY,
        );
        // The move that carries a press across the boundary turns nothing.
        if (travelled < CLICK_SLOP) return moved;
        return { ...moved, pointer: { ...moved.pointer, dragging: true } };
      }
      if (!isYardScreen(state.screen)) return moved;
      const dx = event.x - pointer.x;
      const dy = event.y - pointer.y;
      return {
        ...moved,
        camera: poseCamera(
          state.camera.yaw + dx * ORBIT_PER_PX,
          state.camera.pitch - dy * ORBIT_PER_PX,
          state.camera.dist,
        ),
      };
    }

    let released = state;
    if (pointer.captured) {
      released = handlePointer(state, event, this).state;
    } else if (pointer.down && !pointer.dragging) {
      released = this.applyClick(state);
    }
    return {
      ...released,
      pointer: {
        ...released.pointer,
        down: false,
        dragging: false,
        captured: false,
      },
    };
  }

  /** A click, applied at the position the press was released from. */
  private applyClick(state: GantryState): GantryState {
    if (state.screen !== "build") return state;
    const outcome = applyEditorClick(state);
    if (outcome.cue !== null) this.playCue(outcome.cue);
    return outcome.state;
  }
}

/**
 * The orbit camera against the frame's delta time, on the three yard screens
 * (`specs/controls.md`).
 */
function applyCameraKeys(
  state: GantryState,
  dt: number,
  runtime: Runtime,
): GantryState {
  if (!isYardScreen(state.screen)) return state;
  const held = (action: ActionName): number => (runtime.held(action) ? 1 : 0);
  const yawTurn = held("right") - held("left");
  const pitchTurn = held("up") - held("down");
  const zoom = held("zoom-out") - held("zoom-in");
  if (yawTurn === 0 && pitchTurn === 0 && zoom === 0) return state;
  return {
    ...state,
    camera: poseCamera(
      state.camera.yaw + yawTurn * ORBIT_KEY_RATE * dt,
      state.camera.pitch + pitchTurn * ORBIT_KEY_RATE * dt,
      state.camera.dist + zoom * ZOOM_RATE * dt,
    ),
  };
}

const round = (value: number, places = 2): string => value.toFixed(places);

/**
 * The diagnostic sources the overlay draws (`specs/instrumentation.md`). Every
 * one is a pure read, so watching the overlay leaves the game as it is.
 */
export function diagnosticLines(state: GantryState): readonly string[] {
  const site = currentSite(state);
  const structure = currentStructure(state);
  const run = state.run;
  const issues = readiness(structure, site.anchors);
  const utilization = run.forces.reduce(
    (top, f) => Math.max(top, f.utilization),
    0,
  );
  return [
    `screen ${state.screen}   site ${state.siteIndex + 1}/${SITE_COUNT} ${site.name}`,
    `members ${structure.members.length}   cost ${round(craneCost(state), 0)}/${site.budget}   issues ${issues.length}`,
    `run ${run.phase}   step ${run.stepIndex}   t ${round(run.tick / TICK_HZ)}s   ${run.cause ?? "-"}`,
    `slew ${round(run.axes.slew.value)}   trolley ${round(run.axes.trolley.value)}   hoist ${round(run.axes.hoist.value)}   grip ${round(run.axes.grip.value)}`,
    `bob ${round(run.bob.pos[0])}, ${round(run.bob.pos[1])}, ${round(run.bob.pos[2])}`,
    `util ${round(utilization)}   broken ${run.broken.length}`,
    `cam ${round(state.camera.yaw, 1)} / ${round(state.camera.pitch, 1)} / ${round(state.camera.dist, 1)}`,
  ];
}

/**
 * Stand the whole game up over the page's canvas: the runtime layer, the
 * produced assets, the scene, the loop, and the debug surface, which is
 * installed on `window.__gantry` as soon as the game has initialized
 * (`specs/instrumentation.md`).
 */
export async function startGame(canvas: HTMLCanvasElement): Promise<Game> {
  const runtime = createRuntime(canvas);
  const assets = await loadAssets();
  runtime.installAudio(assets.cues, assets.music);
  const renderer = createRenderer(canvas, assets.models);
  const game = new Game({
    runtime,
    draw: (state) => renderer.draw(state),
    lastDrawn: () => renderer.lastDrawn(),
  });
  installDebugSurface(game);
  game.start();
  return game;
}
