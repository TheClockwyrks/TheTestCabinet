// extraction/recoil-distance — the cores left behind an extraction fall back by
// RECOIL (42 units) of arc.
//
// THE RULE, FROM THE SPEC. specs/extraction.md — "Removals and recoil": "Every
// remaining core ahead of the frontmost core the removal took keeps its arc
// position. Behind that point, each maximal set of consecutive remaining cores
// whose arc positions differ by exactly the channel spacing is a trailing group,
// and every trailing group moves back as one, preserving the spacing within it",
// with
//
//     room  = min(t.s, b exists ? t.s - b.s - SPACING : RECOIL)
//     moved = clamp(room, 0, RECOIL)
//
// and `RECOIL` = 42 units in that file's Figures table. The pose leaves one
// trailing group with nothing behind it and its last core far above 42, so `room`
// is `RECOIL` and `moved` is the full 42.
//
// WHY THE READING IS 69.63 AND NOT 42. specs/channel.md — "The order of a tick" —
// resolves the tick as: timers, then "Every segment advances", then "Every
// projectile advances... A projectile that strikes a core seats it, and an
// insertion that completes a same-charge run extracts that run". So all three
// things land on ONE tick, and a tail read before and after that tick has moved by
// all of them:
//
//   + the lead segment's advance, "the level's feed speed x (1 + pressure / 100)"
//     (specs/channel.md), which at level 1's feed of 22 units/s and pressure 0 is
//     22 / 60 = 0.3667 units forward;
//   - the insertion's shift, "Every core whose arc position before the strike is
//     at most `p` shifts back by the channel spacing" (specs/injector.md), 28
//     units back;
//   - the recoil, 42 units back.
//
// so the tail falls by 28 + 42 - 0.3667 = 69.6333 units. The 42 is not separately
// readable, because nothing separates the two events onto different ticks. Every
// term is computed here from constants.ts rather than spelled as a number.
//
// THE POSE. specs/extraction.md's rule reads the same for any `n`, so the pose is
// the manifest's: one segment of three halide at the head and four cobalt behind
// them, on the straight top run, with the quota exhausted (specs/channel.md —
// "Emission") and pressure 0 so the feed term is the level's own figure. A halide
// released straight up the field seats among the head three and extracts four,
// leaving the four cobalt as the one trailing group. The verdict does not depend
// on which halide is struck or on which side the core seats: specs/injector.md's
// shift leaves the same four cobalt arc positions in every case.
//
// THE TOLERANCE is RECOIL_TOL, the +/- 0.2 the review item states for itself in
// place of the standing +/- 0.5 on an arc position. Every term above is exact
// arithmetic on posed values over a tick order specs/channel.md fixes, rather
// than an integration over many ticks, so a conformant build lands on 69.6333 to
// floating-point precision and the fifth of a unit is pure headroom. It is far
// tighter than any way of getting the rule wrong: no recoil at all misses by 42,
// a recoil of one spacing by 14, and the smallest deviation an ordering can
// produce — advancing after the insertion rather than before it — by 0.73.
//
// THE SECOND HALF OF THE ITEM: THE CLAMP. The item's description ends "clamped at
// no less than arc position 0", which is specs/extraction.md's `min(t.s, ...)`
// term. The drive above poses the train far enough out that `room` is always the
// full 42, so a second scenario poses it against the inlet instead: the same rule,
// the other branch of the same expression.
//
// It is driven by a MERGE rather than by a shot, because an insertion also shifts
// the whole train back by one spacing on the same tick (specs/injector.md) and
// that shift would decide as much of the reading as the clamp does.
// specs/extraction.md's "Extraction on a merge" moves nothing but the recoil. Two
// segments are posed on the straight top run — a lead of halide, cobalt, cobalt
// and a trailing one of cobalt, halide, halide, halide a gap behind it — so the
// trailing segment closes at the fixed catch-up rate, the run spanning the join is
// three cobalt, and what is left behind the removal is one trailing group of three
// halide with nothing behind it.
//
// WHERE THE GROUP IS PUT, AND WHY THE READING IS 0. The lead head stands at 189
// and the trailing segment 15 units short of the merge position, so its cores sit
// at 90, 62, 34 and 6 — all of them out on the channel, none posed behind the
// inlet. 15 units close at 180 - 22 = 158 units/s, which is six ticks, and the
// lead rides 22 x 6 / 60 = 2.2 of them, so the merge clamps the trailing head to
// 107.2 and the group's last core stands at `t.s` = 23.2. `room` is then
// `min(23.2, RECOIL)` = 23.2, `moved` is the same, and the tail lands on exactly
// 0 — 18.8 units inside the 42 that would otherwise apply, which is the margin
// that keeps this the clamped branch under any advance the specification's own
// tolerances allow. A build that skipped the `min` would drive the tail to -18.8,
// and a build that recoiled nothing would leave it at 23.2, so the reading tells
// the clamp apart from both. The tail is read off the snapshot rather than
// predicted, and the figure asserted is the one the rule makes exact: 0.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThanOrEqual,
  assertLength,
  assertLessThan,
  assertNear,
} from "../assert";
import {
  MIN_RUN,
  RECOIL_TOL,
  effectiveFeed,
  OPENING_AIM,
  RECOIL,
  SPACING,
  TICK_DT,
} from "../constants";
import {
  captureReplay,
  coreCount,
  createHarness,
  fireAt,
  poseHall,
  spacedRun,
  tail,
  type Harness,
} from "../harness";

