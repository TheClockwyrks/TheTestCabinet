// Volute — the controls a frame reads, and one tick of the simulation
// (specs/controls.md, specs/channel.md "The order of a tick").
//
// This module is the whole of the game's advance, and it decides everything from
// the state alone: it never reads the canvas, the wall clock, or the renderer.
// What it needs from outside is exactly two things — the actions the player is
// holding, gathered once per update as a {@link Controls}, and the runtime's mute
// bit — and what it hands back is a report of the cues and effects it raised.
//
// The split between the two halves below is the engine's frame model
// (specs/controls.md). The CONTROLS are read once per update, because that is the
// grain the engine delivers an edge at: "the frame that raises a request is the
// frame that consumes it", and a held turn swings the aim "by 180 degrees for
// every second of simulation time the update advances". The TICK is the fixed
// `TICK_DT` step the accumulated frame time is consumed in, and the seven
// numbered steps in it are the specification's, in its order, each reading the
// positions the step before it left.

import {
  AIM_TURN_RATE,
  BORE_RADIUS,
  CLEAR_SCORE,
  CUES,
  DANGER_S,
  FIELD_H,
  FIELD_W,
  FIRE_COOLDOWN,
  INJECTOR_X,
  INJECTOR_Y,
  INTAKE_S,
  INTERLUDE,
  LEVEL_COUNT,
  MACHINERY_DURATIONS,
  PRESSURE_BLEED,
  PRESSURE_FREE,
  PRESSURE_MAX,
  PRESSURE_MIN,
  PRESSURE_RISE_PER_CORE,
  PROJECTILE_SPEED,
  SCORE_PER_CORE,
  SEEDED_CORES,
  SPACING,
} from "./constants";
import type { MachineryKind, Point, ScreenName } from "./constants";
import { INTAKE, pointAt } from "./channel";
import { clamp, resegment, type Draft } from "./draft";
import type { TickReport } from "./events";
import {
  drawCharge,
  emitCore,
  levelSpec,
  normalizeAngle,
  startLevel,
  startRun,
  toTitle,
} from "./level";
import {
  advanceTrain,
  findStrike,
  insertCore,
  removeCores,
  type PendingGrant,
} from "./train";

/**
 * What one update read of the player, gathered once from the engine's input.
 *
 * Every field is already resolved: an edge has been consumed by the read that
 * produced it, and the pointer is a position in the field's own logical units or
 * `null` when none was delivered.
 */
export interface Controls {
  /** `1` for a held turn right, `-1` for left, `0` for neither or both. */
  readonly turn: number;
  /** A pointer position delivered this update, in logical units. */
  readonly pointer: Point | null;
  /** The fire request, raised on the press edge. */
  readonly fire: boolean;
  /** The swap request, raised on the press edge. */
  readonly swap: boolean;
  /** The confirm request, raised on the press edge. */
  readonly confirm: boolean;
  /** The pause request, raised on the press edge. */
  readonly pause: boolean;
}

/** A `Controls` reading nothing, for a frame with no player behind it. */
export const NO_CONTROLS: Controls = {
  turn: 0,
  pointer: null,
  fire: false,
  swap: false,
  confirm: false,
  pause: false,
};

/** Whether the screen advances the simulation at all. */
export function advancesSimulation(screen: ScreenName): boolean {
  return screen === "playing" || screen === "cleared" || screen === "setback";
}

/** Whether the run is in danger: a head standing at or past the threshold. */
export function inDanger(state: {
  readonly cores: readonly { readonly s: number }[];
}): boolean {
  return state.cores.length > 0 && state.cores[0].s >= DANGER_S;
}

// --- The controls -------------------------------------------------------------

/**
 * Read the controls the current screen answers, once for the update.
 *
 * `simAdvance` is the simulation time this update is about to advance, in
 * seconds, which is what the aim turns against. An update that advances no
 * simulation turns the aim by nothing, which is what holds the aim still through
 * a pause and an interlude.
 */
export function readControls(
  draft: Draft,
  controls: Controls,
  simAdvance: number,
  report: TickReport,
): void {
  switch (draft.screen) {
    case "title":
      if (controls.confirm) startRun(draft);
      return;
    case "paused":
      if (controls.pause) draft.screen = "playing";
      return;
    case "gameover":
    case "victory":
      if (controls.confirm) toTitle(draft);
      return;
    case "cleared":
    case "setback":
      // Nothing; the interlude runs on its own timer.
      return;
    case "playing":
      readPlayingControls(draft, controls, simAdvance, report);
      return;
  }
}

/**
 * The hall's own controls: the pointer first and the turn actions second, then
 * the one-shot requests.
 *
 * Fire and swap are live on `playing` alone, and the update that raises a request
 * is the update that consumes it.
 */
