// Wick — instrumentation/set-next-offers-presented: a list of 1 to 3 distinct
// candidate ids is presented as given, in that order, by the next level-up
// overlay.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`,
// `setNextOffers(ids)`: "Sets `nextOffers` to `ids`, a list of `1` to
// `OFFER_COUNT` (`3`) distinct ids ... it is accepted when every id is a
// candidate of the pool at that moment ... and the overlay then presents
// exactly that list in that order." On an isolated run holding nothing the
// pool is every base weapon and every passive (`specs/progression.md`), so any
// base weapon or passive is a candidate.
//
// THE DRIVE. Two overlays opened by the real tick: one from a three-id list
// whose order is not the pool's, one from a one-id list.

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

const THREE: OfferId[] = ["shard", "tinder", "lure"];
const ONE: OfferId[] = ["halo"];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("presents a queued list of three and of one, in the order given", async () => {
  isolate(h);
  h.debug.setNextOffers(THREE);
  assertDeepEqual(
    h.snapshot().run.nextOffers,
    THREE,
    "run.nextOffers after the pose",
  );
  const three = await openLevelUp(h, 1);
  await h.frameDraw();
  captureStill(h, "presented");
  assertEqual(three.screen, "levelup", "screen after the opening tick");
  assertDeepEqual(
    three.run.offers,
    THREE,
    "offers presented from a list of three",
  );

  isolate(h);
  h.debug.setNextOffers(ONE);
  const one = await openLevelUp(h, 1);
  assertEqual(one.screen, "levelup", "screen after the second opening tick");
  assertDeepEqual(one.run.offers, ONE, "offers presented from a list of one");
});
