// pointer/paused-touch-resumes — a contact landing and lifting in `RESUME`'s
// rectangle returns to the run.
//
// WHAT THIS DECIDES. One thing: a touch contact takes `RESUME`, so a pause a
// player opened can be left on a touch device with the run exactly as it stood.
//
// THE SPEC IT RESTS ON.
//   specs/controls.md (The pointer and touch), rule 3: "a contact landing and
//   lifting inside the rectangle of the item at `menuIndex` `i` selects that
//   item and takes it exactly as `confirm` on it does."
//   specs/ui.md (`paused`): `RESUME` "Returns to the run: `screen = playing`,
//   the run exactly as the pause left it."
//
// WHY IT IS A POINT OF ITS OWN. A pause a player cannot leave is a run they
// cannot finish. The mouse's route is `pointer/paused-click-resumes`'.
//
// THE DRIVE. An isolated night carrying something worth keeping — an enemy, a
// posed clock, a posed `hp` — held under `setScreen("paused")`, which enters the
// pause "exactly as `pause` does"; then a contact landing at the middle of the
// rectangle reported for `RESUME` and lifting there, both frames half a tick, so
// the run read back is the run the pause held rather than one a tick advanced.
//
// THE TOLERANCE. None: a screen name, and the run's stored fields against
// themselves.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { PAUSE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  runFields,
  spawnEnemyAt,
  type Harness,
} from "../harness";
import { menuRectAt, touchTapRectWithoutTick } from "./pointing";

/** The item the contact takes: `RESUME`, position 0 of `PAUSE_ITEMS`. */
const RESUME = PAUSE_ITEMS.indexOf("RESUME");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("returns to playing with the run the pause held when RESUME is tapped", async () => {
  isolate(h);
  spawnEnemyAt(h, "moth", -180, 60);
  h.debug.setTick(4321);
  h.debug.setHp(72);
  h.debug.setScreen("paused");
  const before = h.snapshot();
  assertEqual(before.screen, "paused", "the screen the contact lands on");
  assertEqual(before.menuIndex, RESUME, "the highlight resting on RESUME");

  const rect = menuRectAt(h, RESUME, "the RESUME item");
  const after = await touchTapRectWithoutTick(h, rect);
  captureStill(h, "resumed");

  assertEqual(
    after.screen,
    "playing",
    "the screen the contact left the game on",
  );
  assertDeepEqual(
    runFields(after.run),
    runFields(before.run),
    "the resumed run, against the run the pause held",
  );
});
