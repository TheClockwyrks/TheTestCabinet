// Volute — the working copy a frame builds the next state in.
//
// The engine holds the state BY VALUE and replaces it with whatever `update`
// returns, and every reader — `update`, `render`, each diagnostic source, and
// each operation of the debug surface — is handed it as `DeepReadonly<VoluteState>`
// (specs/state.md). So nothing in this build ever writes into the state it was
// given: a frame {@link thaw}s the state it received into a DRAFT, runs the
// simulation over the draft, and {@link freeze}s the draft into the new value it
// returns. The type is what guarantees the original was left as it was, and the
// draft is what lets the rules below read like the rules they are rather than
// like a chain of spreads.
//
// The draft differs from `VoluteState` in exactly one way, and it is a
// representation rather than a rule. `VoluteState` carries the recoil hold on the
// SEGMENT, which is where specs/state.md puts it; a segment's boundaries, though,
// follow from the spacing and so change under every insertion, extraction and
// merge. The draft therefore carries the hold PER CORE and re-derives the
// segments from the spacing whenever the train moves. The two are the same fact:
// {@link thaw} spreads each segment's hold across its cores and {@link freeze}
// reads each segment's hold back off its head core, and {@link resegment} is what
// keeps a segment's cores agreeing about it in between.

import { SPACING } from "./constants";
import type { ChargeId, MachineryKind, ScreenName } from "./constants";
import type { DeepReadonly } from "ts-essentials";
import type { SegmentState, VoluteState } from "./game";

/**
 * The slack allowed when two arc positions are asked to differ by exactly one
 * spacing.
 *
 * Segment members are moved by adding the SAME delta to each, so their
 * differences survive to the last few bits; this is wide enough to absorb that
 * and far narrower than any distance the game can otherwise produce.
 */
export const SPACING_EPSILON = 1e-6;

/** One core on the channel, as a frame works on it. */
export interface DraftCore {
  charge: ChargeId;
  s: number;
  mark: MachineryKind | null;
  /** The seconds of recoil hold the core's segment stands under. */
  hold: number;
}

/** One projectile, as a frame works on it. */
export interface DraftProjectile {
  charge: ChargeId;
  x: number;
  y: number;
  angle: number;
}

/** The timed machinery, as a frame works on it. */
export interface DraftMachinery {
  kind: MachineryKind;
  remaining: number;
}

/** The whole of the game, as a frame works on it. */
export interface Draft {
  screen: ScreenName;
  score: number;
  level: number;
  cells: number;
  quotaRemaining: number;
  pressure: number;
  chainStep: number;
  chainTimer: number;
  machinery: DraftMachinery | null;
  cores: DraftCore[];
  projectiles: DraftProjectile[];
  loaded: ChargeId | null;
  queued: ChargeId | null;
  aim: number;
  fireCooldown: number;
  interlude: number;
  simTime: number;
  accumulator: number;
  muted: boolean;
  rngState: number;
}

/** Clamp a value into a closed range. */
export function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}

/** Whether two consecutive cores stand one spacing apart, and so ride as one. */
export function spaced(
  ahead: { readonly s: number },
  behind: { readonly s: number },
): boolean {
  return Math.abs(ahead.s - behind.s - SPACING) <= SPACING_EPSILON;
}

/**
 * The segments a train's arc positions imply, the lead segment first.
 *
 * A segment is a maximal run of consecutive cores exactly one spacing apart, so
 * the boundaries are read off the positions rather than stored, and its hold is
 * its head core's. The counts partition the train in order.
 */
export function segmentsOf(cores: readonly DraftCore[]): SegmentState[] {
  const segments: SegmentState[] = [];
  let start = 0;
  for (let i = 1; i <= cores.length; i += 1) {
    if (i === cores.length || !spaced(cores[i - 1], cores[i])) {
      segments.push({ count: i - start, hold: cores[start].hold });
      start = i;
    }
  }
  return segments;
}

/**
 * Write each segment's head hold over the rest of that segment.
 *
 * Called after every mutation of the train. It is how "the merged segment carries
 * the recoil hold of the segment ahead" and "two groups a recoil leaves exactly
 * the channel spacing apart are one segment, carrying the hold of the group
 * ahead" both fall out of one rule, and it is what stops a stale hold resurfacing
 * when a segment is later split by an insertion or an extraction.
 */
export function resegment(draft: Draft): void {
  const cores = draft.cores;
  let start = 0;
  for (let i = 1; i <= cores.length; i += 1) {
    if (i === cores.length || !spaced(cores[i - 1], cores[i])) {
      const hold = cores[start].hold;
      for (let j = start; j < i; j += 1) cores[j].hold = hold;
      start = i;
    }
  }
}

/** The working copy of a state, with the segments' holds spread over the cores. */
export function thaw(state: DeepReadonly<VoluteState>): Draft {
  const cores: DraftCore[] = state.cores.map((core) => ({
    charge: core.charge,
    s: core.s,
    mark: core.mark,
    hold: 0,
  }));

  let index = 0;
  for (const segment of state.segments) {
    const end = Math.min(cores.length, index + Math.max(0, segment.count));
    for (; index < end; index += 1) cores[index].hold = segment.hold;
  }

  const draft: Draft = {
    screen: state.screen,
    score: state.score,
    level: state.level,
    cells: state.cells,
    quotaRemaining: state.quotaRemaining,
    pressure: state.pressure,
    chainStep: state.chainStep,
    chainTimer: state.chainTimer,
    machinery:
      state.machinery === null
        ? null
        : { kind: state.machinery.kind, remaining: state.machinery.remaining },
    cores,
    projectiles: state.projectiles.map((projectile) => ({
      charge: projectile.charge,
      x: projectile.x,
      y: projectile.y,
      angle: projectile.angle,
    })),
    loaded: state.loaded,
    queued: state.queued,
    aim: state.aim,
    fireCooldown: state.fireCooldown,
    interlude: state.interlude,
    simTime: state.simTime,
    accumulator: state.accumulator,
    muted: state.muted,
    rngState: state.rngState,
  };

  // A state posed with segments that disagree with the spacing is normalized
  // here, so what the rules below read is always the train the arc positions
  // describe.
  resegment(draft);
  return draft;
}

/** The next state, built from a finished draft. */
export function freeze(draft: Draft): VoluteState {
  return {
    screen: draft.screen,
    score: draft.score,
    level: draft.level,
    cells: draft.cells,
    quotaRemaining: draft.quotaRemaining,
    pressure: draft.pressure,
    chainStep: draft.chainStep,
    chainTimer: draft.chainTimer,
    machinery:
      draft.machinery === null
        ? null
        : { kind: draft.machinery.kind, remaining: draft.machinery.remaining },
    cores: draft.cores.map((core) => ({
      charge: core.charge,
      s: core.s,
      mark: core.mark,
    })),
    segments: segmentsOf(draft.cores),
    projectiles: draft.projectiles.map((projectile) => ({
      charge: projectile.charge,
      x: projectile.x,
      y: projectile.y,
      angle: projectile.angle,
    })),
    loaded: draft.loaded,
    queued: draft.queued,
    aim: draft.aim,
    fireCooldown: draft.fireCooldown,
    interlude: draft.interlude,
    simTime: draft.simTime,
    accumulator: draft.accumulator,
    muted: draft.muted,
    rngState: draft.rngState >>> 0,
  };
}
