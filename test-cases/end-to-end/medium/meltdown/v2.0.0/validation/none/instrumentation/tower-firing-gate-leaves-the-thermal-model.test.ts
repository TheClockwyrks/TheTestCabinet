// Meltdown — instrumentation/tower-firing-gate-leaves-the-thermal-model: holding a
// tower's guns holds ITS GUNS, and leaves the heat model running underneath.
//
// THE RULE. `specs/instrumentation.md`, of `firingEnabled`: "Off, the tower's
// thermal model runs exactly as an idle tower's does: it cools, conducts,
// exchanges with movers, and trips."
//
// THIS IS THE OTHER HALF OF THE GATE, AND THE HALF EVERY THERMAL CHECK RESTS ON.
// `instrumentation/tower-firing-gate` decides that the guns really stop; this one
// decides that nothing ELSE stopped with them. A build that implemented the gate
// by taking the tower out of the frame's resolution altogether passes that one
// completely — no shot, no damage, no heat — and turns every `heat/*` reading in
// this project into a reading of a frozen tower. Those checks are posed through
// `poseIdleTower`, which is this gate, so the failure would look like a broken
// cooling constant on twenty items at once.
//
// THE EXPECTATION IS THE SPECIFICATION'S ARITHMETIC, NOT THE REFERENCE'S. What
// "exactly what an idle tower cools by" comes to is computed here from
// `specs/heat.md`'s own two-phase rule and its four flow constants, over the
// footprint and radiator faces `specs/towers.md` gives this type — that is what
// `thermal.ts` is. Nothing is read off the build but the arrangement this check
// posed.
//
// A TARGET STANDS IN RANGE, WHICH IS WHAT MAKES THE READING ABOUT THE GATE. With
// an empty floor the tower would have nothing to fire at and its heat would follow
// the idle curve whether the gate worked or not. With a held, unkillable Mote four
// and a half tiles out, a build whose gate does nothing adds `heatPerShot` to the
// reading and lands far above the curve — and a build that froze the tower lands
// at the heat it was posed at, far above it in the other direction.
//
// POSED AT `60`, in open air, on a quiet anchor: hot enough that air cooling is a
// substantial flow (`specs/heat.md` makes it proportional to `H / 100`), far below
// the trip so no crossing can enter the reading, and clear of every other
// footprint so conduction and the movers' flows are all zero and the curve is air
// cooling alone.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertEqual } from "../assert";
import { FREE_SITE } from "../fixtures";
import {
  captureStill,
  createHarness,
  framesFor,
  poseTarget,
  poseTower,
  requireTower,
  seconds,
  startRun,
  type Harness,
} from "../harness";
import { heatAfter, towerFrom } from "../thermal";

/** The emitter read, the heat it is posed at, and the span it cools over. */
const TOWER = "arc";
const POSED_HEAT = 60;
const SPAN_SECONDS = 1;

/** Where the target stands, in tiles right of the anchor. Geometry, not a bound. */
const TARGET_OFFSET = 5;
/** Hp far past anything this window could remove, were the guns not held. */
const TARGET_HP = 5000;

/**
 * How close the cooled heat must come to the specification's own figure, in
 * decimal places: within `0.05` of a heat point.
 *
 * The span is integrated frame by frame at the same step the build was driven at,
 * over constants `specs/heat.md` states exactly, so a conformant build has no need
 * of the room; this is the float's own accumulation over a hundred and twenty
 * frames. What the bound excludes is every other reading of the rule: a build
 * whose gate froze the tower reads `60`, one whose gate let it fire reads well
 * above `60`, and one that shed per FACE rather than per edge-tile misses by
 * several points.
 */
const HEAT_DIGITS = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("cools by exactly what an idle tower of the same layout cools by", async () => {
  await startRun(h);
  const id = await poseTower(h, TOWER, FREE_SITE.col, FREE_SITE.row);
  await h.debug.setTowerFiring(id, false);
  await h.debug.setTowerHeat(id, POSED_HEAT);
  await poseTarget(
    h,
    "mote",
    FREE_SITE.col + TARGET_OFFSET,
    FREE_SITE.row,
    TARGET_HP,
  );

  const opened = requireTower(await h.snapshot(), id, "the posed Arc");
  assertEqual(opened.firingEnabled, false, "the tower's guns were held");
  assertCloseTo(
    opened.heat,
    POSED_HEAT,
    HEAT_DIGITS,
    "the heat the tower was posed at",
  );

  await h.advance(framesFor(SPAN_SECONDS));
  await captureStill(h, "cooling");

  // The specification's own arithmetic over the floor this check posed: a lone
  // emitter, all four faces on open floor, no shot, integrated frame by frame at
  // the step the build was driven at.
  const expected = heatAfter(
    [towerFrom(opened)],
    id,
    seconds(1),
    framesFor(SPAN_SECONDS),
  );

  assertCloseTo(
    requireTower(await h.snapshot(), id, "the held Arc a second later").heat,
    expected,
    HEAT_DIGITS,
    `the heat a gun-held ${TOWER} posed at ${POSED_HEAT} holds after ` +
      `${SPAN_SECONDS} second of air cooling`,
  );
});
