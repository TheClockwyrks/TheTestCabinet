// Volute — one tick of the simulation (specs/channel.md "The order of a tick").
//
// This module is the whole of the game's advance, and it decides everything from
// the state alone: it never reads the canvas, the wall clock, or the renderer.
// What it needs from outside is exactly two ports — the actions the player is
// holding, and the runtime's mute bit — and what it hands back is a report of the
// cues and effects the tick raised.
//
// The seven numbered steps below are the specification's, in its order, and each
// reads the positions the step before it left.

import {
  AIM_TURN_RATE,
  BORE_RADIUS,
  CLEAR_BONUS,
  DANGER_S,
  FIRE_COOLDOWN,
  INJECTOR_X,
  INJECTOR_Y,
  INTERLUDE,
  LEVEL_COUNT,
  MACHINERY_DURATION,
  PATH_LENGTH,
  PRESSURE_BLEED,
  PRESSURE_FREE,
  PRESSURE_MAX,
  PRESSURE_MIN,
  PRESSURE_RISE_PER_CORE,
  PROJECTILE_SPEED,
  SCORE_PER_CORE,
  SEED_CORES,
  SPACING,
  FIELD_H,
  FIELD_W,
} from "./constants";
import type { MachineryKind } from "./constants";
import { INTAKE, pointAt } from "./channel";
import type { TickReport } from "./events";
import {
  drawCharge,
  emitCore,
  levelSpec,
  normalizeAngle,
  startLevel,
  startRun,
  toTitle,
} from "./state";
import {
  advanceTrain,
  clamp,
  findStrike,
  insertCore,
  removeCores,
  resegment,
  type PendingGrant,
} from "./train";
import type { VoluteState } from "./types";

/** The actions a tick reads. An edge is CONSUMED by the read that sees it. */
export interface TickInput {
  /** Whether the action is held, as `1` or `0`. */
  value(action: string): number;
  /** Whether the action went down since the last read. Consumes the edge. */
  pressed(action: string): boolean;
  /** The pointer's position in logical units, or `null` if none was delivered. */
  pointer(): { x: number; y: number } | null;
}

/** The runtime's mute bit, which the game toggles and reports but does not own. */
export interface TickAudio {
  muted(): boolean;
  setMuted(muted: boolean): void;
}

/** What a tick reaches outside the state. */
export interface TickPorts {
  readonly input: TickInput;
  readonly audio: TickAudio;
}

/** Whether the screen advances the simulation at all. */
export function advancesSimulation(screen: VoluteState["screen"]): boolean {
  return screen === "playing" || screen === "cleared" || screen === "setback";
}

/** Whether the run is in danger: a head standing at or past the threshold. */
export function inDanger(state: { cores: readonly { s: number }[] }): boolean {
  return state.cores.length > 0 && state.cores[0].s >= DANGER_S;
}

/**
 * One whole tick.
 *
 * `dt` is a tick's worth of seconds during play and `0` on a frame that only
 * needed the screen's controls read — the title's confirm, a pause, an ending
 * dismissed — so input answers on every screen at every frame rate.
 */
export function tick(
  state: VoluteState,
  ports: TickPorts,
  dt: number,
  report: TickReport,
): void {
  // Mute answers on every screen. The runtime owns the bit; the state carries the
  // game's readable copy of it, refreshed at the end of every tick.
  if (ports.input.pressed("mute")) ports.audio.setMuted(!ports.audio.muted());

  switch (state.screen) {
    case "title":
      if (ports.input.pressed("confirm")) startRun(state);
      break;
    case "paused":
      if (ports.input.pressed("pause")) state.screen = "playing";
      break;
    case "gameover":
    case "victory":
      if (ports.input.pressed("confirm")) toTitle(state);
      break;
    case "cleared":
    case "setback":
      advanceInterlude(state, dt);
      break;
    case "playing":
      playingTick(state, ports, dt, report);
      break;
  }

  state.muted = ports.audio.muted();
}

/** The interlude's own timer, and nothing else, then the level that follows it. */
function advanceInterlude(state: VoluteState, dt: number): void {
  if (dt <= 0) return;
  state.interlude = Math.max(0, state.interlude - dt);
  if (state.interlude > 0) return;
  const next = state.screen === "cleared" ? state.level + 1 : state.level;
  startLevel(state, next);
}

