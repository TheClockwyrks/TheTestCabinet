// progression/slot-order-is-acquisition-order — an item keeps the slot it
// entered, so the slot list stays in the order the items were acquired.
//
// THE RULE, FROM THE SPEC. specs/progression.md, Slots: "An item enters the
// first free slot of its kind at level 1 and keeps that slot for the rest of
// the run, so slot order is acquisition order." Choosing gives the two effects
// that could disturb it and does not: a new item "enters the first free slot of
// its kind", and a held item's "level rises by 1", with no word of a move.
//
// THE POSE. An isolated night with nothing on the field, nothing held, and
// every driver switch off, so the acquisitions of this scenario are the run's
// only ones and no tick can add anything of its own. Each acquisition is made
// through the real path, an offer accepted on the overlay: setNextOffers puts
// one candidate in front of each overlay, and "One overlay consumes it", so the
// list is set again for each, "on levelup, where the next overlay is the queued
// one" (specs/instrumentation.md). Taper, then Ember, then Pin are accepted
// from three queued overlays, and Ember is then raised twice from two more, so
// the middle slot is the one that changed after the order was set.
//
// THE TOLERANCE. None: the slot list is read whole, in order.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  isolate,
  openLevelUp,
  type Harness,
} from "../harness";

/** The three weapons accepted, in the order they are acquired. */
const ORDER = ["taper", "ember", "pin"] as const;

/** The slot raised after the order was set, and how far. */
const RAISED = "ember";
const RAISES = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("still reads Taper, Ember, Pin in that order after Ember is leveled twice", async () => {
  isolate(h);

  h.debug.setNextOffers([ORDER[0]]);
  const first = await openLevelUp(h, ORDER.length);
  assertDeepEqual(first.run.offers, [ORDER[0]], "the first offer");
  h.debug.setNextOffers([ORDER[1]]);
  h.debug.choose(0);
  assertDeepEqual(h.snapshot().run.offers, [ORDER[1]], "the second offer");
  h.debug.setNextOffers([ORDER[2]]);
  h.debug.choose(0);
  assertDeepEqual(h.snapshot().run.offers, [ORDER[2]], "the third offer");
  h.debug.choose(0);
  assertEqual(h.snapshot().screen, "playing", "the three acquisitions done");

  h.debug.setNextOffers([RAISED]);
  const fourth = await openLevelUp(h, RAISES);
  assertDeepEqual(fourth.run.offers, [RAISED], "the first raise offered");
  h.debug.setNextOffers([RAISED]);
  h.debug.choose(0);
  assertDeepEqual(
    h.snapshot().run.offers,
    [RAISED],
    "the second raise offered",
  );
  h.debug.choose(0);

  const after = h.snapshot();
  await h.frameDraw();
  captureStill(h, "order");

  assertEqual(
    after.run.weapons.find((held) => held.id === RAISED)?.level,
    1 + RAISES,
    "the level the raises left Ember at",
  );
  assertDeepEqual(
    after.run.weapons.map((held) => held.id),
    [...ORDER],
    "the weapon slots in acquisition order",
  );
});
