// extraction/recoil-join-stays — a run of three that a RECOIL brings together is
// left on the channel.
//
// THE RULE, FROM THE SPEC. specs/extraction.md — "Runs": "A maximal run of at
// least 3 cores is extracted by the two events below, and a run that reaches 3
// cores by any other means stays on the channel." A recoil is one of those other
// means, and specs/extraction.md — "Removals and recoil" — says so in the same
// breath as it makes the join: "Two groups a recoil leaves exactly the channel
// spacing apart are one segment, carrying the hold of the group ahead." One
// segment, and nothing about an extraction. specs/channel.md — "The order of a
// tick" — names an extraction exactly twice, at steps 2 and 3 ("A merge that
// completes a same-charge run extracts that run", "an insertion that completes a
// same-charge run extracts that run"), and a recoil is neither: it is what a
// removal leaves behind, inside the step that removal resolved on.
//
// WHY THIS IS ITS OWN POINT. instrumentation/pose-decides-nothing grades a run
// that was never assembled by the game at all — three cores posed side by side
// and left to ride. This one grades a run the game's own rules push together, on
// the tick a removal resolves, inside the very machinery that DOES extract. A
// build can leave a posed run alone and still sweep the train after every
// removal, and only this scenario tells the two apart.
//
// WHEN A RECOIL CAN JOIN TWO GROUPS AT ALL, which is what fixes the pose.
// specs/extraction.md's recoil moves each trailing group by
//
//     room  = min(t.s, b exists ? t.s - b.s - SPACING : RECOIL)
//     moved = clamp(room, 0, RECOIL)
//
// read "at the arc positions they held before any group moved". Two groups end
// exactly one spacing apart when the group ahead falls by all of `t.s - b.s -
// SPACING` while the group behind falls by nothing, and the group behind falls by
// nothing only when `min(t.s, RECOIL)` is not positive — that is, when its own
// last core stands at or behind the inlet. So the join is the case of a train that
// has backed up as far as arc position 0, which is exactly the hall this poses.
//
// THE POSE. Three segments on the straight top run, quota exhausted
// (specs/channel.md — "Emission"), pressure 0:
//
//   * a LEAD of halide, sulfur, sulfur, head at 239;
//   * a CHASER of sulfur, cobalt, cobalt, MERGE_GAP (15 units) short of the merge
//     position, which closes at the 180 - 22 = 158 units/s specs/channel.md's two
//     rates leave and merges on the sixth tick. The join is sulfur on sulfur, so
//     the maximal run spanning it is three and specs/extraction.md's "Extraction
//     on a merge" draws it out, leaving the two cobalt as the trailing group;
//   * a PACK of cobalt, halide, halide, halide, JOIN_GAP (48 units) behind the
//     chaser's tail and reaching back past the inlet to arc position -48.
//     specs/injector.md — "Insertion" — states the same thing from its own side:
//     an arc position below 0 "is kept as it stands, and the core holding it is
//     drawn at the inlet", so a train standing behind the inlet is a hall the
//     specification provides for.
//
// WHY THE TICK THE MERGE FALLS ON DOES NOT DECIDE ANYTHING. Both trailing
// segments ride at the same fixed 180 units/s catch-up (specs/channel.md —
// "Advance"), so the 48 units between them is 48 units on every tick of the
// approach, and on the merge tick itself it opens by only the clamped step the
// merge allowed the chaser — under one tick's catch-up, so under 3 units. The
// reading therefore rests on an inequality rather than an arithmetic coincidence:
// the gap is somewhere between SPACING and SPACING + RECOIL whenever the merge
// lands, which is all `room` needs. On the reference it is 50.2, so the chaser's
// remnant has 50.2 - 28 = 22.2 units of room, well inside RECOIL, and falls all of
// it; the pack, whose last core stands at -33 by then, has `min(-33, RECOIL)` of
// room and falls nowhere. The two land exactly one spacing apart, become one
// segment, and the cobalt run across the join is three.
//
// WHAT IS ASSERTED, AND IN WHICH ORDER. First that the scenario really is the one
// described — the three cobalt stood in two different segments on the tick before
// the removal and in ONE segment on the tick after it, one spacing apart. Then the
// verdict: a second of ticks later, all three are still on the channel and the
// score has not moved since the removal paid for the sulfur.
//
// THE TOLERANCE on the spacing across the join is the standing ARC_TOL of half a
// unit. The rule makes the gap exactly SPACING by construction — `moved` IS the
// excess over the spacing — so half a unit is pure headroom.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThanOrEqual,
  assertLength,
  assertLessThanOrEqual,
  assertNear,
  assertNotEqual,
} from "../assert";
import { ARC_TOL, MIN_RUN, SPACING } from "../constants";
import {
  captureReplay,
  coreCount,
  createHarness,
  poseHall,
  spacedRun,
  type Harness,
  type TrainCore,
  type VoluteSnapshot,
} from "../harness";

