// Wick — instrumentation/set-screen-levelup: `setScreen('levelup')` shows the
// overlay screen and draws nothing — no offers and no queue consumed.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`,
// `setScreen`: "Sets `screen` to `name` ... Nothing else changes: the run, the
// loadout, `offers`, `nextOffers`, `chestResult`, `pendingLevelUps`, every
// posed outcome, `simTime`, and the driver switches all stand exactly as they
// were", and "The pose sets the screen and nothing else, so a run is never
// begun, discarded, ended, or grown by it ... the level-up overlay is
// `setPendingLevelUps` and one `playing` tick". FILLING the overlay is that
// tick's, which `progression/`'s offer points decide.
//
// WHY THE QUEUE IS THE READING. A surface that drew a list here would either
// present it or consume the queued one on the way: `offers` empty and
// `nextOffers` still queued are the two ways that draw would show.
//
// WHY `pool` IS READ, AND WHY IT IS NOT A DRAW. `pool` is derived rather than
// stored: "on `levelup`, the candidate pool of `specs/progression.md` computed
// from the slots as they stand ... on every other screen an empty list"
// (`specs/instrumentation.md`, Snapshot shape). Reading it is a read of the
// slots, so it is expected to be the whole empty-loadout pool the moment the
// screen is `levelup`, in `BASE_WEAPON_IDS` then `PASSIVE_IDS` order, and it
// costs no draw.
//
// THE POSE. An isolated run holding nothing, one level-up queued and a list
// handed to `setNextOffers` so a consumed queue is visible, then the pose.
//
// THE TOLERANCE. None: a screen name, list contents, and a whole count.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import { BASE_WEAPON_IDS, PASSIVE_IDS, type OfferId } from "../constants";
import { captureStill, createHarness, isolate, type Harness } from "../harness";

/** The pool of an empty loadout with free slots: every base weapon, every passive. */
const EMPTY_LOADOUT_POOL: OfferId[] = [...BASE_WEAPON_IDS, ...PASSIVE_IDS];
const QUEUED: OfferId[] = ["shard", "tinder", "lure"];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("shows the overlay screen without drawing offers", async () => {
  isolate(h);
  h.debug.setPendingLevelUps(1);
  h.debug.setNextOffers(QUEUED);
  const before = h.snapshot();

  h.debug.setScreen("levelup");
  const after = h.snapshot();
  await h.frameDraw();
  captureStill(h, "levelup");

  assertEqual(after.screen, "levelup", "screen after setScreen('levelup')");
  assertEqual(after.menuIndex, 0, "menuIndex after setScreen('levelup')");
  assertLength(after.run.offers, 0, "run.offers after setScreen('levelup')");
  assertDeepEqual(
    after.run.nextOffers,
    QUEUED,
    "run.nextOffers after setScreen('levelup'), which consumes no queue",
  );
  assertEqual(
    after.run.pendingLevelUps,
    before.run.pendingLevelUps,
    "run.pendingLevelUps after setScreen('levelup')",
  );
  assertDeepEqual(
    after.run.pool,
    EMPTY_LOADOUT_POOL,
    "run.pool on levelup, derived from the slots as they stand",
  );
});
