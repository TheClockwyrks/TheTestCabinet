// Wick — instrumentation/choose-applies: on `levelup`, `choose(1)` applies the
// second offer: the item is held, `pendingLevelUps` falls by one, and `screen`
// returns to `playing` when nothing else is queued.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`,
// `choose(index)`: "accepts the offer at `index`, counted from `0` down the
// list, exactly as moving the highlight there and pressing `confirm` would:
// the item is applied, `pendingLevelUps` falls by one, and either the next
// queued overlay opens with a fresh pool or `screen` returns to `playing`".
// `specs/progression.md`, "Choosing": "A weapon or passive not held: It enters
// the first free slot of its kind at level `1`."
//
// THE POSE. An isolated run holding nothing, the overlay opened by the real
// tick with the offers fixed through `setNextOffers` so index 1 is known to be
// Bellows; then `choose(1)`, read at the call.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import type { OfferId } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  openLevelUp,
  type Harness,
} from "../harness";

const OFFERS: OfferId[] = ["pin", "bellows", "glass"];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("holds the second offer, decrements the queue, and returns to playing", async () => {
  isolate(h);
  h.debug.setNextOffers(OFFERS);
  const open = await openLevelUp(h, 1);
  assertDeepEqual(open.run.offers, OFFERS, "offers presented before choose");
  assertEqual(open.run.pendingLevelUps, 1, "pendingLevelUps before choose");

  h.debug.choose(1);
  const after = h.snapshot();
  await h.frameDraw();
  captureStill(h, "chosen");

  assertDeepEqual(
    after.run.passives,
    [{ id: "bellows", level: 1 }],
    "passives after choose(1)",
  );
  assertDeepEqual(after.run.weapons, [], "weapons after choose(1)");
  assertEqual(after.run.pendingLevelUps, 0, "pendingLevelUps after choose(1)");
  assertEqual(
    after.screen,
    "playing",
    "screen after choose(1) with nothing queued",
  );
  assertDeepEqual(after.run.offers, [], "offers once the overlay closed");
});
