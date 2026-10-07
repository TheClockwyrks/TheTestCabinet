// progression/accept-new-passive — a passive not held enters the first free
// passive slot at level 1.
//
// THE RULE, FROM THE SPEC. specs/progression.md, Choosing: "A weapon or passive
// not held | It enters the first free slot of its kind at level 1." Slots: "A
// weapon slot holds one weapon at one level, and a passive slot holds one
// passive at one level. An item enters the first free slot of its kind at level
// 1".
//
// THE POSE. An isolated night with nothing on the field, no passive held, and
// every driver switch off, so the first free passive slot is the first one.
// Brass is put in front of the overlay through setNextOffers, whose list "is
// accepted when every id is a candidate of the pool at that moment"
// (specs/instrumentation.md): with every passive slot free, Brass is a new-item
// candidate by specs/progression.md, The candidate pool. The overlay is opened
// the real way, and choose(0) accepts the single offer.
//
// THE TOLERANCE. None: the slot list, the id, and the level are discrete.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  isolate,
  openLevelUp,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("puts Brass in the first passive slot at level 1", async () => {
  isolate(h);
  h.debug.setNextOffers(["brass"]);

  const overlay = await openLevelUp(h, 1);
  assertEqual(
    overlay.screen,
    "levelup",
    "the overlay the offer is accepted on",
  );
  assertDeepEqual(
    overlay.run.offers,
    ["brass"],
    "the offer put in front of it",
  );
  h.debug.choose(0);
  const after = h.snapshot();
  await h.frameDraw();
  captureStill(h, "passive");

  assertDeepEqual(
    after.run.passives,
    [{ id: "brass", level: 1 }],
    "the passive slots after the acceptance",
  );
});