/** Everything: the train, the projectiles, pressure, every timer, and the inlet. */
function playingTick(
  state: VoluteState,
  ports: TickPorts,
  dt: number,
  report: TickReport,
): void {
  readControls(state, ports, dt, report);
  if (state.screen !== "playing" || dt <= 0) return;

  // 1. Every running timer falls by the tick's elapsed time.
  runTimers(state, dt);

  // 2. Every segment advances, and a merge that completes a run extracts it.
  // The debug surface's feed gate holds the whole step, so a scenario that does
  // not exercise the advance can keep the train exactly where it posed it.
  const grants: PendingGrant[] = [];
  if (state.feed) advanceTrain(state, dt, report, grants);

  // 3. Every projectile advances, oldest first, and a strike seats.
  advanceProjectiles(state, dt, report, grants);

  // 4. Every removal grants the machinery its marked cores carry.
  for (const grant of grants) applyGrant(state, grant, report);

  // 5. Pressure rises or bleeds.
  runPressure(state, dt);

  // 6. A core at the intake spends a cell; otherwise an emptied level is cleared.
  if (spendCell(state, report)) return;
  if (state.quotaRemaining <= 0 && state.cores.length === 0) {
    clearLevel(state, report);
    return;
  }

  // 7. The inlet emits.
  runInlet(state);
}

// --- Controls -----------------------------------------------------------------

/**
 * Resolve the pointer first and the turn actions second, then the one-shot
 * requests.
 *
 * Fire and swap are live on `playing` alone, and the read that raises a request is
 * the read that consumes it.
 */
function readControls(
  state: VoluteState,
  ports: TickPorts,
  dt: number,
  report: TickReport,
): void {
  const pointer = ports.input.pointer();
  if (pointer !== null) {
    const dx = pointer.x - INJECTOR_X;
    const dy = pointer.y - INJECTOR_Y;
    // A pointer exactly at the injector's center names no direction, so the aim
    // is left where it was.
    if (dx !== 0 || dy !== 0) {
      state.aim = normalizeAngle((Math.atan2(dy, dx) * 180) / Math.PI);
    }
  }

  const turn = ports.input.value("right") - ports.input.value("left");
  if (turn !== 0 && dt > 0) {
    state.aim = normalizeAngle(state.aim + turn * AIM_TURN_RATE * dt);
  }

  if (ports.input.pressed("pause")) {
    state.screen = "paused";
    return;
  }

  if (ports.input.pressed("swap")) {
    const loaded = state.loaded;
    state.loaded = state.queued;
    state.queued = loaded;
    report.cues.add("swap");
  }

  if (ports.input.pressed("fire")) {
    if (state.fireCooldown > 0) report.cues.add("denied");
    else fire(state, report);
  }
}

/**
 * Release the loaded core along the current aim.
 *
 * The queued charge becomes loaded, a fresh charge is drawn as queued, and the
 * cooldown is set. A call made while the injector holds no loaded core draws one
 * first, which is what lets the debug surface's `fire` launch from a bare hall.
 */
export function fire(state: VoluteState, report: TickReport): void {
  if (state.loaded === null) state.loaded = drawCharge(state);
  if (state.queued === null) state.queued = drawCharge(state);
  const charge = state.loaded;
  state.projectiles.push({
    charge,
    x: INJECTOR_X,
    y: INJECTOR_Y,
    angle: normalizeAngle(state.aim),
  });
  state.loaded = state.queued;
  state.queued = drawCharge(state);
  state.fireCooldown = FIRE_COOLDOWN;
  report.cues.add("fire");
  report.fx.push({ kind: "fire", x: INJECTOR_X, y: INJECTOR_Y });
}

// --- The numbered steps -------------------------------------------------------

/** Step 1: every running timer falls by the tick's elapsed time. */
function runTimers(state: VoluteState, dt: number): void {
  state.fireCooldown = Math.max(0, state.fireCooldown - dt);

  if (state.chainTimer > 0) {
    state.chainTimer = Math.max(0, state.chainTimer - dt);
    if (state.chainTimer === 0) state.chainStep = 1;
  }

  for (const core of state.cores) core.hold = Math.max(0, core.hold - dt);
  resegment(state);

  const machinery = state.machinery;
  if (machinery !== null) {
    machinery.remaining -= dt;
    if (machinery.remaining <= 0) state.machinery = null;
  }
}

/** Step 3: every projectile advances along its heading, oldest first. */
function advanceProjectiles(
  state: VoluteState,
  dt: number,
  report: TickReport,
  grants: PendingGrant[],
): void {
  if (state.projectiles.length === 0) return;
  const step = PROJECTILE_SPEED * dt;
  const surviving: VoluteState["projectiles"] = [];

  for (const projectile of state.projectiles) {
    const radians = (projectile.angle * Math.PI) / 180;
    projectile.x += Math.cos(radians) * step;
    projectile.y += Math.sin(radians) * step;

    // A projectile whose center leaves the field is discarded on that tick,
    // changing nothing about the train.
    if (
      projectile.x < 0 ||
      projectile.x > FIELD_W ||
      projectile.y < 0 ||
      projectile.y > FIELD_H
    ) {
      continue;
    }

    const strike = findStrike(state.cores, projectile);
    if (strike === null) {
      surviving.push(projectile);
      continue;
    }
    report.cues.add("seat");
    insertCore(state, strike, projectile.charge, report, grants);
  }

  state.projectiles = surviving;
}

