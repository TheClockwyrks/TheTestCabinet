// Volute — opening a level, the inlet's emissions, and every charge draw
// (specs/progression.md, specs/channel.md, specs/machinery.md).
//
// Three moments make a run: the TITLE values, a RUN opened from the title, and a
// LEVEL opened by a start, an interlude, or the debug surface. Each is written
// once here so the three agree, since the debug surface poses exactly what the
// controls do.
//
// The mark cadence lives here too, because a mark belongs to the core's place in
// the level's delivery order and that order is exactly "the quota, less what
// remains".

import {
  CELLS,
  LEVELS,
  LEVEL_COUNT,
  MACHINERY_KINDS,
  MARK_INTERVAL,
  SEEDED_CORES,
  SEEDED_HEAD_S,
  SPACING,
} from "./constants";
import type { ChargeId, LevelSpec, MachineryKind } from "./constants";
import type { Core, Injector, Projectile } from "./actors";
import { clamp } from "./math";
import type { HallState } from "./state";
import { resegment, type TrainPorts } from "./train";

/** What opening a level and emitting a core need from the world they stand in. */
export interface HallPorts extends TrainPorts {
  /** One charge drawn at random, uniformly over `from`. */
  drawCharge(from: readonly ChargeId[]): ChargeId;
  /** The charge posed for the next emission, taken so the pose is consumed. */
  takeNextEmitted(): ChargeId | null;
  /** Take a core in flight out of the world. */
  destroyProjectile(projectile: Projectile): void;
  /** The hall's one injector. */
  injector(): Injector;
  /** Drop every live effect: what a fresh level and a cell spend leave behind. */
  clearEffects(): void;
}

/** The level's figures, for a level number clamped into range. */
export function levelSpec(level: number): LevelSpec {
  return LEVELS[clamp(Math.round(level), 1, LEVEL_COUNT) - 1];
}

/** The distinct charges standing on the channel right now, head-first order. */
export function chargesOnChannel(state: HallState): ChargeId[] {
  const seen: ChargeId[] = [];
  for (const core of state.cores) {
    if (!seen.includes(core.charge)) seen.push(core.charge);
  }
  return seen;
}

/**
 * One charge by the rule an emitted core follows: uniformly over the charges
 * already on the channel, and uniformly over the level's charge set when the
 * channel carries none.
 */
export function drawEmissionCharge(
  state: HallState,
  ports: HallPorts,
): ChargeId {
  const present = chargesOnChannel(state);
  return ports.drawCharge(
    present.length > 0 ? present : levelSpec(state.level).charges,
  );
}

/** One charge drawn uniformly over the level's own charge set. */
export function drawLevelCharge(state: HallState, ports: HallPorts): ChargeId {
  return ports.drawCharge(levelSpec(state.level).charges);
}

/**
 * The mark the next core the level delivers carries, or `null` for none.
 *
 * The cores of a level are counted in delivery order — the twelve seeded first,
 * then each the inlet emits — and every twelfth one is marked, the kinds
 * following the fixed cycle. The count is the level's quota less what remains,
 * so posing the quota moves the cadence with it.
 */
export function markForNextDelivery(state: HallState): MachineryKind | null {
  const ordinal = levelSpec(state.level).quota - state.quotaRemaining + 1;
  if (ordinal % MARK_INTERVAL !== 0) return null;
  const cycle = ordinal / MARK_INTERVAL - 1;
  return MACHINERY_KINDS[cycle % MACHINERY_KINDS.length];
}

/** Take one core off the level's quota and stand it on the channel at `s`. */
function deliver(
  state: HallState,
  ports: HallPorts,
  s: number,
  charge: ChargeId,
): Core {
  const mark = markForNextDelivery(state);
  state.quotaRemaining = Math.max(0, state.quotaRemaining - 1);
  return ports.spawnCore(charge, s, mark, 0);
}

/**
 * Place a core at the inlet, by the level's charge and mark rules.
 *
 * A charge the debug surface posed with `setNextEmitted` stands in for the
 * draw, and this emission consumes it, so the one after is drawn again.
 */
export function emitCore(state: HallState, ports: HallPorts): void {
  const charge = ports.takeNextEmitted() ?? drawEmissionCharge(state, ports);
  state.cores.push(deliver(state, ports, 0, charge));
  resegment(state);
}

/** Discard every core in flight, changing nothing about the train. */
export function clearProjectiles(state: HallState, ports: HallPorts): void {
  for (const projectile of state.projectiles)
    ports.destroyProjectile(projectile);
  state.projectiles = [];
}

/** Take every core off the channel, with no removal and so no recoil. */
export function clearChannel(state: HallState, ports: HallPorts): void {
  for (const core of state.cores) ports.destroyCore(core);
  state.cores = [];
  state.segments = [];
}

/**
 * Open `level`, exactly as an interlude opens it: the hall in play, the channel
 * seeded, the quota at what a level start leaves it, and a fresh loaded and
 * queued core.
 *
 * The score, the cells, and the aim are untouched — the aim keeps its value
 * across a level change.
 */
export function openLevel(
  state: HallState,
  ports: HallPorts,
  level: number,
): void {
  const number = clamp(Math.round(level), 1, LEVEL_COUNT);
  state.level = number;
  state.screen = "playing";
  state.quotaRemaining = levelSpec(number).quota;
  state.pressure = 0;
  state.chainStep = 1;
  state.chainTimer = 0;
  state.machinery = null;
  state.interlude = 0;
  clearProjectiles(state, ports);
  clearChannel(state, ports);
  ports.clearEffects();

  // Head first, so the seeded core standing at the inlet is the level's twelfth
  // and carries the level's first mark.
  for (let i = 0; i < SEEDED_CORES; i += 1) {
    const charge = drawLevelCharge(state, ports);
    state.cores.push(
      deliver(state, ports, SEEDED_HEAD_S - i * SPACING, charge),
    );
  }
  resegment(state);

  // Only the two charges: `specs/instrumentation.md` states exactly what opening
  // a level changes, and the cooldown is not among it — an outstanding one runs
  // out on its own, as it does across a pause.
  const injector = ports.injector();
  injector.setLoaded(drawEmissionCharge(state, ports));
  injector.queued = drawEmissionCharge(state, ports);
}

/**
 * Pose what the start control on the title does: a fresh run, opened on level 1.
 */
export function openRun(state: HallState, ports: HallPorts): void {
  state.score = 0;
  state.cells = CELLS;
  openLevel(state, ports, 1);
}
