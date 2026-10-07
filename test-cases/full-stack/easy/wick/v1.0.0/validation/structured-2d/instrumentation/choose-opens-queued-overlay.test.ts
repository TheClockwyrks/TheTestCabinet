// Wick — instrumentation/choose-opens-queued-overlay: on `levelup` with
// `pendingLevelUps` 2, `choose(0)` applies the offer and opens the next overlay
// at once, with `menuIndex` 0, `pendingLevelUps` 1, and a fresh pool.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`,
// `choose(index)`: "either the next queued overlay opens with a fresh pool or
// `screen` returns to `playing`". `specs/progression.md`, "Choosing": "When
// level-ups remain queued the next overlay opens immediately, with a fresh pool
// drawn from the slots as the acceptance left them"; `specs/ui.md`, `levelup`:
// "the next overlay opens with a fresh set of offers and `menuIndex = 0`".
//
// THE POSE. An isolated run holding nothing, two level-ups queued, the first
// overlay's offers fixed so `choose(0)` takes Pin. The fresh pool is computed
// from the slots as the acceptance left them: Pin held at level 1 is a `+1`
// candidate and every other base weapon and every passive is a new item, so
// the pool is still every base weapon then every passive, in that order.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertContains,
  assertDeepEqual,
  assertEqual,
  assertLength,
} from "../assert";
import {
  BASE_WEAPON_IDS,
  OFFER_COUNT,
  PASSIVE_IDS,
  type OfferId,
} from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  openLevelUp,
  type Harness,
} from "../harness";

const FIRST_OFFERS: OfferId[] = ["pin", "shard", "tinder"];
const FRESH_POOL: OfferId[] = [...BASE_WEAPON_IDS, ...PASSIVE_IDS];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("applies the offer and opens the next overlay with a fresh pool", async () => {
  isolate(h);
  h.debug.setNextOffers(FIRST_OFFERS);
  const first = await openLevelUp(h, 2);
  assertDeepEqual(first.run.offers, FIRST_OFFERS, "the first overlay's offers");

  h.debug.choose(0);
  const second = h.snapshot();
  await h.frameDraw();
  captureStill(h, "queued");

  assertDeepEqual(
    second.run.weapons,
    [{ id: "pin", level: 1, cooldown: 0 }],
    "weapons after choose(0)",
  );
  assertEqual(
    second.screen,
    "levelup",
    "screen after choose(0) with one queued",
  );
  assertEqual(second.menuIndex, 0, "menuIndex on the next overlay");
  assertEqual(
    second.run.pendingLevelUps,
    1,
    "pendingLevelUps on the next overlay",
  );
  assertDeepEqual(second.run.pool, FRESH_POOL, "the fresh pool");
  assertLength(second.run.offers, OFFER_COUNT, "the next overlay's offers");
  for (const offer of second.run.offers) {
    assertContains(
      second.run.pool,
      offer,
      `next offer ${offer} within the fresh pool`,
    );
  }
});
