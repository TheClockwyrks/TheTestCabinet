// quality/combine-lands-at-initiator — the result stands where the fold was started.
//
// specs/scrap-press.md fixes it once for both kinds of combine: "The result lands
// at the footprint of the piece the combine was initiated from, so a combine may
// replace a standing structure in place."
//
// The same pair is folded twice on the same two footprints, initiated from the
// other piece the second time, so the only thing that differs between the two
// drives is which piece the combine was committed from. That is what makes this a
// check on the rule rather than on where a build happens to put a result: a build
// that always lands the result on, say, the lower-numbered footprint passes the
// first drive and fails the second.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  emptyYard,
  openYard,
  standComponent,
  type Harness,
} from "../harness";
import { anchored } from "./anchors";

const LEFT = { col: 8, row: 10 };
const RIGHT = { col: 16, row: 10 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("lands the fold on whichever of the pair it was initiated from", async () => {
  openYard(h);

  // Initiated from the left piece.
  const fromLeft = standComponent(h, "capacitor", 1, LEFT.col, LEFT.row);
  standComponent(h, "capacitor", 1, RIGHT.col, RIGHT.row);
  h.debug.combine(fromLeft);

  let after = h.snapshot();
  assertEqual(
    anchored(after, LEFT).kind,
    "component",
    "the result on the initiating footprint, initiated from the left",
  );
  assertEqual(anchored(after, LEFT).quality, 2, "the result's tier");
  assertEqual(
    anchored(after, RIGHT).kind,
    "blocker",
    "the other footprint, consumed",
  );

  // The same pair, on the same two footprints, initiated from the right piece.
  emptyYard(h);
  standComponent(h, "capacitor", 1, LEFT.col, LEFT.row);
  const fromRight = standComponent(h, "capacitor", 1, RIGHT.col, RIGHT.row);
  h.debug.combine(fromRight);
  await h.advance(1);
  captureStill(h, "landed");

  after = h.snapshot();
  assertEqual(
    anchored(after, RIGHT).kind,
    "component",
    "the result on the initiating footprint, initiated from the right",
  );
  assertEqual(anchored(after, RIGHT).quality, 2, "the result's tier");
  assertEqual(
    anchored(after, LEFT).kind,
    "blocker",
    "the other footprint, consumed",
  );
});
