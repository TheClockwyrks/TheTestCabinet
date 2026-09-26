// What a frame does.
//
// Two halves, because the engine runs them at two different points of its fixed
// frame order. The player controller ticks first and resolves the frame's input
// into the state: the pointer acts it read, the pointer's current position, one
// press edge per action, and the orbit the held keys turn against this frame's
// delta. The game mode ticks last and advances the state: `simTime` gathers
// every frame's delta whatever the screen, the engine's mute bit is mirrored,
// and while a run is in progress whole `1 / TICK_HZ` ticks are consumed from the
// time gathered at the watch speed, each tick the pipeline `src/sim` implements.
// Outside a run nothing ticks.
//
// The state is the engine's own live object, so everything here writes it in
// place. The sounds a frame raises go through `GameIo`; nothing else here
// reaches the engine at all.

import {
  ACTIONS,
  CLICK_SLOP,
  CREAK_COOLDOWN,
  CREAK_THRESHOLD,
  ORBIT_KEY_RATE,
  ORBIT_PER_PX,
  RUN_SPEEDS,
  SITE_COUNT,
  TICK_HZ,
  ZOOM_RATE,
} from "./constants";
import { simRun, simStructure, writeRun } from "./adapt";
import { applyClick } from "./editor";
import type { GameIo } from "./io";
import { handleAction, handlePointer, type PointerAct } from "./screens";
import {
  advanceRun,
  AXIS_NAMES,
  readiness,
  type RunContext,
  type RunState as SimRunState,
} from "./sim";
import {
  beginRun,
  craneCost,
  currentProgram,
  currentSite,
  currentStructure,
  isYardScreen,
  menuLength,
  recordBest,
  setCamera,
} from "./state";
import type { GameRun, GantryState } from "./game";
import type { DiagnosticValue, InputReader } from "@clockwyrks/structured-3d";

/** A tick covers this many seconds (`specs/overview.md`). */
export const TICK_DT = 1 / TICK_HZ;

/** The creak cooldown, as the whole tick count `specs/ui.md` counts it in. */
const CREAK_COOLDOWN_TICKS = CREAK_COOLDOWN * TICK_HZ;

/** Whether any axis is turning, which is what the `motor` loop reads. */
const anyAxisMoving = (run: GameRun): boolean =>
  AXIS_NAMES.some((name) => run.axes[name].rate !== 0);

// ---- The controller's half -------------------------------------------------

/**
 * What the controller keeps about the press it is following, beside the six
 * fields `specs/state.md` declares: whether a tape widget took the press on the
 * program screen, so it works that widget rather than the camera
 * (`specs/controls.md`). It is bookkeeping of what the program screen presents
 * and nothing the specification's figures depend on, so it lives with the
 * controller rather than in the state.
 */
export interface PressCapture {
  captured: boolean;
}

/** A fresh capture, which is what a controller starts play holding. */
export const noCapture = (): PressCapture => ({ captured: false });

/**
 * One pointer act. The press is followed here rather than read afresh, so a
 * click and an orbit drag are told apart by what the state kept
 * (`specs/controls.md`).
 */
export function applyPointerAct(
  state: GantryState,
  act: PointerAct,
  io: GameIo,
  press: PressCapture,
): void {
  const pointer = state.pointer;

  if (act.kind === "down") {
    pointer.x = act.x;
    pointer.y = act.y;
    pointer.down = true;
    pointer.pressX = act.x;
    pointer.pressY = act.y;
    pointer.dragging = false;
    press.captured = false;
    if (state.screen !== "program" && menuLength(state) === 0) return;
    press.captured = handlePointer(state, act, io);
    return;
  }

  if (act.kind === "move") {
    const fromX = pointer.x;
    const fromY = pointer.y;
    const wasDown = pointer.down;
    const wasDragging = pointer.dragging;
    pointer.x = act.x;
    pointer.y = act.y;
    // A menu follows the pointer whether or not a press is live
    // (`specs/ui.md`), so its moves reach the screen before the drag rules.
    if (menuLength(state) > 0) {
      handlePointer(state, act, io);
      return;
    }
    if (press.captured) {
      handlePointer(state, act, io);
      return;
    }
    if (!wasDown) return;
    if (!wasDragging) {
      const travelled = Math.hypot(
        act.x - pointer.pressX,
        act.y - pointer.pressY,
      );
      // The move that carries a press across the boundary turns nothing.
      if (travelled >= CLICK_SLOP) pointer.dragging = true;
      return;
    }
    if (!isYardScreen(state.screen)) return;
    setCamera(
      state,
      state.camera.yaw + (act.x - fromX) * ORBIT_PER_PX,
      state.camera.pitch - (act.y - fromY) * ORBIT_PER_PX,
      state.camera.dist,
    );
    return;
  }

  // A release, applied at the position it was released from.
  pointer.x = act.x;
  pointer.y = act.y;
  if (menuLength(state) > 0) {
    handlePointer(state, act, io);
  } else if (press.captured) {
    handlePointer(state, act, io);
  } else if (pointer.down && !pointer.dragging && state.screen === "build") {
    const outcome = applyClick(state);
    if (outcome.cue !== null) io.playCue(outcome.cue);
  }
  pointer.down = false;
  pointer.dragging = false;
  press.captured = false;
}

