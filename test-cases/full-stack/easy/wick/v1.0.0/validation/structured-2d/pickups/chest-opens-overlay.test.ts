// pickups/chest-opens-overlay — collecting a chest opens the chest overlay.
//
// WHERE THE THRESHOLD COMES FROM. `specs/world.md` ("Pickups") lists what a
// chest does: "Opens the chest overlay, as `specs/progression.md` states", and
// ("Collection") when it is taken: "A pickup is collected on any tick on which
// the distance between its center and the lamplighter's center is less than
// `PICKUP_ITEM_RADIUS` (`16`) plus `PLAYER_RADIUS`". `specs/progression.md`
// ("The chest overlay"): "On the tick it is collected the tick runs to
// completion, the chest's result is applied ... `chestResult` records it, and
// `screen` becomes `chest` with `menuIndex` `0`", which `specs/world.md` ("One
// tick") puts last, in phase 12. So a chest posed on the lamplighter's center,
// at distance `0`, is collected by the next tick, and that tick ends on `chest`
// with `menuIndex` `0` and a recorded result.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night: every driver switch off,
// nothing alive, nothing else dropped, and no slot held, so the chest is the
// only thing the tick can act on and nothing else opens or blocks an overlay.
// `isolate` poses `ISOLATE_LEVEL` (`50`), whose `xpToNext` is `495`, and no gem
// is on the field, so no level-up is queued to compete for the end of the tick.
// The chest is reached the real way, by `spawnPickup("chest", ...)` at the
// lamplighter's center and one tick, which `specs/instrumentation.md` names as
// "the real collection path"; no `setScreen` is used, because the requirement
// is that the collection is what opens the overlay.
//
// THE TOLERANCE. None: a pickup count, a screen name, a menu index, and whether
// a result was recorded are all exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull } from "../assert";
import {
  captureStill,
  createHarness,
  isolate,
  openChest,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("ends the collecting tick on the chest overlay with a recorded result", async () => {
  const opened = isolate(h);
  assertEqual(opened.screen, "playing", "the screen the chest is posed on");

  const after = await openChest(h);
  captureStill(h, "opened");

  assertEqual(after.run.pickups.length, 0, "the pickups left after the tick");
  assertEqual(
    after.screen,
    "chest",
    "the screen the collecting tick left (specs/progression.md, The chest overlay)",
  );
  assertEqual(after.menuIndex, 0, "the menu index the overlay opened at");
  assertNotNull(after.run.chestResult, "the chest result the tick recorded");
});
