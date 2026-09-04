// Wick — instrumentation/set-screen-keeps-offers: `setScreen('playing')` on
// `levelup` leaves the overlay's `offers` and `pendingLevelUps` standing.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`,
// `setScreen`: "Sets `screen` to `name` ... Nothing else changes: the run, the
// loadout, `offers`, `nextOffers`, `chestResult`, `pendingLevelUps`,
// `rngState`, `simTime`, and the driver switches all stand exactly as they
// were", and "Applies on every screen". Resolving a level-up is `choose`'s:
// `choose(index)` "applies the item, `pendingLevelUps` falls by one, and
// either the next queued overlay opens with a fresh pool or `screen` returns
// to `playing`", which `progression/`'s accept points decide.
//
// WHY THIS IS ITS OWN POINT. `levelup` is the screen with the most state
// hanging off it — an offer list, a queue, and a pool — so a surface that
// clears any of it on the way back to `playing` is a build that quietly eats a
// level-up. The whole `run` is compared, with the offer list and the queue
// read on their own first so a failure names which one moved.
//
// THE POSE. An isolated run with the level-up overlay opened by the real tick
// (`openLevelUp`), then the pose. `rngState` and `simTime` are read too: the
// pose spends neither.
//
// THE TOLERANCE. None: a screen name, list contents, and whole counts.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertGreaterThan } from "../assert";
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
  h.dispose();
});

it("leaves the offers and the queue standing across the pose", async () => {
  isolate(h);
  const before = await openLevelUp(h, 1);
  assertEqual(before.screen, "levelup", "screen before the pose");
  assertGreaterThan(
    before.run.offers.length,
    0,
    "the offers the overlay drew before the pose",
  );

  h.debug.setScreen("playing");
  const after = h.snapshot();
  await h.frameDraw();
  captureStill(h, "kept");

  assertEqual(after.screen, "playing", "screen after setScreen('playing')");
  assertDeepEqual(
    after.run.offers,
    before.run.offers,
    "run.offers after setScreen('playing') on levelup",
  );
  assertEqual(
    after.run.pendingLevelUps,
    before.run.pendingLevelUps,
    "run.pendingLevelUps after setScreen('playing') on levelup",
  );
  assertEqual(
    after.rngState,
    before.rngState,
    "rngState after setScreen('playing') on levelup",
  );
  assertEqual(
    after.simTime,
    before.simTime,
    "simTime after setScreen('playing') on levelup",
  );
});
