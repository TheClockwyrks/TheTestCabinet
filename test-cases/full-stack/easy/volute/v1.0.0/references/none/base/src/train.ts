// Volute — the train on the channel (specs/channel.md, specs/extraction.md,
// specs/injector.md).
//
// Everything that moves a core along the channel or takes one off it lives here:
// segments, the advance and the merge clamp, backflow, an insertion and the shift
// it forces, a maximal run, an extraction, and the recoil a removal leaves.
//
// Two invariants the whole file rests on:
//
//   * `state.cores` is ordered HEAD FIRST, so arc positions descend along it.
//     Every index in this file is an index into that order.
//   * A segment boundary is derived, never stored: two consecutive cores are in
//     one segment exactly when their arc positions differ by one `SPACING`.
//     `resegment` is called after every mutation, and it is what keeps
//     `state.segments` and the per-core recoil holds honest.

import {
  CATCHUP,
  CHOKE_FACTOR,
  LEVELS,
  MIN_RUN,
  PRESSURE_DROP_PER_CORE,
  PRESSURE_MAX,
  PRESSURE_MIN,
  RECOIL,
  RECOIL_HOLD,
  SCORE_PER_CORE,
  SPACING,
  CHAIN_RESET,
  EXTRACT_CUES,
  BACKFLOW_SPEED,
  STRIKE_DISTANCE,
} from "./constants";
import type { ChargeId, MachineryKind } from "./constants";
import { forwardAt, pointAt } from "./channel";
import type { TickReport } from "./events";
import type { Core, Projectile, VoluteState } from "./types";

/**
 * The slack allowed when two arc positions are asked to differ by exactly one
 * spacing.
 *
 * Segment members are moved by adding the SAME delta to each, so their
 * differences survive to the last few bits; this is wide enough to absorb that
 * and far narrower than any distance the game can otherwise produce.
 */
const SPACING_EPSILON = 1e-6;

/** Whether two consecutive cores stand one spacing apart, and so ride as one. */
export function spaced(ahead: Core, behind: Core): boolean {
  return Math.abs(ahead.s - behind.s - SPACING) <= SPACING_EPSILON;
}

/** Clamp a value into a closed range. */
export function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}

/**
 * Rebuild `state.segments` from the spacing, and normalize the recoil holds.
 *
 * Called after every mutation of the train. A segment's hold is its HEAD core's
 * hold, which is how "the merged segment carries the recoil hold of the segment
 * ahead" and "two groups a recoil leaves exactly the channel spacing apart are
 * one segment, carrying the hold of the group ahead" both fall out of one rule;
 * the rest of the segment is then written to match, so no stale hold can resurface
 * if the segment is later split by an insertion or an extraction.
 */
export function resegment(state: VoluteState): void {
  const segments = state.segments;
  segments.length = 0;
  const cores = state.cores;
  let start = 0;
  for (let i = 1; i <= cores.length; i += 1) {
    if (i === cores.length || !spaced(cores[i - 1], cores[i])) {
      const hold = cores[start].hold;
      for (let j = start; j < i; j += 1) cores[j].hold = hold;
      segments.push({ count: i - start, hold });
      start = i;
    }
  }
}

/** The index in `state.cores` of the first core of each segment, head first. */
function segmentHeads(state: VoluteState): number[] {
  const heads: number[] = [];
  let index = 0;
  for (const segment of state.segments) {
    heads.push(index);
    index += segment.count;
  }
  return heads;
}

/** The last index of the segment whose first core is `start`. */
function segmentEnd(state: VoluteState, start: number): number {
  const cores = state.cores;
  let end = start;
  while (end + 1 < cores.length && spaced(cores[end], cores[end + 1])) end += 1;
  return end;
}

/** The lead segment's speed: the level's feed under pressure and under choke. */
export function effectiveFeed(state: VoluteState): number {
  const level = LEVELS[clamp(state.level, 1, LEVELS.length) - 1];
  const choke = state.machinery?.kind === "choke" ? CHOKE_FACTOR : 1;
  return level.feed * (1 + state.pressure / 100) * choke;
}

