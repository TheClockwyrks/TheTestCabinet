// waves/speed-doubles-the-game-time — the toggle doubles the game time a frame
// carries.
//
// `specs/waves.md`, Pause and speed: "The game-speed toggle sets `speed` to `1` or
// `2`, and the game time a frame advances by is that frame's elapsed time
// multiplied by `speed`, so at `2` the game advances twice the game time per unit
// of elapsed time and `simTime` gains twice as fast."
// `specs/instrumentation.md` says the same of the field this reads: "`simTime`
// accumulates the game time the simulation advanced by, so it holds still while
// the game is paused and gains at twice the rate at `speed` `2`."
//
// THE TWO LEGS ARE THE SAME FRAMES OF THE SAME CLOCK, ONE AT EACH SETTING, and
// that is what makes this reading exact. `advance(seconds, frames)` runs "whole
// frames ... Each is a real frame, THE SAME UPDATE THE LOOP RUNS"
// (`specs/instrumentation.md`), so a frame delivered through it carries the
// frame's elapsed time into the same multiplication a frame the loop scheduled
// carries it into. Deliver the identical number of identical frames at each
// setting and the only thing that can differ between the two legs is the
// multiplier the specification fixes.
//
// WHY THIS ITEM IS NOT READ OFF A STRETCH OF WALL CLOCK, though an earlier
// revision of it was. A real window measures the multiplier and the machine at
// once: the game time a leg gains is the sum of the elapsed times of however many
// frames the host let the page run, each of them clamped by whatever ceiling the
// build puts on a long frame's delta (this case's own reference clamps at a tenth
// of a second, and no spec forbids it). Two legs run seconds apart on a loaded
// machine get different frame counts and different clamping, so the ratio between
// them carries the runner's load into a point about the build — and a correct
// build loses the point for it. Both engine-backed copies of this item next door
// have always read it off frames of a fixed clock for the same reason; this makes
// the three agree.
//
// BOTH READINGS OF THE ONE CLAIM. The clock gain says the multiplier reached
// `simTime`; the travel says it reached the simulation the field is supposed to be
// accumulating, so a build that counts a doubled clock while the floor walks at
// one speed is caught. Each leg's distance and its clock come from the same pair
// of snapshots, so they describe the same frames.
//
// THE SETTING IS POSED, NOT PRESSED. This reading is about what the setting does,
// not about which key `specs/controls.md` binds the toggle to; `controls.*` grades
// the binding.
//
// EACH LEG IS ITS OWN RUN, posed from scratch, so the second leg starts from the
// same floor as the first and the Mote of each has the whole corridor ahead of it.
//
// WHAT EVERY WRONG MODEL READS. A toggle that does nothing reads `1`; one applied
// twice over reads `4`; an inverted one reads `0.5`. Each is a whole unit from the
// `2` the specification fixes, and many times the tolerance below.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  distance,
  framesFor,
  requireUnit,
  startRun,
  type Harness,
  type MeltdownSnapshot,
} from "../harness";
import { poseRunningFloor } from "./run";

/**
 * The frames each leg spends: a second and a half of the suite's `120` Hz clock.
 *
 * The length is geometry, not a tolerance. Both legs together carry the Mote about
 * fourteen tiles down a forty-nine-tile corridor (`specs/floor.md`), so neither
 * reading is cut short by a walker reaching its exhaust. It is the same window the
 * two engine-backed copies of this item spend.
 */
const LEG_FRAMES = framesFor(1.5);

/** The two settings the toggle offers (`specs/waves.md`). */
const SLOW = 1;
const FAST = 2;

/** What doubling the speed must multiply a leg's game time by (`specs/waves.md`). */
const EXPECTED_RATIO = FAST / SLOW;

/**
 * How far either ratio may fall from `2`: a twentieth.
 *
 * The two legs are the same number of frames of the same fixed clock, so a
 * conformant build's ratio is exactly `2` and needs none of this room. What the
 * allowance covers is a build that resolves a posed field on the frame after the
 * pose: one frame in `180` is `0.006` of a leg, and `0.05` is nine such frames.
 * Every other reading of the rule — `1`, `4`, `0.5` — is a whole unit away. It is
 * the figure both engine-backed copies of this item hold.
 */
const RATIO_TOLERANCE = 0.05;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

/** Pose a fresh run at `speed`, spend one leg on it, and report what it did. */
async function legAt(speed: number): Promise<{
  opened: MeltdownSnapshot;
  closed: MeltdownSnapshot;
  mote: number;
}> {
  await startRun(h);
  const mote = await poseRunningFloor(h);
  await h.debug.setSpeed(speed);
  const opened = await h.snapshot();
  await h.advance(LEG_FRAMES);
  return { opened, closed: await h.snapshot(), mote };
}

it("gains twice the game time and walks twice as far over the same window", async () => {
  const slow = await legAt(SLOW);
  const fast = await legAt(FAST);

  await captureStill(h, "doubled");

  const travelled = (leg: typeof slow): number =>
    distance(
      requireUnit(leg.opened, leg.mote, "the leg's opening frame"),
      requireUnit(leg.closed, leg.mote, "the leg's closing frame"),
    );

  const slowClock = slow.closed.simTime - slow.opened.simTime;
  const fastClock = fast.closed.simTime - fast.opened.simTime;

  assertEqual(
    slow.closed.speed,
    SLOW,
    `precondition: the first leg ran at speed ${SLOW}`,
  );
  assertEqual(
    fast.closed.speed,
    FAST,
    `precondition: the second leg ran at speed ${FAST}`,
  );
  assertGreaterThan(
    slowClock,
    0,
    `precondition: the leg at speed ${SLOW} advanced the game at all`,
  );
  assertGreaterThan(
    travelled(slow),
    0,
    `precondition: the Mote walked at speed ${SLOW}`,
  );

  assertBetween(
    fastClock / slowClock,
    EXPECTED_RATIO - RATIO_TOLERANCE,
    EXPECTED_RATIO + RATIO_TOLERANCE,
    `the simTime one leg gained at speed ${FAST} over the same leg at speed ${SLOW}`,
  );
  assertBetween(
    travelled(fast) / travelled(slow),
    EXPECTED_RATIO - RATIO_TOLERANCE,
    EXPECTED_RATIO + RATIO_TOLERANCE,
    `the units the Mote walked in one leg at speed ${FAST} over the same leg at ` +
      `speed ${SLOW}`,
  );
});
