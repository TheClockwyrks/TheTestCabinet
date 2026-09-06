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
  MACHINERY_KINDS,
  MARK_INTERVAL,
  SEEDED_CORES,
  SEEDED_HEAD_S,
  SPACING,
} from "./constants";
import type { ChargeId, Level, MachineryKind } from "./constants";
import { clamp, resegment, type Draft, type DraftCore } from "./draft";
import { pick } from "./rng";

/** The level's figures, for a level number clamped into range. */
export function levelSpec(level: number): Level {
  return LEVELS[clamp(Math.round(level), 1, LEVEL_COUNT) - 1];
}

/** An angle folded into `[0, 360)`. */
export function normalizeAngle(degrees: number): number {
  if (!Number.isFinite(degrees)) return 0;
  return ((degrees % 360) + 360) % 360;
}

/** A whole, complete draft holding the title screen's values. */
export function createDraft(): Draft {
  return {
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
    projectiles: [],
    loaded: null,
    queued: null,
    aim: AIM_START,
    fireCooldown: 0,
    interlude: 0,
    simTime: 0,
    accumulator: 0,
    emission: true,
    feed: true,
    muted: false,
    nextEmitted: null,
  };
}

/**
 * Return every declared field to its title-screen value.
 *
 * `muted` is deliberately untouched — muting is a player preference the runtime
 * owns. `emission` and `feed` are untouched too: they belong to the caller
 * driving the game rather than to the run being played
 * (specs/instrumentation.md).
 */
export function toTitle(draft: Draft): void {
  draft.screen = "title";
  draft.score = 0;
  draft.level = 1;
  draft.cells = CELLS;
  draft.quotaRemaining = LEVELS[0].quota;
  draft.pressure = 0;
  draft.chainStep = 1;
  draft.chainTimer = 0;
  draft.machinery = null;
  draft.cores = [];
  draft.projectiles = [];
  draft.loaded = null;
  draft.queued = null;
  draft.aim = AIM_START;
  draft.fireCooldown = 0;
  draft.interlude = 0;
  draft.simTime = 0;
  draft.accumulator = 0;
  draft.nextEmitted = null;
}

/** The distinct charges standing on the channel right now, in train order. */
export function chargesOnChannel(draft: Draft): ChargeId[] {
  const seen: ChargeId[] = [];
  for (const core of draft.cores) {
    if (!seen.includes(core.charge)) seen.push(core.charge);
  }
  return seen;
}

/**
 * One charge by the rule an emitted core follows: uniformly over the charges
 * already on the channel, and uniformly over the level's charge set when the
 * channel carries none.
 */
export function drawCharge(draft: Draft): ChargeId {
  const present = chargesOnChannel(draft);
  return pick(present.length > 0 ? present : levelSpec(draft.level).charges);
}

/** One charge drawn uniformly over the level's own charge set. */
export function drawLevelCharge(draft: Draft): ChargeId {
  return pick(levelSpec(draft.level).charges);
}

/**
 * The mark the next core the level delivers carries, or `null` when it carries
 * none.
 *
 * The cores of a level are counted in delivery order — the twelve seeded first,
 * then each the inlet emits — and every twelfth one is marked, the kinds
 * following the fixed cycle `MACHINERY_KINDS` names. The count is the level's
 * quota less what remains, so posing the quota moves the cadence with it.
 */
export function markForNextDelivery(draft: Draft): MachineryKind | null {
  const ordinal = levelSpec(draft.level).quota - draft.quotaRemaining + 1;
  if (ordinal % MARK_INTERVAL !== 0) return null;
  const cycle = ordinal / MARK_INTERVAL - 1;
  return MACHINERY_KINDS[cycle % MACHINERY_KINDS.length];
}

/** Take one core off the level's quota and build it at `s`. */
function deliver(draft: Draft, s: number, charge: ChargeId): DraftCore {
  const mark = markForNextDelivery(draft);
  draft.quotaRemaining = Math.max(0, draft.quotaRemaining - 1);
  return { charge, s, mark, hold: 0 };
}

/**
 * Place a core at the inlet, drawing its charge and its mark by the level's
 * rules.
 *
 * A charge the debug surface posed with `setNextEmitted` stands in for the
 * draw, and this emission consumes it, so the one after is drawn again.
 */
export function emitCore(draft: Draft): void {
  const posed = draft.nextEmitted;
  draft.nextEmitted = null;
  const charge = posed ?? drawCharge(draft);
  draft.cores.push(deliver(draft, 0, charge));
  resegment(draft);
}

/**
 * Open `level`, exactly as an interlude opens it: the hall in play, the channel
 * seeded, the quota at what a level start leaves it, and a fresh loaded and
 * queued core.
 *
 * The score, the cells, and the aim are untouched — the aim keeps its value
 * across a pause, an interlude, and a level change.
 */
export function startLevel(draft: Draft, level: number): void {
  const number = clamp(Math.round(level), 1, LEVEL_COUNT);
  draft.level = number;
  draft.screen = "playing";
  draft.quotaRemaining = levelSpec(number).quota;
  draft.pressure = 0;
  draft.chainStep = 1;
  draft.chainTimer = 0;
  draft.machinery = null;
  draft.projectiles = [];
  draft.interlude = 0;
  draft.cores = [];

  // Head first, so the seeded core standing at the inlet is the level's twelfth
  // and carries the level's first mark.
  for (let i = 0; i < SEEDED_CORES; i += 1) {
    const charge = drawLevelCharge(draft);
    draft.cores.push(deliver(draft, SEEDED_HEAD_S - i * SPACING, charge));
  }
  resegment(draft);

  draft.loaded = drawCharge(draft);
  draft.queued = drawCharge(draft);
}

/** What the start control on the title does: a fresh run, opened on level 1. */
export function startRun(draft: Draft): void {
  draft.score = 0;
  draft.cells = CELLS;
  startLevel(draft, 1);
}