// --- Advance ------------------------------------------------------------------

/**
 * Step 2 of a tick: every segment advances, from the lead segment back toward the
 * tail, and a segment reaching the one ahead of it merges with it.
 *
 * The pass walks the segments in the order they stood in when the step began — a
 * merge-caused extraction can rewrite the train underneath it, so each entry is
 * re-resolved against the live train before it is advanced, and one that an
 * extraction has taken or folded into an already-advanced segment is passed over.
 */
export function advanceTrain(
  state: VoluteState,
  dt: number,
  report: TickReport,
  grants: PendingGrant[],
): void {
  if (state.machinery?.kind === "backflow") {
    backflow(state, dt);
    resegment(state);
    return;
  }

  const order = segmentHeads(state).map((index) => state.cores[index]);
  const advanced = new Set<Core>();

  for (const head of order) {
    const index = state.cores.indexOf(head);
    if (index < 0) continue;
    // Folded into a segment ahead of it, which has already had its turn.
    if (index > 0 && spaced(state.cores[index - 1], head)) continue;
    if (advanced.has(head)) continue;
    advanced.add(head);
    if (head.hold > 0) continue;

    const end = segmentEnd(state, index);
    const lead = index === 0;
    let delta = (lead ? effectiveFeed(state) : CATCHUP) * dt;
    let merged = false;

    if (!lead) {
      // The tail of the segment ahead, at the position its own advance left it.
      const limit = state.cores[index - 1].s - SPACING;
      // A segment merges when its head REACHES this position, so an advance that
      // lands exactly on it merges just as one that would carry the head past it
      // does. The tolerance is `spaced`'s own: it is `spaced` that decides the two
      // are one segment afterwards, and a merge it counts must be a merge this
      // clamp counted too, or the join would be made without the extraction it
      // owes.
      if (head.s + delta >= limit - SPACING_EPSILON) {
        delta = limit - head.s;
        merged = true;
      }
    }

    for (let i = index; i <= end; i += 1) state.cores[i].s += delta;

    if (merged) {
      // The merged segment carries the recoil hold of the segment ahead.
      const hold = state.cores[index - 1].hold;
      for (let i = index; i <= end; i += 1) state.cores[i].hold = hold;
      resegment(state);
      extractAcrossJoin(state, index, report, grants);
    }
  }

  resegment(state);
}

/**
 * While backflow is active every core moves toward the inlet, whatever segment it
 * belongs to and whatever hold it carries.
 *
 * Walked from the tail forward, so each core reads the position the core behind it
 * has already taken and stops one spacing ahead of it. The tail stops at `0`, and
 * a core standing below `0` holds where it stands.
 */
function backflow(state: VoluteState, dt: number): void {
  const cores = state.cores;
  const step = BACKFLOW_SPEED * dt;
  for (let i = cores.length - 1; i >= 0; i -= 1) {
    const core = cores[i];
    if (core.s < 0) continue;
    const floor = i === cores.length - 1 ? 0 : cores[i + 1].s + SPACING;
    core.s = Math.max(floor, core.s - step);
  }
}

// --- Runs and extraction ------------------------------------------------------

/**
 * The maximal same-charge run containing `index`, within that core's segment.
 *
 * Returned as the inclusive index range `[from, to]`. A run is bounded by a core
 * of another charge, by the end of the train, or by a break in the spacing.
 */
export function maximalRun(
  cores: readonly Core[],
  index: number,
): { from: number; to: number } {
  const charge = cores[index].charge;
  let from = index;
  while (
    from > 0 &&
    spaced(cores[from - 1], cores[from]) &&
    cores[from - 1].charge === charge
  ) {
    from -= 1;
  }
  let to = index;
  while (
    to + 1 < cores.length &&
    spaced(cores[to], cores[to + 1]) &&
    cores[to + 1].charge === charge
  ) {
    to += 1;
  }
  return { from, to };
}

