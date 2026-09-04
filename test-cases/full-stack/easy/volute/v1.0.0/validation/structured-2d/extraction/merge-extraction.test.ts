// extraction/merge-extraction — a segment catching the one ahead of it extracts
// the same-charge run that spans the join.
//
// THE RULE, FROM THE SPEC. specs/extraction.md — "Extraction on a merge": "When a
// segment merges with the segment ahead of it, and the merging segment's head core
// and the segment ahead's tail core carry the same charge, take the maximal
// same-charge run spanning that join within the merged segment. That run is
// extracted on the tick the merge occurs when it holds at least 3 cores. The
// extraction removes every core of the run at once".
//
// WHAT CLOSES THE GAP. specs/channel.md — "Advance": the lead segment rides at the
// effective feed speed (level 1's 22 units/s at pressure 0) and "Every other
// segment" at "180 units/s", the fixed catch-up rate. specs/channel.md —
// "Merging": "A segment merges with the segment ahead of it when its head reaches
// the arc position `SPACING` behind that segment's tail." So the trailing segment
// closes on its own and the check only has to wait.
//
// THE POSE. A lead segment of halide, cobalt, cobalt on the straight top run, and
// a detached segment of cobalt, halide behind it, its head one further gap back
// from where the merge would trip. The quota is exhausted (specs/channel.md —
// "Emission") so the inlet puts nothing into the gap, and no shot is fired, so the
// only thing that can extract here is the merge.
//
// WHY THE RUN IS EXACTLY THREE. The lead segment carries two cobalt at its tail and
// a halide ahead of them; the trailing segment carries one cobalt at its head and a
// halide behind it. So the maximal same-charge run spanning the join is three
// cobalt with a halide stopping it at each end — the threshold specs/extraction.md
// sets, met exactly rather than exceeded.
//
// NO TOLERANCE IS NEEDED. The verdict is which charges are left on the channel;
// nothing here is measured against a figure. How long the catch-up takes is
// channel's advance point, so this check waits a bound rather than asserting one.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertLength,
  assertTrue,
} from "../assert";
import { MIN_RUN, SPACING } from "../constants";
import {
  captureReplay,
  coreCount,
  charges,
  createHarness,
  poseHall,
  spacedRun,
  type Harness,
} from "../harness";

/** The lead segment's head, at `(540, 40)` on specs/channel.md's first leg. */
const LEAD_HEAD_S = 500;

/** A halide ahead of the two cobalt, so the run stops there. */
const LEAD = ["halide", "cobalt", "cobalt"] as const;

/** A cobalt at the head, with a halide behind it, so the run stops there too. */
const TRAIL = ["cobalt", "halide"] as const;

/**
 * How far behind the merge position the trailing segment starts.
 *
 * Room for the catch-up to be the thing that closes it: at 180 - 22 = 158 units/s
 * of closing, 60 units is about 23 ticks of real approach rather than a merge the
 * pose all but made itself.
 */
const GAP = 60;

/** The trailing segment's head: one spacing plus the gap behind the lead's tail. */
const TRAIL_HEAD_S = LEAD_HEAD_S - (LEAD.length - 1) * SPACING - SPACING - GAP;

/** How long the check waits for the catch-up, against about 23 ticks of it. */
const APPROACH_TICKS = 180; // 3 s

/** Ticks of the aftermath kept in the replay, so the clip shows the hall after. */
const AFTERMATH_TICKS = 30; // 0.5 s

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("extracts the three-core run spanning a join when a segment catches up", async () => {
  await poseHall(h, {
    cores: [...spacedRun(LEAD_HEAD_S, LEAD), ...spacedRun(TRAIL_HEAD_S, TRAIL)],
  });

  const posed = h.snapshot();
  assertEqual(coreCount(posed), LEAD.length + TRAIL.length, "the posed cores");
  // The two really are detached, so what follows is a merge rather than a train
  // that was already joined: "A **segment** is a maximal run of consecutive cores
  // in the train whose arc positions differ by exactly `SPACING`".
  assertLength(posed.segments, 2, "segments the pose left standing apart");

  const merge = await captureReplay(h, "merge-extract", async () => {
    const closed = await h.stepUntil(
      (snapshot) => coreCount(snapshot) <= LEAD.length + TRAIL.length - MIN_RUN,
      { maxTicks: APPROACH_TICKS, poll: 1 },
    );
    await h.step(AFTERMATH_TICKS);
    return closed;
  });

  assertTrue(merge.hit, "the run spanning the join to be extracted");
  // Three cobalt went and the two halide that bounded the run stayed.
  assertDeepEqual(charges(merge.snapshot), ["halide", "halide"]);
});
