// pathing/never-seal-leg — no placement can leave a leg of the chain with no open
// route.
//
// THE RULE THE WHOLE BUILD PHASE RESTS ON. `specs/pathing.md` refuses a placement
// that would seal any leg from `Entry -> WP1` through `WP6 -> Collector`, and
// that refusal is what makes a maze a maze rather than a wall: the player is free
// to lengthen the route as far as the yard allows and can never close it. A build
// that lets a seal through has a run that cannot continue and a Load with nowhere
// to walk, from a placement the interface offered.
//
// THE CORRIDOR IS WALLED DOWN TO ITS LAST OPEN TILE. The entry sits on the left
// edge, so two footprints above and below it leave exactly one tile of escape,
// and the placement that covers that tile is the sealing one. Every other
// placement condition holds for it — its four tiles are Open, it is in bounds, no
// unit stands on it — so the never-seal rule is the only thing that can refuse
// it, and a legal placement beside it is taken to show the yard was still
// accepting.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  openYard,
  standBlocker,
  type Harness,
} from "../harness";

/** The two footprints that pen the entry in, leaving one tile of escape. */
const PEN = [
  { col: 0, row: 3 },
  { col: 0, row: 6 },
];

/** The placement that covers the last open tile of the Entry -> WP1 leg. */
const SEALING = { col: 2, row: 5 };

/** A placement beside it that leaves the escape open. */
const LEGAL = { col: 4, row: 5 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("refuses the placement that would close a leg, and accepts one beside it", async () => {
  await openYard(h);
  for (const at of PEN) await standBlocker(h, at.col, at.row);

  const before = await h.snapshot();

  // The sealing placement, taken through the press so the stamp is readable.
  await h.debug.placeRock(SEALING.col, SEALING.row);
  const after = await h.snapshot();
  await captureStill(h, "refused");

  assertEqual(
    after.structures.length,
    before.structures.length,
    `the yard to stay at ${before.structures.length} structures after a ` +
      `placement anchored at (${SEALING.col}, ${SEALING.row}), which would ` +
      `leave the Entry -> WP1 leg with no open route`,
  );
  assertEqual(
    after.stampsLeft,
    before.stampsLeft,
    "the stamp allowance after a refused placement",
  );
  assertCloseTo(
    after.mazeLength,
    before.mazeLength,
    6,
    "the maze length after a refused placement",
  );

  // And the yard was still accepting: the same rock lands one footprint over,
  // where the escape stays open.
  await h.debug.placeRock(LEGAL.col, LEGAL.row);
  const beside = await h.snapshot();
  assertEqual(
    beside.structures.length,
    before.structures.length + 1,
    `a placement anchored at (${LEGAL.col}, ${LEGAL.row}) to be accepted, ` +
      `leaving every leg of the chain an open route`,
  );
  assertEqual(
    beside.stampsLeft,
    before.stampsLeft - 1,
    "the stamp allowance after an accepted placement",
  );
});
