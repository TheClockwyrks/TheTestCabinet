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
// assumes an ordering; the entry is then confirmed with a real key event
// dispatched at the engine's own surface, which is the layer the game reads its
// `confirm` action through, and the screen is read.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  type Harness,
  openMenu,
} from "../harness";
import { keyFor } from "../constants";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("moves to the how-to screen when HOW TO PLAY is taken", async () => {
  h.debug.reset();
  const entries = openMenu(h, "title");
  const index = entries.findIndex((entry) => entry.action === "howto");
  assertGreaterThanOrEqual(
    index,
    0,
    "the title to present a HOW TO PLAY choice (specs/ui.md, " +
      "specs/instrumentation.md)",
  );

  h.debug.setMenuIndex(index);
  await h.tap(keyFor("confirm"));
  captureStill(h, "howto");

  assertEqual(
    h.snapshot().screen,
    "howto",
    "the screen HOW TO PLAY leads to from the title (specs/ui.md)",
  );
});
