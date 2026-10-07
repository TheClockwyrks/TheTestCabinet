// Wick — instrumentation/set-screen-keeps-chest-result: `setScreen('playing')`
// on `chest` leaves `chestResult` and the rest of the run standing.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`,
// `setScreen`: "Nothing else changes: the run, the loadout, `offers`,
// `nextOffers`, `chestResult`, `pendingLevelUps`, every posed outcome, `simTime`, and
// the driver switches all stand exactly as they were", and "The pose sets the
// screen and nothing else". Closing the overlay is `confirm`'s:
// `specs/progression.md`, "The chest overlay", "`confirm` closes it, setting
// `chestResult` to `null` and `screen` to `playing`", which
// `screens/`'s chest points decide.
//
// WHY THIS IS ITS OWN POINT. `chestResult` is the one field of the run that an
// overlay both fills and clears, so a surface that still does the clearing on
// the way back to `playing` is the failure most easily mistaken for correct
// behavior — the screen is right and the field is wrong. The whole `run` is
// compared, with `chestResult` read on its own first so a failure names it.
//
// THE POSE. An isolated run with a moth and a gem on the field, the chest
// overlay opened by the real collection tick (`openChest`), then the pose.
//
// THE TOLERANCE. None: a screen name, a whole index, and an exact run.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNotNull } from "../assert";
import {
  captureStill,
  createHarness,
  isolate,
  openChest,
  placeEnemy,
  placeGem,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("leaves the chest result standing across the pose", async () => {
  isolate(h);
  placeEnemy(h, "moth", 300, 0);
  placeGem(h, "medium", 400, 100);
  const open = await openChest(h);
  assertEqual(open.screen, "chest", "screen before the pose");
  assertNotNull(open.run.chestResult, "chestResult on the open overlay");

  h.debug.setScreen("playing");
  const after = h.snapshot();
  await h.frameDraw();
  captureStill(h, "kept");

  assertEqual(after.screen, "playing", "screen after setScreen('playing')");
  assertEqual(after.menuIndex, 0, "menuIndex after setScreen('playing')");
  assertDeepEqual(
    after.run.chestResult,
    open.run.chestResult,
    "chestResult after setScreen('playing'), against the overlay's own",
  );
  assertDeepEqual(
    after.run,
    open.run,
    "run after the pose, against the run under the overlay",
  );
});
