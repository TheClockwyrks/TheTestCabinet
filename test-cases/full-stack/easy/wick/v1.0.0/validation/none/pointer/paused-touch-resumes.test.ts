// pointer/paused-touch-resumes — a contact landing and lifting in `RESUME`'s
// rectangle returns to the run.
//
// WHERE THE THRESHOLD COMES FROM. specs/controls.md ("The pointer and touch"),
// rule 3: "a contact landing and lifting inside the rectangle of the item at
// `menuIndex` `i` selects that item and takes it exactly as `confirm` on it
// does." specs/ui.md ("`paused`"): `RESUME` "Returns to the run: `screen =
// playing`, the run exactly as the pause left it."
//
// WHY THIS IS A POINT OF ITS OWN. A pause a player cannot leave is a run they
// cannot finish, so the pause menu is the second place after the chest overlay
// where a missing touch route costs the whole night. The mouse's route is
// `pointer/paused-click-resumes`'.
//
// HOW THE SCENARIO IS DRIVEN. An isolated night held under the pause screen
// through `setScreen("paused")`, which enters it "exactly as `pause` does", then
// a REAL contact landing at the middle of the rectangle the build reported for
// `RESUME`, the first of `PAUSE_ITEMS`, and lifting there.
//
// THE TOLERANCE. None: a screen name and the run clock are exact comparisons.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { PAUSE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  touchTapAt,
  type Harness,
} from "../harness";
import { menuPoints, night, posePaused } from "./stage";

/** The item the contact takes: `RESUME`, the first of `PAUSE_ITEMS`. */
const RESUME = PAUSE_ITEMS.indexOf("RESUME");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("returns to playing when a contact takes RESUME", async () => {
  await night(h);
  const held = await posePaused(h);

  const points = await menuPoints(h, PAUSE_ITEMS.length, "for the pause menu");
  const resumed = await touchTapAt(h, points[RESUME]!);
  await captureStill(h, "resumed");

  assertEqual(resumed.screen, "playing", "the screen the contact left");
  assertEqual(
    resumed.run.kills,
    held.run.kills,
    "the kills the resumed run carries, as the pause left them",
  );
});
