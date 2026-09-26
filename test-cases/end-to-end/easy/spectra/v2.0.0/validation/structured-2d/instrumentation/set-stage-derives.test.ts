// instrumentation/set-stage-derives — `setStage(n)` moves the stage's five derived
// figures and touches nothing on the field.
//
// specs/instrumentation.md states both halves in one place: "`setStage` spawns
// nothing and clears nothing. The stage's four derived figures,
// `droneSpeedScale`, `bulletSpeedScale`, `diveGapScale`, and `fluxHold`, and
// `isChallenge` all follow it, since each is derived from the stage." The formulas
// are specs/stages.md's, and the snapshot shape adds that the four "are derived at
// the call from `stage`… by the formulas in specs/stages.md".
//
// BOTH HALVES MATTER TO THE REST OF THIS SUITE. Every check that runs at a stage
// other than the first poses it with this operation and then reads a scaled
// figure, so a build whose `setStage` left the scales behind would fail the
// scaling points under headings about the scales; and a build whose `setStage`
// rebuilt the wave would sweep away the field the check had just posed, and fail
// under a heading about whatever it had posed there.
//
// THE STAGE POSED IS `9`, and every part of that is deliberate. It is far enough
// along that all four formulas are off their stage-1 values and none of them has
// reached its cap or its floor — `droneSpeedScale` is `1.48` against a ceiling of
// `1.50`, `bulletSpeedScale` `1.32` against `1.40`, `diveGapScale` `0.60` against
// a floor of `0.55`, `fluxHold` `1.20` s against `1.00` — so a build that clamps
// too early and one that does not scale at all read as different numbers. The four
// are four DIFFERENT numbers at that stage, so a build that wired one formula into
// another field is caught too. And `9` is a multiple of `CHALLENGE_EVERY` (`3`),
// so `isChallenge` turns over as well, having been false at the stage the field
// was posed at.
//
// THE FIELD IS THE CROWDED ONE (`./crowded-field.ts`): drones standing, bullets of
// both kinds in flight, and a drone-burst playing, all read entry by entry before
// and after. Every drone on it is a Shard, which is what makes the roster
// comparison a clean reading: a Flux's `shimmer` is derived from its band clock
// against `fluxHold(stage)` (specs/drones.md), so a Flux's own entry would
// legitimately change with the stage and this point would be reading that instead.
//
// NOTHING RUNS BETWEEN THE POSE AND THE READING. Under this engine a pose acts on
// the live game at the moment of the call and a reading is built at the call
// (specs/instrumentation.md), so the rosters are held to being UNTOUCHED rather
// than to being merely still there.
//
// WHAT THIS DOES NOT DECIDE. What the scaled figures DO — that a later stage's
// drones fly faster, that its bullets fall faster, that its dives come closer
// together and that its Fluxes hold their bands for less time — which are
// `stages.scaling-drone-speed` and its siblings, along with the two points at each
// cap and floor.