/**
 * A merge has just joined the core at `index` onto the one ahead of it: extract
 * the run spanning the join when the two carry the same charge and the maximal
 * run reaches the minimum.
 *
 * A merge extraction scores at the INCREMENTED chain step.
 */
function extractAcrossJoin(
  state: VoluteState,
  index: number,
  report: TickReport,
  grants: PendingGrant[],
): void {
  if (index === 0) return;
  const cores = state.cores;
  if (cores[index - 1].charge !== cores[index].charge) return;
  const run = maximalRun(cores, index);
  if (run.to - run.from + 1 < MIN_RUN) return;
  extract(state, run.from, run.to, state.chainStep + 1, report, grants);
}

/**
 * An insertion has just seated a core at `index`: extract the run containing it
 * when the maximal run within its segment reaches the minimum.
 *
 * An insertion extraction scores at chain step `1`, whatever step the chain stood
 * at.
 */
function extractAroundInsertion(
  state: VoluteState,
  index: number,
  report: TickReport,
  grants: PendingGrant[],
): void {
  const run = maximalRun(state.cores, index);
  if (run.to - run.from + 1 < MIN_RUN) return;
  extract(state, run.from, run.to, 1, report, grants);
}

/**
 * Draw the inclusive run `[from, to]` out of the channel at chain step `step`.
 *
 * The step is taken first and then scored at, the chain window is restarted, and
 * the marks the run carried are handed to the caller's report as pending grants
 * — a grant resolves in step 4 of the tick, after every advance and insertion.
 */
function extract(
  state: VoluteState,
  from: number,
  to: number,
  step: number,
  report: TickReport,
  grants: PendingGrant[],
): void {
  const taken: number[] = [];
  for (let i = from; i <= to; i += 1) taken.push(i);
  const count = taken.length;

  state.chainStep = Math.max(1, step);
  state.chainTimer = CHAIN_RESET;
  state.score += SCORE_PER_CORE * count * state.chainStep;
  report.cues.add(
    EXTRACT_CUES[clamp(state.chainStep, 1, EXTRACT_CUES.length) - 1],
  );

  removeCores(state, taken, report, grants);
}

/**
 * Take a set of cores off the channel at once, recoil what is left behind them,
 * and pay the pressure the removal drops.
 *
 * `grants` is where the marks the removal took are recorded, and passing `null`
 * is what says this removal grants nothing: an extraction is the only source of a
 * grant, so a bore's own removal hands its marks nowhere.
 */
export function removeCores(
  state: VoluteState,
  indices: readonly number[],
  report: TickReport,
  grants: PendingGrant[] | null,
): void {
  if (indices.length === 0) return;
  const sorted = [...new Set(indices)].sort((a, b) => a - b);
  const cores = state.cores;
  const frontmost = sorted[0];

  for (const index of sorted) {
    const core = cores[index];
    const point = pointAt(core.s);
    report.fx.push({
      kind: "extract",
      x: point.x,
      y: point.y,
      charge: core.charge,
    });
    if (grants !== null && core.mark !== null) {
      grants.push({ kind: core.mark, x: point.x, y: point.y });
      report.fx.push({ kind: "grant", x: point.x, y: point.y });
    }
  }

  const taken = new Set(sorted);
  const behind: Core[] = [];
  const kept: Core[] = [];
  for (let i = 0; i < cores.length; i += 1) {
    if (taken.has(i)) continue;
    kept.push(cores[i]);
    if (i > frontmost) behind.push(cores[i]);
  }
  state.cores = kept;

  state.pressure = clamp(
    state.pressure - PRESSURE_DROP_PER_CORE * sorted.length,
    PRESSURE_MIN,
    PRESSURE_MAX,
  );

  recoil(behind);
  resegment(state);
}

/** A machinery a removal's marked core granted, and where that core stood. */
export interface PendingGrant {
  readonly kind: MachineryKind;
  readonly x: number;
  readonly y: number;
}