/** Step 4: a grant, resolved against the positions the removal left. */
function applyGrant(
  state: VoluteState,
  grant: PendingGrant,
  report: TickReport,
): void {
  report.cues.add("machinery");
  if (grant.kind === "bore") {
    detonate(state, grant.x, grant.y, report);
    return;
  }
  state.machinery = {
    kind: grant.kind,
    remaining: MACHINERY_DURATION[grant.kind],
  };
}

/**
 * A bore: every core whose center lies within `BORE_RADIUS` of the extraction
 * point is removed together and scored, at the chain step already in force.
 *
 * The chain step and the window that resets it are both left alone, so a bore
 * pays at the step the chain stands at and carries the chain no further.
 */
export function detonate(
  state: VoluteState,
  x: number,
  y: number,
  report: TickReport,
): void {
  report.fx.push({ kind: "bore", x, y });
  const caught: number[] = [];
  for (let i = 0; i < state.cores.length; i += 1) {
    const point = pointAt(state.cores[i].s);
    if (Math.hypot(point.x - x, point.y - y) <= BORE_RADIUS) caught.push(i);
  }
  if (caught.length === 0) return;
  state.score += SCORE_PER_CORE * caught.length * state.chainStep;
  removeCores(state, caught, report, null);
}

/** Step 5: pressure rises with a crowded channel and bleeds off an uncrowded one. */
function runPressure(state: VoluteState, dt: number): void {
  const count = state.cores.length;
  const rise = Math.max(0, count - PRESSURE_FREE) * PRESSURE_RISE_PER_CORE;
  const bleed = count <= PRESSURE_FREE ? PRESSURE_BLEED : 0;
  state.pressure = clamp(
    state.pressure + (rise - bleed) * dt,
    PRESSURE_MIN,
    PRESSURE_MAX,
  );
}

/**
 * Step 6, first half: a core standing at the intake spends a cell.
 *
 * A tick spends one cell at most. The spend sets the run back to what a level
 * start leaves it and, when it takes the count to `0`, ends the run in place of
 * restarting the level.
 */
function spendCell(state: VoluteState, report: TickReport): boolean {
  if (!state.cores.some((core) => core.s >= PATH_LENGTH)) return false;

  report.cues.add("intake");
  report.cues.add("cell-lost");
  report.fx.push({ kind: "intake", x: INTAKE.x, y: INTAKE.y });

  state.cells = Math.max(0, state.cells - 1);
  state.cores = [];
  state.segments = [];
  state.projectiles = [];
  state.pressure = 0;
  state.machinery = null;
  state.chainStep = 1;
  state.chainTimer = 0;
  state.quotaRemaining = levelSpec(state.level).quota - SEED_CORES;

  if (state.cells === 0) {
    state.screen = "gameover";
    state.interlude = 0;
  } else {
    state.screen = "setback";
    state.interlude = INTERLUDE;
  }
  return true;
}

/** Step 6, second half: an exhausted quota over an empty channel clears the level. */
function clearLevel(state: VoluteState, report: TickReport): void {
  state.score += CLEAR_BONUS;
  report.cues.add("level-clear");
  if (state.level >= LEVEL_COUNT) {
    state.screen = "victory";
    state.interlude = 0;
    return;
  }
  state.screen = "cleared";
  state.interlude = INTERLUDE;
}

/**
 * Step 7: the inlet emits.
 *
 * One core at most per tick, only while the inlet's gate is open, only while the
 * quota holds, only once the tail has cleared one spacing, and never while
 * backflow is packing the train against the inlet.
 */
function runInlet(state: VoluteState): void {
  if (!state.emission) return;
  if (state.quotaRemaining <= 0) return;
  if (state.machinery?.kind === "backflow") return;
  const tail = state.cores[state.cores.length - 1];
  if (tail !== undefined && tail.s < SPACING - 1e-9) return;
  emitCore(state);
}

/** Grant a machinery kind exactly as extracting a run holding its mark grants it. */
export function grantMachinery(
  state: VoluteState,
  kind: MachineryKind,
  report: TickReport,
): void {
  const head = state.cores[0];
  const point = head === undefined ? INTAKE : pointAt(head.s);
  applyGrant(state, { kind, x: point.x, y: point.y }, report);
}
