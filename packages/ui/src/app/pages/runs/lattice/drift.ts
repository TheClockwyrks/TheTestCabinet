// The playback-drift gate: does the factory being drawn agree with the one the run
// was graded on?
//
// A performance run records, per scored scenario, the checksum its engine produced
// at every graded tick. Browser playback re-steps that same module, so at any graded
// tick inside the played window the frame the module emits must carry the checksum
// the run recorded. When it does not, the module on screen is not the one the grade
// describes — it was swapped, or its playback path and its scored path do not
// compute the same world — and the viewer is being shown a factory no verdict covers.
// This is the analogue of Foray's replay-drift gate.
//
// ## What this can and cannot prove
//
// It compares the checksums the two paths REPORT. It does not re-derive a checksum
// from the entities drawn beside it: that would put the simulation's rules in the
// renderer, which the player deliberately does not hold — every position it draws
// comes from the engine. That bar belongs to the host, which at grading time
// re-serializes each returned snapshot to canonical bytes and rejects a checksum
// that does not match its own state (`lattice-host`'s `score_against`). Those two
// together are what make a matching checksum here mean "the same factory": the host
// ties a run's recorded checksum to real state, and this ties the frames on screen to
// that recorded checksum.
//
// It can only check ticks that fall inside the played window, which is why the
// scenario generator schedules graded snapshots inside it (`PLAYBACK_WINDOW_TICKS`).
// A scenario whose graded ticks all sat past the window — as every scored Lattice
// scenario once did — leaves this gate nothing to compare and every drawn frame
// unverified.

import type { PerformanceSnapshotCheck } from "@clockwyrks/run-record";
import type { Snapshot } from "./renderer";

/** A frame that disagreed with the run's record at a graded tick. */
export interface Drift {
  /** The graded tick the two disagree at. */
  tick: number;
  /** The checksum this playback's frame carries. */
  played: string;
  /** The checksum the graded run recorded at that tick. */
  recorded: string;
}

/**
 * The first graded tick in `frames` whose checksum is not the one `graded`
 * recorded, or `null` when every graded tick present agrees (including when none is
 * present, or when there is no record to check against — the case's Reference tab
 * plays the authoritative engine against no run at all).
 *
 * Frames arrive in batches as the engine streams them, so this is called per batch
 * and looks only at the frames it is handed; the caller reports the first drift and
 * stops asking.
 */
export function firstDrift(
  graded: readonly PerformanceSnapshotCheck[] | undefined,
  frames: readonly Snapshot[],
): Drift | null {
  if (!graded || graded.length === 0) return null;
  const recorded = new Map(graded.map((s) => [s.tick, s.checksum]));
  for (const frame of frames) {
    const want = recorded.get(frame.tick);
    if (want !== undefined && want !== frame.checksum) {
      return { tick: frame.tick, played: frame.checksum, recorded: want };
    }
  }
  return null;
}
