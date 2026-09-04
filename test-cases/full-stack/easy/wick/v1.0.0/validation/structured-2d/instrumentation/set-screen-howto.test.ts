// Wick — instrumentation/set-screen-howto: `setScreen('howto')` shows the
// how-to screen with `menuIndex` `0` and the run standing as it was.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`,
// `setScreen`: "Sets `screen` to `name`, one of the `Screen` values, with
// `menuIndex`, `almanacTab`, and `almanacScroll` all `0`. Nothing else
// changes: the run, the loadout, `offers`, `nextOffers`, `chestResult`,
// `pendingLevelUps`, `rngState`, `simTime`, and the driver switches all stand
// exactly as they were". `specs/state.md`, "The idle run", is the table
// `IDLE_RUN` transcribes, which is the run `reset` leaves behind.
//
// THE POSE. `reset` to the title, the highlight moved off `0` by a real press
// so `menuIndex` `0` is read as the pose's doing, then the pose, read at the
// call. The run behind the pose is the idle one `reset` restored, so reading
// it back unchanged is reading that the pose left it alone.
//
// THE TOLERANCE. None: a screen name, a whole index, and an exact run.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  IDLE_RUN,
  captureStill,
  createHarness,
  tap,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("shows howto with menuIndex 0 and the run as it stood", async () => {
  h.reset();
  const moved = await tap(h, "ArrowDown");
  assertEqual(moved.menuIndex, 1, "menuIndex moved off 0 before the pose");

  h.debug.setScreen("howto");
  const after = h.snapshot();
  await h.frameDraw();
  captureStill(h, "howto");

  assertEqual(after.screen, "howto", "screen after setScreen('howto')");
  assertEqual(after.menuIndex, 0, "menuIndex after setScreen('howto')");
  assertDeepEqual(after.run, IDLE_RUN, "run after setScreen('howto')");
});
