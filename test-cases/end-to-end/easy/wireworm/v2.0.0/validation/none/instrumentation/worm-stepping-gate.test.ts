// Wireworm — instrumentation/worm-stepping-gate: a worm whose step is gated off
// takes no tile step, while the board around it runs on.
//
// specs/instrumentation.md gives the operation exactly one faculty:
// `setWormStepping(id, enabled)` "Gates the worm's step alone: the block test on
// the tile ahead, the charge it deals, the heading change, the dive it enters,
// and the head's advance. Off, the worm takes no step and the rest of the board
// runs on."
//
// IT IS WHAT LETS A SCENARIO CARRY A WORM THAT IS NOT THE SUBJECT. A worm posed
// as an obstacle for another worm's block test, or as a target for a bolt, has
// to stand where it was put; the guidance this case is written to rules out the
// alternatives — parking it in a far corner leans on the build's own movement
// rule, which is exactly what a broken build gets wrong. So the points that pose
// a bystanding worm rest on this gate, and this point is where it is decided.
//
// TWO WORMS, ONE GATED. The gated worm is held to standing exactly where it was
// posed; the second, ungated, is the control that the span really was long
// enough for a step — without it a build whose worms never step at all would
// pass a check about holding one still.
//
// THE CONTROL IS READ LOOSELY AND ON PURPOSE. It is asserted only to have MOVED,
// not to have taken ten steps: this point is about the gate, and
// `worm/step-cadence` grades the interval. Ten level-1 intervals is a span a
// build as much as ten times slower than the figure still steps within, so a
// cadence defect cannot make this point fail for the wrong reason.
//
// EACH WORM IS ONE SEGMENT, ON AN EMPTY ROW. The requirement is the head's
// advance, so nothing else is posed into the scenario: no body to follow, no
// node to block against, no charge to deal. `instrumentation/worm-body-gate`
// decides the other faculty.

import { afterEach, beforeEach, it } from "vitest";
import { WORM_STEP_L1 } from "../constants";
import { assertEqual, assertNotEqual } from "../assert";
import {
  captureStill,
  createHarness,
  framesFor,
  headOf,
  poseWorm,
  startPlaying,
  wormById,
  type Harness,
  type WirewormSnapshot,
} from "../harness";

/** The tile the gated worm's head is posed on. */
const HELD_C = 5;
const HELD_R = 3;

/** The tile the ungated control worm's head is posed on, seven rows below it. */
const FREE_C = 5;
const FREE_R = 10;

/**
 * How many level-1 step intervals the two worms are driven for.
 *
 * Ten, which specs/worm.md makes `10 * WORM_STEP_L1` (`1.4` s) at level 1. Ten
 * rather than one so the control is read generously: a build whose interval is
 * as much as ten times the figure still steps inside this span, and a build that
 * took no step at all in `1.4` s of game time has a defect `worm/step-cadence`
 * names.
 */
const INTERVALS = 10;

/** That span in frames of the suite's clock. */
const DRIVE_FRAMES = framesFor(INTERVALS * WORM_STEP_L1);

/** A worm's head tile as `"c,r"`, or what the snapshot reported instead. */
function headTile(snapshot: WirewormSnapshot, id: number): string {
  const worm = wormById(snapshot, id);
  if (worm === undefined) return `no worm carrying id ${id}`;
  const head = headOf(worm);
  return head === undefined ? "a worm of no segments" : `${head.c},${head.r}`;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("holds a gated worm on its tile while an ungated one steps", async () => {
  await startPlaying(h);

  const held = await poseWorm(h, { c: HELD_C, r: HELD_R });
  await h.debug.setWormStepping(held, false);
  const free = await poseWorm(h, { c: FREE_C, r: FREE_R });

  await h.advance(DRIVE_FRAMES);
  // Before the assertions, so a failing gate still leaves the picture of the
  // held worm beside the stepping one.
  await captureStill(h, "gated");

  const driven = await h.snapshot();

  // The control: the span really did carry a step.
  assertNotEqual(
    headTile(driven, free),
    `${FREE_C},${FREE_R}`,
    `the ungated worm's head tile after ${INTERVALS} level-1 step intervals ` +
      `(${(INTERVALS * WORM_STEP_L1).toFixed(2)} s of game time), which is ` +
      `the tile it was posed on — without a worm that moved, holding one ` +
      `still says nothing`,
  );

  // And the gate: the worm it is held off did not step.
  assertEqual(
    headTile(driven, held),
    `${HELD_C},${HELD_R}`,
    `the gated worm's head tile over the same span, with ` +
      `setWormStepping(${held}, false) held — the gate stops the head's ` +
      `advance (specs/instrumentation.md)`,
  );
});
