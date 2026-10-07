// Wick — progression/accept-new-passive: a passive not held enters the first
// free passive slot at level 1.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/progression.md`,
// "Choosing", the offer table: "A weapon or passive not held ... enters the
// first free slot of its kind at level `1`." "Slots": "a passive slot holds one
// passive at one level", and "A run starts with ... every other slot empty".
// `specs/passives.md`: "A passive enters a slot at level `1`".
//
// THE POSE. An isolated `playing` run holding no passive at all, so the first
// free passive slot is the first. `setNextOffers(["brass"])` fixes the
// overlay's single offer to an unheld passive, which a free passive slot makes
// a candidate, so the acceptance is Brass rather than whatever a draw gave.
// Every driver switch is off and the world is empty.
//
// THE TOLERANCE. Exact: the whole `passives` list, field for field.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertLength } from "../assert";
import type { OfferId } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  openLevelUp,
  type Harness,
} from "../harness";

const OFFERS: OfferId[] = ["brass"];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("puts Brass at level 1 in the first passive slot", async () => {
  isolate(h);
  h.debug.setNextOffers(OFFERS);

  const overlay = await openLevelUp(h, 1);
  assertLength(overlay.run.passives, 0, "passives held before the acceptance");
  assertDeepEqual(overlay.run.offers, OFFERS, "the overlay's offers");

  h.debug.choose(0);
  const after = h.snapshot();
  await h.frameDraw();
  captureStill(h, "passive");

  assertDeepEqual(
    after.run.passives,
    [{ id: "brass", level: 1 }],
    "run.passives after accepting an unheld passive (specs/progression.md, Choosing)",
  );
});