/** The lead segment: the run the merge extracts is completed onto its tail. */
const LEAD = ["halide", "sulfur", "sulfur"] as const;

/** The lead's head, on specs/channel.md's first leg and clear of the intake. */
const LEAD_HEAD_S = 239;

/** The chaser: a sulfur head that completes the run, and the pair left behind. */
const CHASER = ["sulfur", "cobalt", "cobalt"] as const;

/**
 * How far short of the merge position the chaser opens.
 *
 * 15 units close at the 158 units/s specs/channel.md's catch-up and level 1 feed
 * leave between them, so the merge is something the build's own advance reaches
 * on its sixth tick rather than something the pose made.
 */
const MERGE_GAP = 15;

/** The chaser's head: one spacing plus the gap behind the lead's tail. */
const CHASER_HEAD_S =
  LEAD_HEAD_S - (LEAD.length - 1) * SPACING - SPACING - MERGE_GAP;

/** The pack: a cobalt head for the run to close onto, and the tail that pins it. */
const PACK = ["cobalt", "halide", "halide", "halide"] as const;

/**
 * The gap the chaser's remnant falls through, measured from its tail to the
 * pack's head.
 *
 * Inside `SPACING + RECOIL` (70) so the recoil closes all of it, and clear of
 * `SPACING` (28) so the two really are two segments until it does.
 */
const JOIN_GAP = 48;

/** The pack's head, `JOIN_GAP` behind the chaser's tail. */
const PACK_HEAD_S = CHASER_HEAD_S - (CHASER.length - 1) * SPACING - JOIN_GAP;

/** Every core the hall opens with. */
const POSED_CORES = LEAD.length + CHASER.length + PACK.length;

/** How long the catch-up is swept for, against the six ticks the specs' rates give. */
const APPROACH_TICKS = 180;

/** Ticks the joined run is watched for after the removal: 1 s. */
const AFTERMATH_TICKS = 60;

/** The cores carrying `cobalt`, head first. */
function cobalt(snapshot: VoluteSnapshot): TrainCore[] {
  return (snapshot.train ?? []).filter((core) => core.charge === "cobalt");
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves a run of three that a recoil brought together on the channel", async () => {
  await poseHall(h, {
    cores: [
      ...spacedRun(LEAD_HEAD_S, LEAD),
      ...spacedRun(CHASER_HEAD_S, CHASER),
      ...spacedRun(PACK_HEAD_S, PACK),
    ],
  });

  const posed = await h.snapshot();
  assertEqual(coreCount(posed), POSED_CORES, "the posed cores");
  assertLength(posed.segments, 3, "segments the pose left standing apart");

  const drive = await captureReplay(h, "join", async () => {
    const history = await h.stepWatching(
      APPROACH_TICKS,
      (snapshot) => coreCount(snapshot) < POSED_CORES,
    );
    const settled = await h.step(AFTERMATH_TICKS);
    return { history, settled };
  });

  assertGreaterThanOrEqual(drive.history.length, 2, "ticks of the catch-up");
  const before = drive.history[drive.history.length - 2];
  const joined = drive.history[drive.history.length - 1];

  // The merge extraction happened, and took the three sulfur and nothing else.
  assertEqual(
    coreCount(joined),
    POSED_CORES - MIN_RUN,
    "cores left once the run spanning the merge was drawn out",
  );

  // The scenario is the one the header describes. On the tick before the removal
  // the three cobalt stood in two different segments, so the run did not exist
  // yet; on the tick after it they stand in one, one spacing apart.
  const split = cobalt(before);
  assertLength(split, MIN_RUN, "cobalt cores before the removal");
  assertNotEqual(
    split[MIN_RUN - 1].segment,
    split[0].segment,
    "the pack's cobalt standing in a different segment from the chaser's pair",
  );

  const run = cobalt(joined);
  assertLength(run, MIN_RUN, "cobalt cores after the removal");
  for (let i = 1; i < run.length; i += 1) {
    assertEqual(
      run[i].segment,
      run[0].segment,
      "the cobalt run standing in one segment after the recoil joined the groups",
    );
    assertNear(
      run[i - 1].s - run[i].s,
      SPACING,
      ARC_TOL,
      "the spacing across the join the recoil made",
    );
  }
  // The pack really was pinned against the inlet, which is what let the join
  // happen at all: its last core stood at or behind arc position 0.
  const pinned = (before.train ?? [])[coreCount(before) - 1];
  assertLessThanOrEqual(
    pinned.s,
    0,
    "the pack's last core standing at or behind the inlet, with no recoil room",
  );

  // THE VERDICT. A second later the run of three is still riding, and nothing has
  // scored since the merge paid for the sulfur.
  assertEqual(
    coreCount(drive.settled),
    POSED_CORES - MIN_RUN,
    "cores left a second after the recoil joined them",
  );
  assertLength(
    cobalt(drive.settled),
    MIN_RUN,
    "the joined cobalt run, still riding",
  );
  assertEqual(drive.settled.score, joined.score);
});