/**
 * The orbit camera against the frame's delta time, on the three yard screens
 * (`specs/controls.md`).
 */
export function applyCameraKeys(
  state: GantryState,
  input: InputReader,
  dt: number,
): void {
  if (!isYardScreen(state.screen)) return;
  const yawTurn = input.value("right") - input.value("left");
  const pitchTurn = input.value("up") - input.value("down");
  const zoom = input.value("zoom-out") - input.value("zoom-in");
  if (yawTurn === 0 && pitchTurn === 0 && zoom === 0) return;
  setCamera(
    state,
    state.camera.yaw + yawTurn * ORBIT_KEY_RATE * dt,
    state.camera.pitch + pitchTurn * ORBIT_KEY_RATE * dt,
    state.camera.dist + zoom * ZOOM_RATE * dt,
  );
}

/**
 * Resolve the frame's input into the state: the pointer acts in arrival order,
 * the pointer's current position, each action's press edge once, and the orbit
 * the held keys turn. This is the whole of the player controller's tick.
 */
export function readInput(
  state: GantryState,
  input: InputReader,
  dt: number,
  io: GameIo,
  press: PressCapture,
): void {
  for (const sample of input.pointerSamples()) {
    if (!sample.primary) continue;
    applyPointerAct(
      state,
      { kind: sample.type, x: sample.x, y: sample.y },
      io,
      press,
    );
  }
  // Every update reads the pointer's current position, so a `reset` shows in it
  // only until the next one (`specs/instrumentation.md`).
  const at = input.pointer();
  state.pointer.x = at.x;
  state.pointer.y = at.y;

  // Each action's edge is read exactly once per controller per frame.
  for (const action of ACTIONS) {
    if (input.pressed(action)) handleAction(state, action, io);
  }

  applyCameraKeys(state, input, dt);
}

// ---- The mode's half -------------------------------------------------------

/** The cues one tick raises (`specs/ui.md`). */
function raiseTickCues(
  run: GameRun,
  before: SimRunState,
  after: SimRunState,
  io: GameIo,
): void {
  if (after.brokeThisTick) io.playCue("break");

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
  if (attached) io.playCue("attach");
  if (placed) io.playCue("placed");

  // A member creaks on reaching CREAK_THRESHOLD having been below it on the
  // tick before, at most once across the structure per cooldown, and never on a
  // run's first tick.
  if (after.tick <= 1) return;
  const previous = new Map(before.forces.map((f) => [f.id, f.utilization]));
  const eligible = after.forces.some(
    (f) =>
      f.utilization >= CREAK_THRESHOLD &&
      (previous.get(f.id) ?? 0) < CREAK_THRESHOLD,
  );
  const ready =
    run.lastCreakTick === null ||
    after.tick - run.lastCreakTick >= CREAK_COOLDOWN_TICKS;
  if (!eligible || !ready) return;
  io.playCue("creak");
  run.lastCreakTick = after.tick;
}

/**
 * What the tick that ended a run leaves: a cleared run records the site's score
 * and moves to the results screen, a failed one stays on the run screen with
 * its cause (`specs/ui.md`).
 */