/** The head of the posed segment, at `(420, 40)` on specs/channel.md's first leg. */
const HEAD_S = 380;

/** The level the hall is opened on, whose feed speed the advance term uses. */
const LEVEL = 1;

/** Three of one charge at the head, four of another behind them, in one segment. */
const POSED = [
  "halide",
  "halide",
  "halide",
  "cobalt",
  "cobalt",
  "cobalt",
  "cobalt",
] as const;

/** The four cores the insertion extracts: the posed three plus the seated one. */
const EXTRACTED = 4;

/** How far the shot's whole flight may run before the check calls it lost. */
const FLIGHT_TICKS = 120; // 2 s, against a flight of about 26 ticks

/** Ticks of the aftermath kept in the replay, so the clip shows the train settled. */
const AFTERMATH_TICKS = 30; // 0.5 s

/**
 * The tail's fall across the tick the extraction resolves on: one spacing of
 * insertion shift and one RECOIL back, less the one tick of feed the lead segment
 * took before the projectile moved.
 */
const EXPECTED_FALL = SPACING + RECOIL - effectiveFeed(LEVEL, 0) * TICK_DT;

/* -------------------------------------------------------------------------- */
/* The clamped branch of the same rule                                        */
/* -------------------------------------------------------------------------- */

/** The lead segment of the clamp scenario: a halide ahead of two cobalt. */
const CLAMP_LEAD = ["halide", "cobalt", "cobalt"] as const;

/** The trailing segment: a cobalt at the head, with the group to recoil behind it. */
const CLAMP_TRAIL = ["cobalt", "halide", "halide", "halide"] as const;

/**
 * The lead segment's head, chosen so the group left behind stands 23.2 units out
 * when the merge lands — well inside RECOIL, which is what the clamp needs, and
 * far enough out that every posed core sits at a non-negative arc position.
 */
const CLAMP_LEAD_HEAD_S = 189;

/**
 * How far behind the merge position the trailing segment starts.
 *
 * Six ticks of catch-up at the 158 units/s of closing `specs/channel.md` fixes,
 * so the merge is something the build's own advance reaches rather than something
 * the pose made. Any larger and the group would have to be posed behind the inlet
 * to still be inside RECOIL when it arrives.
 */
const CLAMP_GAP = 15;

