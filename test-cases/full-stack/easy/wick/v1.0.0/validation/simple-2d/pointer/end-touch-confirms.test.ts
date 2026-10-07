// pointer/end-touch-confirms — a contact landing and lifting in `TRY AGAIN`'s
// rectangle starts a fresh run.
//
// WHAT THIS DECIDES. One thing: a touch contact takes `TRY AGAIN` on the fallen
// screen, so a player on a touch device can play again.
//
// THE SPEC IT RESTS ON.
//   specs/controls.md (The pointer and touch), rule 3: "a contact landing and
//   lifting inside the rectangle of the item at `menuIndex` `i` selects that
//   item and takes it exactly as `confirm` on it does."
//   specs/ui.md (`fallen`, `dawn`): `TRY AGAIN` "Starts a fresh run and sets
//   `screen = playing`", over `END_ITEMS`, whose first item it is.
//   specs/ui.md ("A fresh run") fixes what that run holds, restated as
//   `FRESH_RUN`.
//
// WHY IT IS A POINT OF ITS OWN. An end screen is where a player decides whether
// to play again, so a build that answers no contact there is one a touch player
// plays exactly once. The mouse's route is `pointer/end-click-confirms`'.
//
// THE DRIVE. An isolated night carrying a level, a clock, and kills, ended
// fallen the REAL way; then a contact landing at the middle of the rectangle
// reported for `TRY AGAIN` and lifting there, both frames half a tick, so the
// fresh run is read before any tick advanced it.
//
// THE TOLERANCE. None: a screen name and the fresh run's stored fields.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { END_ITEMS, FRESH_RUN } from "../constants";
import {
  captureStill,
  createHarness,
  endFallen,
  isolate,
  runFields,
  type Harness,
} from "../harness";
import { menuRectAt, touchTapRectWithoutTick } from "./pointing";

/** The item the contact takes: `TRY AGAIN`, position 0 of `END_ITEMS`. */
const TRY_AGAIN = END_ITEMS.indexOf("TRY AGAIN");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("starts a fresh run when TRY AGAIN is tapped on the fallen screen", async () => {
  isolate(h, { level: 11 });
  h.debug.setTick(6000);
  h.debug.setKills(52);
  await endFallen(h);
  const before = h.snapshot();
  assertEqual(before.screen, "fallen", "the screen the contact lands on");
  assertEqual(
    before.menuIndex,
    TRY_AGAIN,
    "the highlight resting on TRY AGAIN",
  );

  const rect = menuRectAt(h, TRY_AGAIN, "the TRY AGAIN item");
  const after = await touchTapRectWithoutTick(h, rect);
  captureStill(h, "again");

  assertEqual(
    after.screen,
    "playing",
    "the screen the contact left the game on",
  );
  assertDeepEqual(
    runFields(after.run),
    FRESH_RUN,
    "the run the contact started, as specs/ui.md's fresh run fixes it",
  );
});
