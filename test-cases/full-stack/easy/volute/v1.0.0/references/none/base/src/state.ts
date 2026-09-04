// Volute — building the state, opening a level, and every charge draw
// (specs/state.md, specs/progression.md, specs/channel.md, specs/machinery.md).
//
// Three moments make a state: the TITLE values a fresh game and a `reset` hold, a
// RUN opened from the title, and a LEVEL opened by a start, an interlude, or the
// debug surface. Each is written once here so the three agree, since the debug
// surface poses exactly what the controls do.
//
// The mark cadence lives here too, because a mark belongs to the core's place in
// the level's delivery order and that order is exactly "the quota, less what
// remains".

import {
  AIM_START,
  CELLS,
  LEVELS,
  LEVEL_COUNT,
  MARK_CYCLE,
  MARK_INTERVAL,
  SEED_CORES,
  SEED_HEAD_S,
  SPACING,
} from "./constants";
import type { ChargeId, MachineryKind } from "./constants";
import { pick } from "./rng";
import { clamp, resegment } from "./train";
import type { Core, VoluteState } from "./types";

/** The level's figures, for a level number clamped into range. */
export function levelSpec(level: number): (typeof LEVELS)[number] {
  return LEVELS[clamp(Math.round(level), 1, LEVEL_COUNT) - 1];
}

/** An angle folded into `[0, 360)`. */
export function normalizeAngle(degrees: number): number {
  if (!Number.isFinite(degrees)) return 0;
  return ((degrees % 360) + 360) % 360;
}

/** A whole, complete state holding the title screen's values. */
export function createState(seed: number): VoluteState {
  const state: VoluteState = {
    screen: "title",
    score: 0,
    level: 1,
    cells: CELLS,
    quotaRemaining: LEVELS[0].quota,
    pressure: 0,
    chainStep: 1,
    chainTimer: 0,
    machinery: null,
    cores: [],
    segments: [],
    projectiles: [],
    loaded: null,
    queued: null,
    aim: AIM_START,
    fireCooldown: 0,
    interlude: 0,
    simTime: 0,
    accumulator: 0,
    autoStep: true,
    emission: true,
    feed: true,
    muted: false,
    rngState: seed >>> 0,
  };
  return state;
}

/**
 * Return every declared field to its title-screen value.
 *
 * `muted` is deliberately untouched — muting is a player preference the runtime
 * owns — and so is `rngState`, which only a `reset` reseeds.
 */
export function toTitle(state: VoluteState): void {
  state.screen = "title";
  state.score = 0;
  state.level = 1;
  state.cells = CELLS;
  state.quotaRemaining = LEVELS[0].quota;
  state.pressure = 0;
  state.chainStep = 1;
  state.chainTimer = 0;
  state.machinery = null;
  state.cores = [];
  state.segments = [];
  state.projectiles = [];
  state.loaded = null;
  state.queued = null;
  state.aim = AIM_START;
  state.fireCooldown = 0;
  state.interlude = 0;
  state.simTime = 0;
  state.accumulator = 0;
}

/** The distinct charges standing on the channel right now, in charge order. */
export function chargesOnChannel(state: VoluteState): ChargeId[] {
  const seen: ChargeId[] = [];
  for (const core of state.cores) {
    if (!seen.includes(core.charge)) seen.push(core.charge);
  }
  return seen;
}

/**
 * One charge from the game's generator, by the rule an emitted core follows:
 * uniformly over the charges already on the channel, and uniformly over the
 * level's charge set when the channel carries none.
 */
export function drawCharge(state: VoluteState): ChargeId {
  const present = chargesOnChannel(state);
  const from = present.length > 0 ? present : levelSpec(state.level).charges;
  const drawn = pick(state.rngState, from);
  state.rngState = drawn.state;
  return drawn.value;
}

/** One charge drawn uniformly over the level's own charge set. */
export function drawLevelCharge(state: VoluteState): ChargeId {
  const drawn = pick(state.rngState, levelSpec(state.level).charges);
  state.rngState = drawn.state;
  return drawn.value;
}

/**
 * The mark the next core the level delivers carries, or `null` when it carries
 * none.
 *
 * The cores of a level are counted in delivery order — the twelve seeded first,
 * then each the inlet emits — and every twelfth one is marked. The count is the
 * level's quota less what remains, so posing the quota moves the cadence with it.
 */
export function markForNextDelivery(state: VoluteState): MachineryKind | null {
  const ordinal = levelSpec(state.level).quota - state.quotaRemaining + 1;
  if (ordinal % MARK_INTERVAL !== 0) return null;
  const cycle = ordinal / MARK_INTERVAL - 1;
  return MARK_CYCLE[cycle % MARK_CYCLE.length];
}

/** Take one core off the level's quota and build it at `s`. */
function deliver(state: VoluteState, s: number, charge: ChargeId): Core {
  const mark = markForNextDelivery(state);
  state.quotaRemaining = Math.max(0, state.quotaRemaining - 1);
  return { charge, s, mark, hold: 0 };
}

/** Place a core at the inlet, drawing its charge and its mark by the level's rules. */
export function emitCore(state: VoluteState): void {
  const charge = drawCharge(state);
  state.cores.push(deliver(state, 0, charge));
  resegment(state);
}

/**
 * Open `level`, exactly as an interlude opens it: the hall in play, the channel
 * seeded, the quota at what a level start leaves it, and a fresh loaded and queued
 * core.
 *
 * The score, the cells, and the aim are untouched — the aim keeps its value across
 * a level change.
 */
export function startLevel(state: VoluteState, level: number): void {
  const number = clamp(Math.round(level), 1, LEVEL_COUNT);
  state.level = number;
  state.screen = "playing";
  state.quotaRemaining = levelSpec(number).quota;
  state.pressure = 0;
  state.chainStep = 1;
  state.chainTimer = 0;
  state.machinery = null;
  state.projectiles = [];
  state.interlude = 0;
  state.cores = [];
  state.segments = [];

  // Head first, so the seeded core standing at the inlet is the level's twelfth
  // and carries the level's first mark.
  for (let i = 0; i < SEED_CORES; i += 1) {
    const charge = drawLevelCharge(state);
    state.cores.push(deliver(state, SEED_HEAD_S - i * SPACING, charge));
  }
  resegment(state);

  state.loaded = drawCharge(state);
  state.queued = drawCharge(state);
}

/** Pose what the start control on the title does: a fresh run, opened on level 1. */
export function startRun(state: VoluteState): void {
  state.score = 0;
  state.cells = CELLS;
  startLevel(state, 1);
}
