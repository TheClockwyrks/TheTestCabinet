// Meltdown — heat/conduction-is-symmetric: conduction moves what it takes.
//
// `specs/heat.md` says it in one sentence: conduction "is the same flow in both
// directions, so what one loses the other gains before either is divided by its
// own mass". So the flow is a property of the CONTACT, not of either tower, and
// the way to read that is to put two DIFFERENT masses on the two ends of one
// contact: the Arc's `1.0` against the Stutter's `0.5` (`specs/towers.md`). The
// two towers then move by different amounts — the Stutter by twice as much — and
// multiplying each move by its own mass must give back one number.
//
// A build that halves a flow into each end, or that computes each end's flow
// from its own point of view with a sign error, reads two different numbers here
// even though both towers moved.
//
// EVERY OTHER FLOW IS POSED OUT OF THE ARRANGEMENT. Each subject's three
// remaining faces are walled by a tower at its own heat, so the air term is
// exactly zero and the walls conduct nothing — a gradient of zero rather than a
// faculty switched off — and the reading is one frame, so the walls' own cooling
// cannot reach either subject. What is left is one flow across one contact,
// weighed from both ends.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertGreaterThan } from "../assert";
import { BOXED_SITE } from "../fixtures";
import {
  captureStill,
  createHarness,
  poseIdleTower,
  requireTower,
  seconds,
  startRun,
  type Harness,
} from "../harness";
import { sizeOf } from "../thermal";
import { wallFaces, type Footprint } from "./faces";
import { massOf } from "./roster";

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
 * The arrangement leaves each end's change as one multiplication over figures
 * the specification states exactly, so a conformant build gives back the same
 * number from both ends to within float slack. What the bound excludes is a
 * build that does not move one flow: halving it into each end leaves the two
 * readings `280` apart.
 */
const FLOW_DIGITS = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("Conduction moves what it takes", async () => {
  await startRun(h);
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
  const hot = await poseIdleTower(h, HEAVY, hotAt.col, hotAt.row, {
    heat: HOT,
  });
  const cool = await poseIdleTower(h, LIGHT, coolAt.col, coolAt.row, {
    heat: COOL,
  });
  await wallFaces(h, hotAt, ["N", "E", "W"], { wall: HEAVY, heat: HOT });
  await wallFaces(h, coolAt, ["E", "W", "S"], { wall: HEAVY, heat: COOL });

  await h.advance(1);
  await captureStill(h, "exchange");
  const exchanged = await h.snapshot();

  const lost =
    ((HOT - requireTower(exchanged, hot, `the ${HEAVY}`).heat) *
      massOf(HEAVY)) /
    DT;
  const gained =
    ((requireTower(exchanged, cool, `the ${LIGHT}`).heat - COOL) *
      massOf(LIGHT)) /
    DT;

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
