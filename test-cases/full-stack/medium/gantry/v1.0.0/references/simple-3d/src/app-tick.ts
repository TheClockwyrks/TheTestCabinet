// One frame's update: the next state, from the current one.
//
// The engine owns the frame loop and hands this the frame's delta in seconds.
// What the frame does with it is fixed: its own bookkeeping first, then the
// pointer acts and the actions that arrived since the last frame, then the
// camera against that delta, then whatever whole `1 / TICK_HZ` ticks the
// accumulation now covers. Outside a run nothing ticks; `simTime` accumulates
// every update's delta whatever the screen (`specs/overview.md`).
//
// Audio is reachable from `update` alone, so this is also where the cues the
// pure transitions raised are played and where the `motor` loop and the music
// bed are held to what the state says (`specs/ui.md`).

import type { UpdateApi } from "@test-cabinet/simple-3d";
import {
  ACTIONS,
  CLICK_SLOP,
  CREAK_COOLDOWN,
  CREAK_THRESHOLD,
  ORBIT_KEY_RATE,
  ORBIT_PER_PX,
  RUN_SPEEDS,
  TICK_HZ,
  ZOOM_RATE,
  type ActionName,
} from "./constants";
import { MUSIC_CUE } from "./assets";
import { fromSimRun, thaw, toSimRun } from "./convert";
import { applyClick } from "./editor";
import type { GantryState, ReadonlyGantryState, RunState } from "./game";
import { handleAction, handlePointer, type StagePointerEvent } from "./screens";
import { advanceRun, AXIS_NAMES, type RunContext } from "./sim";
import {
  craneCost,
  currentSimStructure,
  currentSite,
  currentTape,
  isYardScreen,
  menuLength,
  poseCamera,
  raise,
  recordBest,
} from "./state";

/** A tick covers this many seconds (`specs/overview.md`). */
export const TICK_DT = 1 / TICK_HZ;

/** The creak cooldown, as the whole tick count `specs/ui.md` counts it in. */
const CREAK_COOLDOWN_TICKS = CREAK_COOLDOWN * TICK_HZ;

/** Whether any axis is turning, which is what the `motor` loop reads. */
const anyAxisMoving = (run: RunState): boolean =>
  AXIS_NAMES.some((name) => run.axes[name].rate !== 0);

/**
 * Advance the game by one frame.
 *
 * The state arrives read-only; this thaws it once, works on that copy, and
 * returns it, so nothing the engine still holds is written.
 */
export function updateGame(
  state: ReadonlyGantryState,
  api: UpdateApi,
  dt: number,
): GantryState {
  let s = thaw(state);
  s.simTime += dt;
  s.muted = api.audio.muted();

  for (const sample of api.input.pointerSamples()) {
    if (!sample.primary) continue;
    s = applyPointerEvent(s, {
      kind: sample.type,
      x: sample.x,
      y: sample.y,
    });
  }
  // Every update reads the pointer's current position, so a `reset` shows in
  // it only until the next one (`specs/instrumentation.md`).
  const pointer = api.input.pointer();
  s.pointer.x = pointer.x;
  s.pointer.y = pointer.y;

  for (const action of ACTIONS) {
    if (api.input.pressed(action)) s = handleAction(s, action);
  }

  // The engine owns the mute bit; `state.muted` is the game's readable copy, so
  // an action that toggled it is pushed back before it is mirrored again.
  if (s.muted !== api.audio.muted()) api.audio.setMuted(s.muted);

  s = applyCameraKeys(s, api, dt);
  s = advanceTicks(s, dt);

  playCues(s, api);
  holdLoops(s, api);
  s.muted = api.audio.muted();
  return s;
}

// ---- The pointer -----------------------------------------------------------

/**
 * One pointer act. The press is followed here rather than read afresh, so a
 * click and an orbit drag are told apart by what the state kept
 * (`specs/controls.md`).
 */
export function applyPointerEvent(
  state: GantryState,
  event: StagePointerEvent,
): GantryState {
  const pointer = state.pointer;

  if (event.kind === "down") {
    const pressed = state;
    pressed.pointer = {
      x: event.x,
      y: event.y,
      down: true,
      pressX: event.x,
      pressY: event.y,
      dragging: false,
      captured: false,
    };
    if (pressed.screen !== "program" && menuLength(pressed) === 0) {
      return pressed;
    }
    const outcome = handlePointer(pressed, event);
    if (!outcome.consumed) return outcome.state;
    outcome.state.pointer.captured = true;
    return outcome.state;
  }

  if (event.kind === "move") {
    const wasX = pointer.x;
    const wasY = pointer.y;
    const captured = pointer.captured;
    const down = pointer.down;
    const dragging = pointer.dragging;
    state.pointer.x = event.x;
    state.pointer.y = event.y;
    // A menu follows the pointer whether or not a press is live
    // (`specs/ui.md`), so its moves reach the screen before the drag rules.
    if (menuLength(state) > 0) return handlePointer(state, event).state;
    if (captured) return handlePointer(state, event).state;
    if (!down) return state;
    if (!dragging) {
      const travelled = Math.hypot(
        event.x - pointer.pressX,
        event.y - pointer.pressY,
      );
      // The move that carries a press across the boundary turns nothing.
      if (travelled < CLICK_SLOP) return state;
      state.pointer.dragging = true;
      return state;
    }
    if (!isYardScreen(state.screen)) return state;
    state.camera = poseCamera(
      state.camera.yaw + (event.x - wasX) * ORBIT_PER_PX,
      state.camera.pitch - (event.y - wasY) * ORBIT_PER_PX,
      state.camera.dist,
    );
    return state;
  }

  let released = state;
  if (menuLength(state) > 0) {
    released = handlePointer(state, event).state;
  } else if (pointer.captured) {
    released = handlePointer(state, event).state;
  } else if (pointer.down && !pointer.dragging) {
    released = applyReleaseClick(state);
  }
  released.pointer.down = false;
  released.pointer.dragging = false;
  released.pointer.captured = false;
  return released;
}

