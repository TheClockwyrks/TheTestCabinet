// Meltdown — heat/conduction-none-when-equal: equal neighbours exchange nothing.
//
// `specs/heat.md` makes conduction proportional to the difference between two
// touching emitters' heats — `COND_K * sharedEdges(T, N) * (H_N - H_T)` — and
// spells the consequence out: "Two emitters at the same heat exchange nothing."
//
// THE PAIR IS MIRROR-SYMMETRIC, WHICH IS WHAT MAKES A WHOLE SECOND READABLE. Two
// flush 2x2 Arcs at the same heat have identical edge accounts — one radiator
// face blocked and one open, both plain faces open — so they shed at the same
// rate and stay equal to each other for as long as they are left alone. A
// conformant build therefore has conduction at exactly zero on every one of the
// second's frames, not merely on the first, and the two towers walk down the
// air-only curve together from `60` to about `53.4`.
//
// So the reading is two things, and they are the same requirement from two
// sides:
//
//   - the pair is still equal after the second. Any exchange takes from one and
//     gives to the other, so an exchange shows up here as a gap;
//   - and each tower is where `specs/heat.md`'s own arithmetic puts it. That
//     arithmetic is `validation/none/thermal.ts`, resolved frame by frame over
//     the floor this check posed, and its conduction term is identically zero
//     throughout — so a build that exchanges the SAME wrong amount in both
//     directions, which the equality above would miss, lands off the curve.
//
// A build that resolves its frame sequentially in place rather than in the two
// phases the specification states cools one tower first and then conducts
// against the heat it has already written, which drifts off this curve by tenths
// of a heat point over a second. What decides that rule head-on is
// `heat/two-phase-resolution`.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo } from "../assert";
import { BOXED_SITE } from "../fixtures";
import {
  captureStill,
  createHarness,
  framesFor,
  poseIdleTower,
  requireTower,
  seconds,
  startRun,
  type Harness,
} from "../harness";
import { heatAfter, sizeOf, towerFrom } from "../thermal";

/** The pair, and the heat both open at. */
const TOWER = "arc";
const HEAT = 60;

/** The window the pair is left alone for, in seconds of game time. */
const WINDOW = 1;

/** The frame the window is divided into, in seconds of game time. */
const DT = seconds(1);

/**
 * How close each reading must come, as decimal places of a heat point.
 *
 * Two places is `0.005` on a scale of `100`. Both readings are compared against
 * the same frames of the same arithmetic the build is required to run — the
 * specification's own model over the floor this check posed — so a conformant
 * build agrees to within the float slack a hundred and twenty frames of doubles
 * accumulate, which is many orders below this. What the bound excludes is an
 * exchange between equals: the sequential resolution that is the likeliest way
 * to produce one drifts by tenths of a point over the same second.
 */
const HEAT_DIGITS = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("Equal neighbours exchange nothing", async () => {
  await startRun(h);
  const north = await poseIdleTower(h, TOWER, BOXED_SITE.col, BOXED_SITE.row, {
    heat: HEAT,
  });
  const south = await poseIdleTower(
    h,
    TOWER,
    BOXED_SITE.col,
    BOXED_SITE.row + sizeOf(TOWER),
    { heat: HEAT },
  );

  const posed = (await h.snapshot()).towers.map(towerFrom);
  const frames = framesFor(WINDOW);
  const expected = heatAfter(posed, north, DT, frames);

  await h.advance(frames);
  await captureStill(h, "equal");
  const settled = await h.snapshot();
  const northHeat = requireTower(settled, north, "the northern Arc").heat;
  const southHeat = requireTower(settled, south, "the southern Arc").heat;

  assertCloseTo(
    southHeat,
    northHeat,
    HEAT_DIGITS,
    `the pair is still equal after ${WINDOW}s: an exchange would take from ` +
      `one and give to the other`,
  );
  assertCloseTo(
    northHeat,
    expected,
    HEAT_DIGITS,
    `each tower after ${WINDOW}s, against the air-only curve specs/heat.md's ` +
      `own arithmetic puts it on`,
  );
});
