// quality/explicit-set-folds-exactly — an explicit set folds its members and no others.
//
// specs/scrap-press.md fixes the explicit set as the stronger of the two ways a
// combine chooses its ingredients: "With an explicit combine set, the combine folds
// exactly the pieces in that set." specs/instrumentation.md fixes how a set is
// built without a pointer: `select` "clears the combine set back to that single
// selection" and `addToCombineSet` adds one base structure to it, "as a press on it
// with `modify` held would".
//
// The yard holds three interchangeable pieces — three Scrap Capacitors, any two of
// which would satisfy the fold — so naming two of them is the only thing that can
// decide which two go in. The third is the control: it satisfies the same fold, it
// is not in the set, and it must be standing and untouched afterwards.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  openYard,
  standComponent,
  type Harness,
} from "../harness";
import { anchored } from "./anchors";

const INITIATOR = { col: 8, row: 10 };
const PARTNER = { col: 12, row: 10 };
const OUTSIDER = { col: 16, row: 10 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("folds exactly the two pieces named and leaves the third standing", async () => {
  await openYard(h);
  const initiator = await standComponent(
    h,
    "capacitor",
    1,
    INITIATOR.col,
    INITIATOR.row,
  );
  const partner = await standComponent(
    h,
    "capacitor",
    1,
    PARTNER.col,
    PARTNER.row,
  );
  await standComponent(h, "capacitor", 1, OUTSIDER.col, OUTSIDER.row);

  // The set is exactly the initiator and one partner, built the way a player
  // builds one: a press that selects, then a modified press that adds.
  await h.debug.select(initiator);
  await h.debug.addToCombineSet(partner);
  const posed = await h.snapshot();
  assertDeepEqual(
    [...posed.combineSet].sort((a, b) => a - b),
    [initiator, partner].sort((a, b) => a - b),
    "the explicit combine set before the fold",
  );

  await h.debug.combine(initiator);
  await h.advance(1);
  await captureStill(h, "set");

  const after = await h.snapshot();
  assertLength(after.structures, 3, "three footprints, all still occupied");
  assertEqual(
    anchored(after, INITIATOR).quality,
    2,
    "the fold landed on the initiator, one tier up",
  );
  assertEqual(
    anchored(after, PARTNER).kind,
    "blocker",
    "the named partner's footprint, consumed",
  );
  assertEqual(
    anchored(after, OUTSIDER).kind,
    "component",
    "the piece outside the set, still standing",
  );
  assertEqual(
    anchored(after, OUTSIDER).quality,
    1,
    "the piece outside the set, at the tier it was stood at",
  );
});