function readPlayingControls(
  draft: Draft,
  controls: Controls,
  simAdvance: number,
  report: TickReport,
): void {
  const pointer = controls.pointer;
  if (pointer !== null) {
    const dx = pointer.x - INJECTOR_X;
    const dy = pointer.y - INJECTOR_Y;
    // A pointer exactly at the injector's center names no direction, so the aim
    // is left where it was.
    if (dx !== 0 || dy !== 0) {
      draft.aim = normalizeAngle((Math.atan2(dy, dx) * 180) / Math.PI);
    }
  }

  if (controls.turn !== 0 && simAdvance > 0) {
    draft.aim = normalizeAngle(
      draft.aim + controls.turn * AIM_TURN_RATE * simAdvance,
    );
  }

  if (controls.pause) {
    draft.screen = "paused";
    return;
  }

  if (controls.swap) {
    const loaded = draft.loaded;
    draft.loaded = draft.queued;
    draft.queued = loaded;
    report.cues.add(CUES.swap);
  }

  if (controls.fire) {
    if (draft.fireCooldown > 0) report.cues.add(CUES.denied);
    else fire(draft, report);
  }
}

/**
 * Release the loaded core along the current aim.
 *
 * The queued charge becomes loaded, a fresh charge is drawn as queued, and the
 * cooldown is set. The aim is read, never written: `specs/injector.md` fixes the
 * aim elsewhere, and the debug surface points the injector with `setAim`. A call
 * made while the injector holds no loaded core draws one first, which is what
 * lets the surface's `fire` launch from a bare hall.
 */
export function fire(draft: Draft, report: TickReport): void {
  if (draft.loaded === null) draft.loaded = drawCharge(draft);
  if (draft.queued === null) draft.queued = drawCharge(draft);
  const charge = draft.loaded;
  draft.projectiles.push({
    charge,
    x: INJECTOR_X,
    y: INJECTOR_Y,
    angle: normalizeAngle(draft.aim),
  });
  draft.loaded = draft.queued;
  draft.queued = drawCharge(draft);
  draft.fireCooldown = FIRE_COOLDOWN;
  report.cues.add(CUES.fire);
}

// --- One tick -----------------------------------------------------------------

/**
 * One whole tick of `TICK_DT` seconds.
 *
 * Which screen it is on decides what it advances (specs/ui.md "What advances on
 * each screen"): everything on `playing`, the interlude's own timer on `cleared`
 * and `setback`, and nothing anywhere else — a screen that advances nothing runs
 * no tick at all, so this is never reached on one.
 */
export function stepTick(draft: Draft, dt: number, report: TickReport): void {
  switch (draft.screen) {
    case "cleared":
    case "setback":
      advanceInterlude(draft, dt);
      return;
    case "playing":
      playingTick(draft, dt, report);
      return;
    case "title":
    case "paused":
    case "gameover":
    case "victory":
      return;
  }
}

/** The interlude's own timer, and nothing else, then the level that follows it. */
function advanceInterlude(draft: Draft, dt: number): void {
  if (dt <= 0) return;
  draft.interlude = Math.max(0, draft.interlude - dt);
  if (draft.interlude > 0) return;
  const next = draft.screen === "cleared" ? draft.level + 1 : draft.level;
  startLevel(draft, next);
}

/** Everything: the train, the projectiles, pressure, every timer, and the inlet. */
function playingTick(draft: Draft, dt: number, report: TickReport): void {
  if (dt <= 0) return;

  // 1. Every running timer falls by the tick's elapsed time.
  runTimers(draft, dt);

  // 2. Every segment advances, and a merge that completes a run extracts it.
  //    The debug surface's feed gate holds this step, and only this step, so a
  //    scenario can watch a strike or a removal against a train that stands
  //    still (specs/instrumentation.md — "The driver").
  const grants: PendingGrant[] = [];
  if (draft.feed) advanceTrain(draft, dt, report, grants);

  // 3. Every projectile advances, oldest first, and a strike seats.
  advanceProjectiles(draft, dt, report, grants);

  // 4. Every removal grants the machinery its marked cores carry.
  for (const grant of grants) applyGrant(draft, grant, report);

  // 5. Pressure rises or bleeds.
  runPressure(draft, dt);

  // 6. A core at the intake spends a cell; otherwise an emptied level is cleared.
  if (spendCell(draft, report)) return;
  if (draft.quotaRemaining <= 0 && draft.cores.length === 0) {
    clearLevel(draft, report);
    return;
  }

  // 7. The inlet emits.
  runInlet(draft);
}

/** Step 1: every running timer falls by the tick's elapsed time. */
function runTimers(draft: Draft, dt: number): void {
  draft.fireCooldown = Math.max(0, draft.fireCooldown - dt);

  if (draft.chainTimer > 0) {
    draft.chainTimer = Math.max(0, draft.chainTimer - dt);
    if (draft.chainTimer === 0) draft.chainStep = 1;
  }

  for (const core of draft.cores) core.hold = Math.max(0, core.hold - dt);
  resegment(draft);

  const machinery = draft.machinery;
  if (machinery !== null) {
    machinery.remaining -= dt;
    if (machinery.remaining <= 0) draft.machinery = null;
  }
}