/**
 * Drive the groups behind a removal back toward the inlet.
 *
 * Every group's move is computed against the positions held BEFORE any group
 * moved, so a group's room is the gap it actually had rather than one an earlier
 * group has already eaten into. Each group then holds for `RECOIL_HOLD`.
 */
function recoil(behind: readonly Core[]): void {
  if (behind.length === 0) return;

  const groups: Core[][] = [];
  for (let i = 0; i < behind.length; i += 1) {
    if (i > 0 && spaced(behind[i - 1], behind[i]))
      groups[groups.length - 1].push(behind[i]);
    else groups.push([behind[i]]);
  }

  const moves = groups.map((group, index) => {
    const tail = group[group.length - 1];
    const next = groups[index + 1];
    const room =
      next === undefined
        ? Math.min(tail.s, RECOIL)
        : Math.min(tail.s, tail.s - next[0].s - SPACING);
    return clamp(room, 0, RECOIL);
  });

  groups.forEach((group, index) => {
    const moved = moves[index];
    for (const core of group) {
      core.s -= moved;
      core.hold = RECOIL_HOLD;
    }
  });
}

// --- Insertion ----------------------------------------------------------------

/** Which core a projectile struck, and which side of it the projectile arrived on. */
export interface Strike {
  /** The struck core's index in the train. */
  readonly index: number;
  /** Whether the projectile arrived on the struck core's forward side. */
  readonly ahead: boolean;
}

/**
 * The core a projectile strikes, or `null` when nothing is within reach.
 *
 * The nearest center wins, and a tie is broken toward the core with the larger
 * arc position — which, in a head-first train, is the lower index.
 */
export function findStrike(
  cores: readonly Core[],
  projectile: Pick<Projectile, "x" | "y">,
): Strike | null {
  let best = -1;
  let bestDistance = Infinity;
  for (let i = 0; i < cores.length; i += 1) {
    const point = pointAt(cores[i].s);
    const distance = Math.hypot(projectile.x - point.x, projectile.y - point.y);
    if (distance > STRIKE_DISTANCE) continue;
    // Strictly less, so the first core met — the one with the larger arc
    // position, since the train descends — keeps a tie.
    if (distance < bestDistance) {
      bestDistance = distance;
      best = i;
    }
  }
  if (best < 0) return null;

  const core = cores[best];
  const point = pointAt(core.s);
  const forward = forwardAt(core.s);
  const dot =
    (projectile.x - point.x) * forward.x + (projectile.y - point.y) * forward.y;
  return { index: best, ahead: dot > 0 };
}

/**
 * Seat a core into the train at the strike, and extract the run it completes.
 *
 * The insertion position is the struck core's arc position when the core enters
 * ahead of it and one spacing less when it enters behind. Every core at or below
 * that position shifts back by one spacing, so the head never moves forward.
 */
export function insertCore(
  state: VoluteState,
  strike: Strike,
  charge: ChargeId,
  report: TickReport,
  grants: PendingGrant[],
): void {
  const struck = state.cores[strike.index];
  const at = strike.ahead ? struck.s : struck.s - SPACING;

  let placeAt = state.cores.length;
  for (let i = 0; i < state.cores.length; i += 1) {
    if (state.cores[i].s <= at + SPACING_EPSILON) {
      placeAt = i;
      break;
    }
  }
  for (let i = placeAt; i < state.cores.length; i += 1) {
    state.cores[i].s -= SPACING;
  }

  // The seated core always lands one spacing from the core it struck, so it joins
  // that core's segment — and a segment under a recoil hold keeps it. Inheriting
  // the struck core's hold is what makes that true when the seated core becomes
  // the segment's head, since `resegment` writes the head's hold over the rest.
  state.cores.splice(placeAt, 0, {
    charge,
    s: at,
    mark: null,
    hold: struck.hold,
  });
  resegment(state);
  extractAroundInsertion(state, placeAt, report, grants);
}
