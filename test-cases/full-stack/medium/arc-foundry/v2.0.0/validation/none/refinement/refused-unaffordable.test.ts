// refinement/refused-unaffordable — refining is refused with the price not met.
//
// specs/scrap-press.md fixes the refusal: refining "is refused at `R8` and when the
// player cannot afford the next level". specs/controls.md says the same of the
// control that commits it: upgrading "when the selection is not a combination
// tower, refines the press one level", and "Both are refused at their top rung and
// when unaffordable". specs/instrumentation.md carries the refusal into the
// operation: an operation standing for a control "is refused wherever the control
// is refused and does nothing when it is", and "The refusal is readable in the
// snapshot: ... no Charge leaves the bank".
//
// The bank is posed one Charge short of the next rung, twice: at the foot of the
// track, and part-way up it, because a build that checks the price only for the
// first rung is a different build from one that never checks it. Nothing is on the
// yard and no wave is running, so the only thing that could move either figure is
// the purchase being refused or going through.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { refinementCost } from "../constants";
import {
  captureStill,
  createHarness,
  openYard,
  type Harness,
} from "../harness";

/** The rung part-way up the track the second attempt is made from. */
const MIDWAY = 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("changes neither the level nor the bank when the next rung is one Charge out of reach", async () => {
  // At the foot of the track: R1 costs 20, and the bank holds 19.
  const short = refinementCost(1) - 1;
  await openYard(h, { charge: short, refinement: 0 });
  await h.advance(1);
  await captureStill(h, "refused");

  await h.debug.upgradeQuality();
  let s = await h.snapshot();
  assertEqual(s.refinement, 0, "the level after a refinement one Charge short");
  assertEqual(s.charge, short, "the bank after a refinement one Charge short");

  // And part-way up it, where the price is a different figure.
  const shortMidway = refinementCost(MIDWAY + 1) - 1;
  await h.debug.setRefinement(MIDWAY);
  await h.debug.setCharge(shortMidway);

  await h.debug.upgradeQuality();
  s = await h.snapshot();
  assertEqual(
    s.refinement,
    MIDWAY,
    `the level after a refusal at R${MIDWAY}, where R${MIDWAY + 1} costs ` +
      `${refinementCost(MIDWAY + 1)}`,
  );
  assertEqual(s.charge, shortMidway, `the bank after a refusal at R${MIDWAY}`);
});
