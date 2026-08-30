// screens/difficultyselect-back — the difficulty select's BACK returns to the map
// select.
//
// THE REQUIREMENT. `specs/ui.md`, of `difficultyselect`: "A `BACK` choice returns
// to `mapselect`." It is what lets a player who has picked a map change their mind
// about it, and it is the one step back that does NOT go to the title, so a build
// that treats every BACK the same fails here while passing the map select's.
//
// HOW IT IS DECIDED. The difficulty select is opened directly, through the
// operation that reaches a screen "exactly as reaching it in play does", so a
// build with a broken map select still has this point decided on its own terms.
// The BACK choice is found by the action it carries rather than by where it was
// drawn, and pressed at the centre of the rectangle the build itself reported for
// it. The screen is read back.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  openMenu,
  pressMenu,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("returns to the map select when BACK is taken from the difficulty select", async () => {
  await h.debug.reset();
  await openMenu(h, "difficultyselect");

  await pressMenu(h, "back");
  await captureStill(h, "mapselect");

  assertEqual(
    (await h.snapshot()).screen,
    "mapselect",
    "the screen the difficulty select's BACK choice returns to " +
      "(specs/ui.md)",
  );
});
