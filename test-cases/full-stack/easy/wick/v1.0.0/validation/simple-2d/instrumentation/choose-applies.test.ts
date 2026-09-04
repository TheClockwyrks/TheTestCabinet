// instrumentation/choose-applies — on levelup, `choose(1)` applies the second
// offer exactly as moving the highlight there and pressing confirm would: the
// item is held, pendingLevelUps falls by one, and the screen returns to
// playing when nothing else is queued.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md, `choose`: "accepts
// the offer at `index`, counted from `0` down the list, exactly as moving the
// highlight there and pressing `confirm` would: the item is applied,
// `pendingLevelUps` falls by one, and either the next queued overlay opens
// with a fresh pool or `screen` returns to `playing`". specs/progression.md,
// "Choosing": a weapon not held "enters the first free slot of its kind at
// level `1`. A weapon's cooldown timer starts at `0`".
//
// THE POSE. An isolated run holding Taper, a queued level-up, and a posed
// `nextOffers` so the second offer is known to be Pin. Then the choice: Pin
// held at level 1 with cooldown 0 in the next slot, nothing queued, the screen
// playing, and the offers cleared.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  isolate,
  openLevelUp,
  type Harness,
} from "../harness";
import type { OfferId } from "../surface";

const QUEUED: OfferId[] = ["ember", "pin", "wick"];
const CHOSEN = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("applies the chosen offer and returns to playing", async () => {
  isolate(h, { keepTaper: true });
  h.debug.setNextOffers(QUEUED);
  const overlay = await openLevelUp(h, 1);
  assertDeepEqual(
    overlay.run.offers,
    QUEUED,
    "the offers the overlay presents",
  );

  h.debug.choose(CHOSEN);
  const s = h.snapshot();
  await h.tick(1);
  captureStill(h, "chosen");

  assertEqual(s.screen, "playing", "the screen after the choice");
  assertEqual(s.run.pendingLevelUps, 0, "pendingLevelUps after the choice");
  assertLength(s.run.offers, 0, "the offers off the overlay");
  assertDeepEqual(
    s.run.weapons,
    [
      { id: "taper", level: 1, cooldown: 0 },
      { id: QUEUED[CHOSEN], level: 1, cooldown: 0 },
    ],
    "the weapons after the choice: Pin joins at level 1, cooldown 0",
  );
});
