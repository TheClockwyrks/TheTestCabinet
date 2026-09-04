// pointer/end-touch-confirms — a contact landing and lifting in `TRY AGAIN`'s
// rectangle starts a fresh run.
//
// WHERE THE THRESHOLD COMES FROM. specs/controls.md ("The pointer and touch"),
// rule 3: "a contact landing and lifting inside the rectangle of the item at
// `menuIndex` `i` selects that item and takes it exactly as `confirm` on it
// does." specs/ui.md ("`fallen`, `dawn`"): `TRY AGAIN` "Starts a fresh run and
// sets `screen = playing`", over the menu `END_ITEMS`, whose first item it is.
//
// WHY THIS IS A POINT OF ITS OWN. An end screen is where a player decides
// whether to play again, so a build that answers no contact there is a build a
// touch player plays exactly once. The mouse's route is
// `pointer/end-click-confirms`'.
//
// HOW THE SCENARIO IS DRIVEN. An isolated night ended fallen through `setHp(0)`
// and the tick that ends it, which is the REAL ending path; then a contact
// landing at the middle of the rectangle the build reported for `TRY AGAIN` and
// lifting there. The lifting frame is the frame that enters `playing`, and
// "a frame whose press enters `playing` ... runs that frame's ticks", so the
// fresh run is read one tick old.
//
// THE TOLERANCE. None: a screen name and the run's counters are exact
// comparisons.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { END_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  touchTapAt,
  type Harness,
} from "../harness";
import { endFallen, menuPoints, night } from "./stage";

/** The item the contact takes: `TRY AGAIN`, the first of `END_ITEMS`. */
const TRY_AGAIN = END_ITEMS.indexOf("TRY AGAIN");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("starts a fresh run when a contact takes TRY AGAIN on fallen", async () => {
  await night(h);
  await endFallen(h);

  const points = await menuPoints(h, END_ITEMS.length, "for the end menu");
  const again = await touchTapAt(h, points[TRY_AGAIN]!);
  await captureStill(h, "again");

  assertEqual(again.screen, "playing", "the screen the contact left");
  assertEqual(again.run.kills, 0, "the kills the fresh run starts with");
  assertEqual(again.run.level, 1, "the level the fresh run starts at");
});
