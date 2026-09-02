// Wick — progression/accept-new-weapon: a weapon not held enters the first
// free weapon slot at level 1 with its timer at zero.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/progression.md`,
// "Choosing", the offer table: "A weapon or passive not held ... enters the
// first free slot of its kind at level `1`. A weapon's cooldown timer starts
// at `0`". "Slots": "An item enters the first free slot of its kind at level
// `1` and keeps that slot for the rest of the run, so slot order is
// acquisition order."
//
// THE POSE. An isolated `playing` run holding Taper alone at level `1`, so the
// first free weapon slot is the second. `setNextOffers(["ember"])` fixes the
// overlay's single offer, since `specs/instrumentation.md` accepts a queued
// list "when every id is a candidate of the pool at that moment" and an unheld
// base weapon with a slot free is one; so the acceptance is Ember rather than
// whatever a draw happened to give. Every driver switch is off, so the tick
// that opens the overlay moves no cooldown timer.
//
// THE TOLERANCE. Exact: the whole `weapons` list, field for field.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual } from "../assert";
import type { OfferId } from "../constants";
import {
  captureStill,
  createHarness,
  holdWeapon,
  isolate,
  openLevelUp,
  type Harness,
} from "../harness";

const OFFERS: OfferId[] = ["ember"];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("appends Ember at level 1 with cooldown 0 behind the Taper already held", async () => {
  isolate(h);
  holdWeapon(h, "taper", 1);
  h.debug.setNextOffers(OFFERS);

  const overlay = await openLevelUp(h, 1);
  assertDeepEqual(overlay.run.offers, OFFERS, "the overlay's offers");

  h.debug.choose(0);
  const after = h.snapshot();
  await h.frameDraw();
  captureStill(h, "weapon");

  assertDeepEqual(
    after.run.weapons,
    [
      { id: "taper", level: 1, cooldown: 0 },
      { id: "ember", level: 1, cooldown: 0 },
    ],
    "run.weapons after accepting an unheld weapon (specs/progression.md, Choosing)",
  );
});