/** A click, applied at the position the press was released from. */
function applyReleaseClick(state: GantryState): GantryState {
  if (state.screen !== "build") return state;
  return applyClick(state).state;
}

// ---- The camera ------------------------------------------------------------

/**
 * The orbit camera against the frame's delta time, on the three yard screens
 * (`specs/controls.md`).
 */
export function applyCameraKeys(
  state: GantryState,
  api: UpdateApi,
  dt: number,
): GantryState {
  if (!isYardScreen(state.screen)) return state;
  const held = (action: ActionName): number =>
    api.input.value(action) > 0 ? 1 : 0;
  const yawTurn = held("right") - held("left");
  const pitchTurn = held("up") - held("down");
  const zoom = held("zoom-out") - held("zoom-in");
  if (yawTurn === 0 && pitchTurn === 0 && zoom === 0) return state;
  state.camera = poseCamera(
    state.camera.yaw + yawTurn * ORBIT_KEY_RATE * dt,
    state.camera.pitch + pitchTurn * ORBIT_KEY_RATE * dt,
    state.camera.dist + zoom * ZOOM_RATE * dt,
  );
  return state;
}

// ---- The run ---------------------------------------------------------------

/**
 * Consume whole ticks from the accumulation. The accumulation belongs to the
 * run — it is empty when one starts — and the watch speed scales what a frame
 * covers and nothing else (`specs/program.md`).
 */
export function advanceTicks(state: GantryState, dt: number): GantryState {
  if (state.run.phase !== "running") return state;
  const context: RunContext = {
    site: currentSite(state),
    structure: currentSimStructure(state),
    tape: currentTape(state),
  };
  const members = context.structure.members;
  const speed = RUN_SPEEDS[state.run.speedIndex] ?? RUN_SPEEDS[0];
  let accumulator = state.run.internals.accumulator + dt * speed;
  let run = state.run;
  while (accumulator >= TICK_DT && run.phase === "running") {
    accumulator -= TICK_DT;
    const before = run;
    const advanced = advanceRun(toSimRun(before, members), context);
    run = raiseTickCues(
      state,
      before,
      fromSimRun(
        advanced,
        before.speedIndex,
        0,
        before.internals.lastCreakTick,
      ),
    );
  }
  run.internals.accumulator = accumulator;
  state.run = run;
  return run.phase === "running" ? state : endRun(state);
}

/** The cues one tick raises (`specs/ui.md`). */
export function raiseTickCues(
  state: GantryState,
  before: RunState,
  after: RunState,
): RunState {
  if (after.internals.brokeThisTick) raise(state, "break", after.pivot);

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
  if (attached) raise(state, "attach", after.bob.pos);
  if (placed) raise(state, "placed", after.bob.pos);

  // A member creaks on reaching CREAK_THRESHOLD having been below it on the
  // tick before, at most once across the structure per cooldown, and never on
  // a run's first tick.
  if (after.tick > 1) {
    const previous = new Map(before.forces.map((f) => [f.id, f.utilization]));
    const eligible = after.forces.some(
      (f) =>
        f.utilization >= CREAK_THRESHOLD &&
        (previous.get(f.id) ?? 0) < CREAK_THRESHOLD,
    );
    const last = after.internals.lastCreakTick;
    const ready = last === null || after.tick - last >= CREAK_COOLDOWN_TICKS;
    if (eligible && ready) {
      raise(state, "creak", after.pivot);
      after.internals.lastCreakTick = after.tick;
    }
  }
  return after;
}

/**
 * What the tick that ended a run leaves: a cleared run records the site's score
 * and moves to the results screen, a failed one stays on the run screen with
 * its cause (`specs/ui.md`).
 */
export function endRun(state: GantryState): GantryState {
  const run = state.run;
  if (run.phase === "failed") {
    if (run.cause === "collapse" || run.cause === "ring-overload") {
      raise(state, "collapse", run.pivot);
    }
    raise(state, "fail");
    return state;
  }
  if (run.phase !== "cleared") return state;
  raise(state, "complete");
  const index = state.siteIndex;
  const score = { cost: craneCost(state), time: run.tick / TICK_HZ };
  const scored = recordBest(state, index, score);
  scored.cleared[index] = true;
  scored.screen = "results";
  scored.menuIndex = 0;
  return scored;
}

// ---- Sound -----------------------------------------------------------------

/** Play every cue the frame's transitions raised, and empty the queue. */
export function playCues(state: GantryState, api: UpdateApi): void {
  for (const raised of state.cues) {
    if (raised.at === null) api.audio.play(raised.cue);
    else api.audio.play(raised.cue, { at: { ...raised.at } });
  }
  state.cues = [];
}

/**
 * Hold the two loops to what the state says: `motor` while a run is in progress
 * and any axis is turning, and the music bed under the title and select
 * screens (`specs/ui.md`).
 */
export function holdLoops(state: GantryState, api: UpdateApi): void {
  const motor = state.run.phase === "running" && anyAxisMoving(state.run);
  const at = { ...state.run.pivot };
  if (motor && !api.audio.looping("motor")) api.audio.loop("motor", { at });
  else if (motor) api.audio.place("motor", at);
  else if (api.audio.looping("motor")) api.audio.stop("motor");

  const music = state.screen === "title" || state.screen === "select";
  if (music && !api.audio.looping(MUSIC_CUE)) api.audio.loop(MUSIC_CUE);
  else if (!music && api.audio.looping(MUSIC_CUE)) api.audio.stop(MUSIC_CUE);
}