/** The trailing segment's head: one spacing plus the gap behind the lead's tail. */
const CLAMP_TRAIL_HEAD_S =
  CLAMP_LEAD_HEAD_S - (CLAMP_LEAD.length - 1) * SPACING - SPACING - CLAMP_GAP;

/** How long the catch-up is swept for, against the six ticks the specs' rates give. */
const CLAMP_APPROACH_TICKS = 180;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("moves the trailing group back by RECOIL when the run ahead of it is drawn out", async () => {
  await poseHall(h, {
    level: LEVEL,
    pressure: 0,
    quotaRemaining: 0,
    cores: spacedRun(HEAD_S, POSED),
    loaded: "halide",
  });
  const posed = h.snapshot();
  assertEqual(coreCount(posed), POSED.length, "the posed segment");

  fireAt(h, OPENING_AIM);
  // Tick by tick, so the pair of snapshots the reading needs — the tick before the
  // extraction and the tick it resolves on — are both in hand. `driveShot` hands
  // back only the latter.
  const flight = await captureReplay(h, "recoil", async () => {
    const history = await h.stepWatching(
      FLIGHT_TICKS,
      (snapshot) => (snapshot.projectiles?.length ?? 0) === 0,
    );
    await h.step(AFTERMATH_TICKS);
    return history;
  });

  assertGreaterThanOrEqual(flight.length, 2, "ticks of the shot's flight");
  const before = flight[flight.length - 2];
  const after = flight[flight.length - 1];

  // The extraction happened on the tick being read: the seated core made eight on
  // the channel and the run of four went.
  assertEqual(coreCount(before), POSED.length, "cores on the tick before");
  assertEqual(
    coreCount(after),
    POSED.length + 1 - EXTRACTED,
    "cores left after the extraction",
  );

  assertNear(tail(before).s - tail(after).s, EXPECTED_FALL, RECOIL_TOL);
});

it("clamps the recoil at arc position 0 when the group stands against the inlet", async () => {
  await poseHall(h, {
    level: LEVEL,
    pressure: 0,
    quotaRemaining: 0,
    cores: [
      ...spacedRun(CLAMP_LEAD_HEAD_S, CLAMP_LEAD),
      ...spacedRun(CLAMP_TRAIL_HEAD_S, CLAMP_TRAIL),
    ],
  });

  const posed = h.snapshot();
  assertEqual(
    coreCount(posed),
    CLAMP_LEAD.length + CLAMP_TRAIL.length,
    "the posed cores",
  );
  // Two segments standing apart, so what follows is a merge and not a train that
  // was already joined (specs/channel.md — "The train").
  assertLength(posed.segments, 2, "segments the pose left standing apart");

  const history = await h.stepWatching(
    CLAMP_APPROACH_TICKS,
    (snapshot) => coreCount(snapshot) < CLAMP_LEAD.length + CLAMP_TRAIL.length,
  );
  assertGreaterThanOrEqual(history.length, 2, "ticks of the catch-up");
  const before = history[history.length - 2];
  const after = history[history.length - 1];

  assertEqual(
    coreCount(after),
    CLAMP_LEAD.length + CLAMP_TRAIL.length - MIN_RUN,
    "cores left once the run spanning the join was drawn out",
  );
  // The scenario really is the clamped branch: the group's last core stood
  // inside RECOIL of the inlet on the tick before the removal, so `room` is
  // `t.s` and not `RECOIL`.
  assertLessThan(
    tail(before).s,
    RECOIL,
    "the trailing group's last core stands inside RECOIL of the inlet",
  );
  assertGreaterThanOrEqual(
    tail(after).s,
    -RECOIL_TOL,
    "the trailing group's last core after a recoil clamped at arc position 0",
  );
  assertNear(
    tail(after).s,
    0,
    RECOIL_TOL,
    "the trailing group's last core, moved by all of `t.s` and no more",
  );
});