function endRun(state: GantryState, io: GameIo): void {
  const run = state.run;
  if (run.phase === "failed") {
    if (run.cause === "collapse" || run.cause === "ring-overload") {
      io.playCue("collapse");
    }
    io.playCue("fail");
    return;
  }
  if (run.phase !== "cleared") return;
  io.playCue("complete");
  const index = state.siteIndex;
  recordBest(state, index, {
    cost: craneCost(state),
    time: run.tick / TICK_HZ,
  });
  state.cleared[index] = true;
  state.screen = "results";
  state.menuIndex = 0;
}

/**
 * Consume whole ticks from the time gathered. The accumulation belongs to the
 * run — it is empty when one starts — and the watch speed scales what a frame
 * covers and nothing else (`specs/program.md`).
 */
export function advanceTicks(state: GantryState, dt: number, io: GameIo): void {
  const run = state.run;
  if (run.phase !== "running") return;
  const context: RunContext = {
    site: currentSite(state),
    structure: simStructure(currentStructure(state)),
    tape: currentProgram(state),
  };
  const speed = RUN_SPEEDS[run.speedIndex] ?? RUN_SPEEDS[0];
  run.accumulator += dt * speed;
  while (run.accumulator >= TICK_DT && run.phase === "running") {
    run.accumulator -= TICK_DT;
    const before = simRun(run);
    const after = advanceRun(before, context);
    writeRun(run, after);
    raiseTickCues(run, before, after, io);
  }
  if (run.phase !== "running") endRun(state, io);
}

/**
 * The game mode's tick: the frame's own bookkeeping, then whatever whole ticks
 * the time gathered now covers, then the sound the frame leaves running.
 */
export function updateFrame(state: GantryState, dt: number, io: GameIo): void {
  state.simTime += dt;
  state.muted = io.muted();
  advanceTicks(state, dt, io);
  io.setMotor(state.run.phase === "running" && anyAxisMoving(state.run));
  io.setMusic(state.screen === "title" || state.screen === "select");
}

/**
 * Pose the `run` action from outside the screens: the same refusals, the same
 * `run-start`, and the same move to the run screen. Answers whether a run
 * began.
 */
export function requestRun(state: GantryState, io: GameIo): boolean {
  if (!beginRun(state)) return false;
  io.playCue("run-start");
  return true;
}

// ---- The overlay -----------------------------------------------------------

const round = (value: number, places = 2): string => value.toFixed(places);

/**
 * The diagnostic sources the overlay draws (`specs/instrumentation.md`). Each
 * is a zero-argument pure read of the live state at the call, so watching the
 * overlay leaves the game as it is.
 */
export function diagnosticSources(
  state: () => GantryState,
): readonly (readonly [string, () => DiagnosticValue])[] {
  const run = (): GameRun => state().run;
  return [
    ["screen", () => state().screen],
    [
      "site",
      () => {
        const s = state();
        return `${s.siteIndex + 1}/${SITE_COUNT} ${currentSite(s).name}`;
      },
    ],
    ["members", () => currentStructure(state()).members.length],
    [
      "cost",
      () => {
        const s = state();
        return `${round(craneCost(s), 0)}/${currentSite(s).budget}`;
      },
    ],
    [
      "issues",
      () => {
        const s = state();
        return readiness(
          simStructure(currentStructure(s)),
          currentSite(s).anchors,
        ).length;
      },
    ],
    ["run", () => run().phase],
    ["step", () => `${run().stepIndex}/${currentProgram(state()).length}`],
    ["clock", () => `${round(run().tick / TICK_HZ)}s`],
    ["cause", () => run().cause ?? "-"],
    ["slew", () => round(run().axes.slew.value)],
    ["trolley", () => round(run().axes.trolley.value)],
    ["hoist", () => round(run().axes.hoist.value)],
    ["grip", () => round(run().axes.grip.value)],
    [
      "bob",
      () => {
        const at = run().bob.pos;
        return `${round(at.x)}, ${round(at.y)}, ${round(at.z)}`;
      },
    ],
    [
      "util",
      () =>
        round(run().forces.reduce((top, f) => Math.max(top, f.utilization), 0)),
    ],
    ["broken", () => run().broken.length],
    [
      "camera",
      () => {
        const c = state().camera;
        return `${round(c.yaw, 1)} / ${round(c.pitch, 1)} / ${round(c.dist, 1)}`;
      },
    ],
  ];
}
