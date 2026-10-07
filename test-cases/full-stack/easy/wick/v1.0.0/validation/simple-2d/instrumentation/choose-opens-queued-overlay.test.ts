// instrumentation/choose-opens-queued-overlay — on levelup with
// pendingLevelUps 2, `choose(0)` applies the offer and opens the next overlay
// at once, screen still levelup with menuIndex 0, pendingLevelUps 1, and a
// fresh pool.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md, `choose`:
// "`pendingLevelUps` falls by one, and either the next queued overlay opens
// with a fresh pool or `screen` returns to `playing`". specs/progression.md,
// "Choosing": "When level-ups remain queued the next overlay opens
// immediately, with a fresh pool drawn from the slots as the acceptance left
// them"; and "The candidate pool" holds "every held passive below its max
// level".
//
// THE POSE, chosen so the fresh pool is observably fresh: Brass held one level
// below its max of 3 and offered first through `nextOffers`. Choosing it takes
// Brass to its max, so the pool the next overlay computes no longer lists it,
// where the pool the first overlay computed did.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertFalse,
  assertLength,
  assertTrue,
} from "../assert";
import { OFFER_COUNT, PASSIVES } from "../constants";
import {
  captureStill,
  createHarness,
  holdPassive,
  isolate,
  openLevelUp,
  type Harness,
} from "../harness";
import type { OfferId } from "../surface";

const QUEUED: OfferId[] = ["brass", "ember", "pin"];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("applies the offer and opens the next overlay with a fresh pool", async () => {
  isolate(h, { keepTaper: true });
  holdPassive(h, "brass", PASSIVES.brass.maxLevel - 1);
  h.debug.setNextOffers(QUEUED);
  const first = await openLevelUp(h, 2);
  assertDeepEqual(first.run.offers, QUEUED, "the first overlay's offers");
  assertTrue(first.run.pool.includes("brass"), "Brass in the first pool");

  h.debug.choose(0);
  const s = h.snapshot();
  await h.tick(1);
  captureStill(h, "queued");

  assertEqual(s.screen, "levelup", "the screen after the choice");
  assertEqual(s.menuIndex, 0, "menuIndex on the next overlay");
  assertEqual(s.run.pendingLevelUps, 1, "pendingLevelUps after the choice");
  assertDeepEqual(
    s.run.passives,
    [{ id: "brass", level: PASSIVES.brass.maxLevel }],
    "Brass at its max after the choice",
  );
  assertFalse(s.run.pool.includes("brass"), "Brass out of the fresh pool");
  assertLength(s.run.offers, OFFER_COUNT, "the next overlay's offers");
  for (const offer of s.run.offers) {
    assertTrue(s.run.pool.includes(offer), `offer ${offer} in the fresh pool`);
  }
});
