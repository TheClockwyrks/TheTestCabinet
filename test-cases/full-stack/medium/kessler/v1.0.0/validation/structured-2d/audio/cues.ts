// audio/cues — the drive-and-listen shape every audio cue suite shares.
// CASE-PROVIDED.
//
// A cue can only be tied to its event if the drive demonstrably reached the
// event, so each suite poses a strict crossing a fixed number of ticks out,
// listens across the quiet approach and the event tick, and confirms off the
// snapshot that the event resolved exactly where the pose put it. What is
// shared here is that shape and the two polar readings the confirmations
// need; every figure a suite asserts lives in the suite itself, traced to
// the spec sentence its opening comment quotes.

import { STAGE_CX, STAGE_CY } from "../constants";
import type { Harness, TimedCue } from "../harness";
import type { KesslerSnapshot } from "../surface";

/** One posed drive up to and through a single event tick. */
export interface CueDrive {
  /** The snapshot after the lead ticks: the last quiet one before the event. */
  before: KesslerSnapshot;
  /** The snapshot after the event tick. */
  after: KesslerSnapshot;
  /** The cues that had sounded by the end of the lead ticks. */
  quiet: TimedCue[];
  /** The cues that had sounded by the end of the event tick. */
  played: TimedCue[];
}

/**
 * Drive a posed scene through its one event: `leadTicks` ticks of quiet
 * approach, the event tick itself, then `trailTicks` of aftermath for the
 * recording. The cue slices are copies taken at the two boundaries, so a
 * suite reads exactly what sounded before the event against what had sounded
 * by the end of its tick.
 */
export async function driveToEvent(
  h: Harness,
  cues: readonly TimedCue[],
  leadTicks: number,
  trailTicks: number,
): Promise<CueDrive> {
  const before = await h.tick(leadTicks);
  const quiet = [...cues];
  const after = await h.tick(1);
  const played = [...cues];
  await h.tick(trailTicks);
  return { before, after, quiet, played };
}

/** A body's center radius from the stage center. */
export function radiusOf(body: { x: number; y: number }): number {
  return Math.hypot(body.x - STAGE_CX, body.y - STAGE_CY);
}

/**
 * The radial velocity component at the body's own center, outward positive —
 * the `v . n` every crossing rule in specs/field.md gates on.
 */
export function radialVelocity(body: {
  x: number;
  y: number;
  vx: number;
  vy: number;
}): number {
  const dx = body.x - STAGE_CX;
  const dy = body.y - STAGE_CY;
  const r = Math.hypot(dx, dy);
  return (body.vx * dx + body.vy * dy) / r;
}