/** Step 3: every projectile advances along its heading, oldest first. */
function advanceProjectiles(
  draft: Draft,
  dt: number,
  report: TickReport,
  grants: PendingGrant[],
): void {
  if (draft.projectiles.length === 0) return;
  const step = PROJECTILE_SPEED * dt;
  const surviving: Draft["projectiles"] = [];

  for (const projectile of draft.projectiles) {
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

    const strike = findStrike(draft.cores, projectile);
    if (strike === null) {
      surviving.push(projectile);
      continue;
    }
    report.cues.add(CUES.seat);
    insertCore(draft, strike, projectile.charge, report, grants);
  }

  draft.projectiles = surviving;
}

/** Step 4: a grant, resolved against the positions the removal left. */
function applyGrant(
  draft: Draft,
  grant: PendingGrant,
  report: TickReport,
): void {
  report.cues.add(CUES.machinery);
  if (grant.kind === "bore") {
    detonate(draft, grant.x, grant.y, report);
    return;
  }
  draft.machinery = {
    kind: grant.kind,
    remaining: MACHINERY_DURATIONS[grant.kind],
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
  draft: Draft,
  x: number,
  y: number,
  report: TickReport,
): void {
  report.fx.push({ kind: "bore", x, y });
  const caught: number[] = [];
  for (let i = 0; i < draft.cores.length; i += 1) {
    const point = pointAt(draft.cores[i].s);
    if (Math.hypot(point.x - x, point.y - y) <= BORE_RADIUS) caught.push(i);
  }
  if (caught.length === 0) return;
  draft.score += SCORE_PER_CORE * caught.length * draft.chainStep;
  removeCores(draft, caught, report, null);
}

/** Step 5: pressure rises with a crowded channel and bleeds off an uncrowded one. */
function runPressure(draft: Draft, dt: number): void {
  const count = draft.cores.length;
  const rise = Math.max(0, count - PRESSURE_FREE) * PRESSURE_RISE_PER_CORE;
  const bleed = count <= PRESSURE_FREE ? PRESSURE_BLEED : 0;
  draft.pressure = clamp(
    draft.pressure + (rise - bleed) * dt,
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
function spendCell(draft: Draft, report: TickReport): boolean {
  if (!draft.cores.some((core) => core.s >= INTAKE_S)) return false;

  report.cues.add(CUES.intake);
  report.cues.add(CUES.cellLost);
  report.fx.push({ kind: "intake", x: INTAKE.x, y: INTAKE.y });

  draft.cells = Math.max(0, draft.cells - 1);
  draft.cores = [];
  draft.projectiles = [];
  draft.pressure = 0;
  draft.machinery = null;
  draft.chainStep = 1;
  draft.chainTimer = 0;
  draft.quotaRemaining = levelSpec(draft.level).quota - SEEDED_CORES;

  if (draft.cells === 0) {
    draft.screen = "gameover";
    draft.interlude = 0;
  } else {
    draft.screen = "setback";
    draft.interlude = INTERLUDE;
  }
  return true;
}

/** Step 6, second half: an exhausted quota over an empty channel clears the level. */
function clearLevel(draft: Draft, report: TickReport): void {
  draft.score += CLEAR_SCORE;
  report.cues.add(CUES.levelClear);
  if (draft.level >= LEVEL_COUNT) {
    draft.screen = "victory";
    draft.interlude = 0;
    return;
  }
  draft.screen = "cleared";
  draft.interlude = INTERLUDE;
}

/**
 * Step 7: the inlet emits.
 *
 * One core at most per tick, only while the quota holds, only once the tail has
 * cleared one spacing, and never while backflow is packing the train against the
 * inlet.
 */
function runInlet(draft: Draft): void {
  // The debug surface's emission gate holds the inlet whatever the quota says.
  if (!draft.emission) return;
  if (draft.quotaRemaining <= 0) return;
  if (draft.machinery?.kind === "backflow") return;
  const tail = draft.cores[draft.cores.length - 1];
  if (tail !== undefined && tail.s < SPACING - 1e-9) return;
  emitCore(draft);
}

/** The three machinery kinds that run on a timer; `bore` resolves at once. */
export type TimedMachineryKind = Exclude<MachineryKind, "bore">;

/**
 * Grant a TIMED machinery kind exactly as extracting a run holding its mark
 * grants it, through the same {@link applyGrant} a removal's grant runs through.
 *
 * `bore` is not one of them: it removes cores and scores the moment it resolves,
 * which is an outcome rather than an arrangement, so the debug surface does not
 * grant it (specs/instrumentation.md — `grantMachinery`). The extraction point a
 * grant carries is therefore never read on this path, and `0, 0` stands for it.
 */
export function grantTimedMachinery(
  draft: Draft,
  kind: TimedMachineryKind,
  report: TickReport,
): void {
  applyGrant(draft, { kind, x: 0, y: 0 }, report);
}
