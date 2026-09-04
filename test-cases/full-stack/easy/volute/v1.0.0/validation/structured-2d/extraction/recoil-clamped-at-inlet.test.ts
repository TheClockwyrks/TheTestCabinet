// extraction/recoil-clamped-at-inlet — a trailing group standing inside RECOIL
// of the inlet falls to arc position 0 and no further.
//
// THE RULE, FROM THE SPEC. specs/extraction.md — "Removals and recoil" — gives
// the distance a trailing group moves as
//
//     room  = min(t.s, b exists ? t.s - b.s - SPACING : RECOIL)
//     moved = clamp(room, 0, RECOIL)
//
// with `t` the group's last core. `extraction/recoil-distance` decides the
// `RECOIL` branch, where the group stands far enough out that the full 42 units
// are available. This point decides the OTHER branch of the same expression: the
// `min(t.s, ...)` term, which is what stops a recoil driving a core behind the
// inlet. It is a boundary the rule fixes on its own, so it is its own point: a
// build that recoils 42 correctly and drives a group past arc 0 fails here and
// passes there, and a failed grade names which of the two it missed.
//
// IT IS DRIVEN BY A MERGE rather than by a shot, because an insertion also shifts
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
//
// THE TOLERANCE is RECOIL_TOL, the +/- 0.2 the review item states for itself in
// place of the standing +/- 0.5 on an arc position. Every term is exact arithmetic
// on posed values over a tick order specs/channel.md fixes, so a conformant build
// lands on 0 to floating-point precision and the fifth of a unit is headroom.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThanOrEqual,
  assertLength,
  assertLessThan,
  assertNear,
} from "../assert";
import { MIN_RUN, RECOIL_TOL, RECOIL, SPACING } from "../constants";
import {
  captureReplay,
  coreCount,
  createHarness,
  poseHall,
  spacedRun,
  tail,
  type Harness,
} from "../harness";

/** The level the hall is opened on, whose feed speed the catch-up closes against. */
const LEVEL = 1;

/** The lead segment of the clamp scenario: a halide ahead of two cobalt. */
const LEAD = ["halide", "cobalt", "cobalt"] as const;

/** The trailing segment: a cobalt at the head, with the group to recoil behind it. */
const TRAIL = ["cobalt", "halide", "halide", "halide"] as const;

/**
 * The lead segment's head, chosen so the group left behind stands 23.2 units out
 * when the merge lands — well inside RECOIL, which is what the clamp needs, and
 * far enough out that every posed core sits at a non-negative arc position.
 */
const LEAD_HEAD_S = 189;

/**
 * How far behind the merge position the trailing segment starts.
 *
 * Six ticks of catch-up at the 158 units/s of closing `specs/channel.md` fixes,
 * so the merge is something the build's own advance reaches rather than something
 * the pose made. Any larger and the group would have to be posed behind the inlet
 * to still be inside RECOIL when it arrives.
 */
const GAP = 15;

/** The trailing segment's head: one spacing plus the gap behind the lead's tail. */
const TRAIL_HEAD_S = LEAD_HEAD_S - (LEAD.length - 1) * SPACING - SPACING - GAP;

/** How long the catch-up is swept for, against the six ticks the specs' rates give. */
const APPROACH_TICKS = 180;

/** Ticks of the aftermath kept in the replay, so the clip shows the group settled. */
const AFTERMATH_TICKS = 30; // 0.5 s

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("clamps the recoil at arc position 0 when the group stands against the inlet", async () => {
  await poseHall(h, {
    level: LEVEL,
    pressure: 0,
    cores: [...spacedRun(LEAD_HEAD_S, LEAD), ...spacedRun(TRAIL_HEAD_S, TRAIL)],
  });

  const posed = h.snapshot();
  assertEqual(coreCount(posed), LEAD.length + TRAIL.length, "the posed cores");
  // Two segments standing apart, so what follows is a merge and not a train that
  // was already joined (specs/channel.md — "The train").
  assertLength(posed.segments, 2, "segments the pose left standing apart");

  const history = await captureReplay(h, "clamped", async () => {
    const closing = await h.stepWatching(
      APPROACH_TICKS,
      (snapshot) => coreCount(snapshot) < LEAD.length + TRAIL.length,
    );
    await h.step(AFTERMATH_TICKS);
    return closing;
  });
  assertGreaterThanOrEqual(history.length, 2, "ticks of the catch-up");
  const before = history[history.length - 2];
  const after = history[history.length - 1];

  assertEqual(
    coreCount(after),
    LEAD.length + TRAIL.length - MIN_RUN,
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
