// Meltdown — heat/conduction-is-symmetric: conduction moves what it takes.
//
// specs/heat.md says it in one sentence: conduction "is the same flow in both
// directions, so what one loses the other gains before either is divided by its
// own mass". So the flow is a property of the CONTACT, not of either tower, and
// the way to read that is to put two DIFFERENT masses on the two ends of one
// contact: the Arc's `1.0` against the Stutter's `0.5` (specs/towers.md). The two
// towers then move by different amounts — the Stutter by twice as much — and
// multiplying each move by its own mass must give back one number.
//
// WHAT THIS READS AND WHAT IT DOES NOT. The reading is weighed, so a flow that is
// wrong by the same factor at both ends — halved into each end, say — still gives
// back one number and is left to `heat/conduction-hot-to-cold`, which is where
// the flow's SIZE is decided. What lands here is a build in which the two ends
// disagree: one that divides the flow by the neighbour's mass rather than its
// own, one that moves into the cool end something other than what it took out of
// the hot one, and one that resolves the frame sequentially in place — where the
// second tower conducts against a heat the first has already been written to, so
// the cool end gains less than the hot end lost.
//
// EVERY OTHER FLOW IS POSED OUT OF THE ARRANGEMENT. Each subject's three
// remaining faces are walled by a tower at its own heat, so the air term is
// exactly zero and the walls conduct nothing — a gradient of zero rather than a
// faculty switched off — and the reading is one frame, so the walls' own cooling
// cannot reach either subject. What is left is one flow across one contact,
// weighed from both ends.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  poseIdleTower,
  seconds,
  sizeOf,
  startRun,
  type Harness,
} from "../harness";
import { wallFaces, type Footprint } from "./faces";
import { massOf, towerOf } from "./roster";
import { BOXED_SITE } from "./sites";

/** The two ends of the contact: same footprint, different mass. */
const HEAVY = "arc";
const LIGHT = "stutter";

/** The heats they open at. */
const HOT = 90;
const COOL = 10;

/** The frame the exchange is measured over, in seconds of game time. */
const DT = seconds(1);

/**
 * How close the two weighed flows must come to each other, as decimal places of
 * heat per second.
 *
 * One place is `0.05` against a flow of `560` — under a hundredth of one percent.
 * The arrangement leaves each end's change as one multiplication over figures the
 * specification states exactly, so a conformant build gives back the same number
 * from both ends to within float slack. What the bound excludes is a build whose
 * two ends disagree at all: weighing the flow with the wrong mass puts the two
 * readings a factor of two apart, and a sequential in-place resolution tens of
 * units apart, both thousands of times the bound.
 */
const FLOW_DIGITS = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("Conduction moves what it takes", async () => {
  startRun(h);
  const hotAt: Footprint = {
    type: HEAVY,
    col: BOXED_SITE.col,
    row: BOXED_SITE.row,
  };
  const coolAt: Footprint = {
    type: LIGHT,
    col: BOXED_SITE.col,
    row: BOXED_SITE.row + sizeOf(HEAVY),
  };
  const hot = poseIdleTower(h, HEAVY, hotAt.col, hotAt.row, 0, HOT);
  const cool = poseIdleTower(h, LIGHT, coolAt.col, coolAt.row, 0, COOL);
  wallFaces(h, hotAt, ["N", "E", "W"], { wall: HEAVY, heat: HOT });
  wallFaces(h, coolAt, ["E", "W", "S"], { wall: HEAVY, heat: COOL });

  await h.advance(1);
  captureStill(h, "exchange");
  const exchanged = h.snapshot();

  const lost = ((HOT - towerOf(exchanged, hot).heat) * massOf(HEAVY)) / DT;
  const gained = ((towerOf(exchanged, cool).heat - COOL) * massOf(LIGHT)) / DT;

  assertGreaterThan(
    lost,
    0,
    `the ${HEAVY} at ${HOT} lost heat to its cooler neighbour`,
  );
  assertCloseTo(
    gained,
    lost,
    FLOW_DIGITS,
    `the flow weighed at the ${LIGHT}'s end (mass ${massOf(LIGHT)}) against ` +
      `the flow weighed at the ${HEAVY}'s (mass ${massOf(HEAVY)})`,
  );
});
