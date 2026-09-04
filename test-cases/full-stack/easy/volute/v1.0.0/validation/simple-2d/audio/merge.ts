// audio/merge — the merge extraction the three chain-step cue points share.
// CASE-PROVIDED.
//
// No review item names this file. It is a compound sequence of the surface's
// atomic operations, which the authoring guide has live beside the checks
// rather than inside any one of them.
//
// WHY A MERGE AND NOT AN INSERTION. Each of the three points reads WHICH
// extraction cue sounded, so the tick has to carry that cue and no other of
// the five. `specs/ui.md` binds `seat` to "A projectile is inserted into the
// train", and an insertion that completes a run resolves the seat and the
// extraction on the same tick — which is fine for a point that reads `seat` or
// `machinery`, and noise for one that reads the extraction's own step.
// `specs/extraction.md`'s merge extraction resolves on a tick with no
// projectile in the hall at all: no `seat`, no `fire`, no `denied`, no `swap`;
// the posed cores carry no mark, so no `machinery`; two cores are left
// standing behind, so no `level-clear`; and the train stands far short of the
// intake, so no `intake` and no `cell-lost`.
//
// HOW THE RUN IS DRAWN OUT. Two segments are placed on the straight top run: a
// lead segment of halide, cobalt, cobalt, and a detached segment of cobalt,
// halide one further gap behind it. `specs/channel.md` ("Advance") rides the
// lead segment at the effective feed speed and "Every other segment" at the
// fixed 180 units/s, so the trailing segment closes on its own, merges, and
// the maximal same-charge run spanning the join is three cobalt with a halide
// stopping it at each end. The inlet is held, so nothing joins the gap, and
// the quota is left where it stands, so no clear can follow.
//
// THE STEP THE EXTRACTION SCORES AT IS POSED. `specs/instrumentation.md`'s
// `setChainStep` "sets the chain step an extraction scores at to `k` ... and
// restarts the window that returns the step to `1`", whose 2.0 s is 120 ticks
// against the two dozen the catch-up takes — so the posed step is the step the
// merge resolves at. What RAISES a chain is `extraction/chain-increment`'s
// requirement, and a point about a cue must not also turn on it.

import { assertLength } from "../assert";
import { MIN_RUN, SPACING } from "../constants";
import {
  coreCount,
  poseHall,
  spacedRun,
  type Harness,
  type UntilResult,
} from "../harness";

/** The lead segment's head, at `(540, 40)` on specs/channel.md's first leg. */
const LEAD_HEAD_S = 500;

/** A halide ahead of two cobalt, so the run spanning the join stops there. */
const LEAD = ["halide", "cobalt", "cobalt"] as const;

/** A cobalt at the head with a halide behind it, so the run stops there too. */
const TRAIL = ["cobalt", "halide"] as const;

/** How far behind the merge position the trailing segment starts. */
const GAP = 60;

/** The trailing segment's head: one spacing plus the gap behind the lead's tail. */
const TRAIL_HEAD_S = LEAD_HEAD_S - (LEAD.length - 1) * SPACING - SPACING - GAP;

/** How long the catch-up is swept for, against about 23 ticks of it. */
const APPROACH_TICKS = 180;

/** The cores left standing once the run spanning the join is drawn out. */
export const CORES_AFTER = LEAD.length + TRAIL.length - MIN_RUN;

/** Pose two detached segments that will merge into a run of three, at step `k`. */
export async function poseMerge(h: Harness, chainStep: number): Promise<void> {
  await poseHall(h, {
    chainStep,
    cores: [...spacedRun(LEAD_HEAD_S, LEAD), ...spacedRun(TRAIL_HEAD_S, TRAIL)],
  });
  const posed = await h.snapshot();
  // The two really are detached, so what follows is a merge rather than a train
  // that was already joined: "A segment is a maximal run of consecutive cores in
  // the train whose arc positions differ by exactly `SPACING`".
  assertLength(posed.segments, 2, "segments the pose left standing apart");
}

/** Step until the run spanning the join is drawn out. */
export function driveMerge(h: Harness): Promise<UntilResult> {
  return h.stepUntil((snapshot) => coreCount(snapshot) <= CORES_AFTER, {
    maxTicks: APPROACH_TICKS,
    poll: 1,
  });
}