import { afterEach, beforeEach, it } from "vitest";
import {
  CHALLENGE_EVERY,
  bulletSpeedScale,
  diveGapScale,
  droneSpeedScale,
  fluxHold,
  isChallengeStage,
} from "../constants";
import { assertCloseTo, assertDeepEqual, assertEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { poseCrowdedField, sortedById } from "./crowded-field";

/** The stage the field is posed at, which `startPosed` leaves it at. */
const POSED_STAGE = 1;

/**
 * The stage posed onto it: `9`.
 *
 * A multiple of `CHALLENGE_EVERY` (`3`), so `isChallenge` turns over, and far
 * enough along that all four scaled figures have moved without any of them
 * reaching its cap or floor — and they are four different numbers there, so a
 * formula wired into the wrong field reads as the wrong number rather than
 * matching by accident.
 */
const STAGE = 9;

/**
 * How far a derived figure may sit from its formula, in decimal digits for
 * `assertCloseTo`.
 *
 * Six, which is half a millionth. specs/stages.md gives each figure as an exact
 * expression and a build evaluating it in a different but equivalent order lands
 * within the last bits of a double; the nearest wrong answer is a whole stage
 * away, which is `0.06` for `droneSpeedScale` and `0.05` for the others — four
 * orders of magnitude outside this.
 */
const SCALE_DIGITS = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("moves the derived figures and leaves the rosters untouched", async () => {
  await poseCrowdedField(h);

  const before = h.snapshot();
  assertEqual(
    before.stage,
    POSED_STAGE,
    "the stage the field was posed at, which the pose below moves it off",
  );
  assertEqual(
    before.isChallenge,
    isChallengeStage(POSED_STAGE),
    `whether stage ${POSED_STAGE} is a challenge stage, which specs/stages.md ` +
      `derives as stage % CHALLENGE_EVERY (${CHALLENGE_EVERY}) === 0 — it is ` +
      `not, so the reading below is of a figure that turned over`,
  );

  h.debug.setStage(STAGE);
  // `reconcile` between the pose and the read, because this check is about
  // exactly the gap it closes: the five figures follow the stage, and a build
  // that keeps any of them as a stored copy rewrites it here rather than
  // answering for the stage it held before. A build that derives them at the read
  // has nothing to do and the reading is the same either way. No FRAME is driven
  // first — that would move the field this also asserts was left alone.
  h.debug.reconcile();
  const after = h.snapshot();

  await h.advance(1);
  // Before the assertions, so a failing pose still leaves the picture of the
  // field it should have left alone.
  captureStill(h, "derived");

  // ---- The rosters the pose spawns nothing into and clears nothing from -----

  assertDeepEqual(
    sortedById(after.drones),
    sortedById(before.drones),
    `the drones on the field, against the same roster read at the instant ` +
      `before setStage(${STAGE}) was called — the pose spawns nothing and ` +
      `clears nothing (specs/instrumentation.md)`,
  );
  assertDeepEqual(
    sortedById(after.bullets),
    sortedById(before.bullets),
    `the bullets in flight, against the same roster read at the instant ` +
      `before setStage(${STAGE}) was called`,
  );
  assertDeepEqual(
    sortedById(after.bursts),
    sortedById(before.bursts),
    `the bursts playing, against the same roster read at the instant before ` +
      `setStage(${STAGE}) was called`,
  );

  // ---- And the five figures that follow the stage --------------------------

  assertEqual(after.stage, STAGE, `snapshot().stage after setStage(${STAGE})`);
  assertCloseTo(
    after.droneSpeedScale,
    droneSpeedScale(STAGE),
    SCALE_DIGITS,
    `snapshot().droneSpeedScale at stage ${STAGE}, which specs/stages.md ` +
      `gives as min(1.50, 1 + 0.06 * (stage - 1))`,
  );
  assertCloseTo(
    after.bulletSpeedScale,
    bulletSpeedScale(STAGE),
    SCALE_DIGITS,
    `snapshot().bulletSpeedScale at stage ${STAGE}, which specs/stages.md ` +
      `gives as min(1.40, 1 + 0.04 * (stage - 1))`,
  );
  assertCloseTo(
    after.diveGapScale,
    diveGapScale(STAGE),
    SCALE_DIGITS,
    `snapshot().diveGapScale at stage ${STAGE}, which specs/stages.md gives ` +
      `as max(0.55, 1 - 0.05 * (stage - 1))`,
  );
  assertCloseTo(
    after.fluxHold,
    fluxHold(STAGE),
    SCALE_DIGITS,
    `snapshot().fluxHold at stage ${STAGE}, in seconds, which ` +
      `specs/stages.md gives as max(1.0, FLUX_HOLD_L1 - 0.05 * (stage - 1))`,
  );
  assertEqual(
    after.isChallenge,
    isChallengeStage(STAGE),
    `snapshot().isChallenge at stage ${STAGE}, which specs/stages.md derives ` +
      `as stage % CHALLENGE_EVERY (${CHALLENGE_EVERY}) === 0`,
  );
});
