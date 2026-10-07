// screens/title-howto — HOW TO PLAY leads to the how-to screen.
//
// THE REQUIREMENT. `specs/ui.md`, of the title's two entries: "`SALVAGE` leads to
// `mapselect` and `HOW TO PLAY` leads to `howto`." The how-to screen is where a
// player who has never seen the game reads what it is and which keys do what, so
// an entry that leads nowhere leaves the rules unreachable.
//
// HOW IT IS DECIDED. The game is reset to the title and the HOW TO PLAY entry is
// highlighted and taken. Which index that entry sits at is read off the build's
// own `menuButtons`, in the order it presents its choices, so nothing here
// assumes an ordering; the entry is then confirmed with a real browser key event
// through the build's own keyboard layer, and the screen is read.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThanOrEqual } from "../assert";
import { keyFor } from "../constants";
import {
  captureStill,
  createHarness,
  openMenu,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("moves to the how-to screen when HOW TO PLAY is taken", async () => {
  await h.debug.reset();
  const entries = await openMenu(h, "title");
  const index = entries.findIndex((entry) => entry.action === "howto");
  assertGreaterThanOrEqual(
    index,
    0,
    "the title to present a HOW TO PLAY choice (specs/ui.md, " +
      "specs/instrumentation.md)",
  );

  await h.debug.setMenuIndex(index);
  await h.tap(keyFor("confirm"));
  await captureStill(h, "howto");

  assertEqual(
    (await h.snapshot()).screen,
    "howto",
    "the screen HOW TO PLAY leads to from the title (specs/ui.md)",
  );
});
