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
// them, on the straight top run, with the inlet held (specs/instrumentation.md —
// `setEmission`) and pressure 0 so the feed term is the level's own figure. A halide
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
// THE CLAMPED BRANCH of the same expression — the `min(t.s, ...)` term, which
// stops a recoil driving a group behind the inlet — is a boundary of its own and
// is decided by `extraction/recoil-clamped-at-inlet`.
//
import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThanOrEqual, assertNear } from "../assert";
import {
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
