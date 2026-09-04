// screens/victory-menu — the victory screen's MENU returns to the title.
//
// THE REQUIREMENT. `specs/ui.md`, of `victory`: "It offers `PLAY AGAIN`, which
// replays the run on the same map at the same difficulty, and `MENU`, which returns
// to `title`." The two choices go to different places, so they are two points: a
// build whose MENU restarted the run instead would pass `victory-play-again` and
// strand a player who wanted out.
//
// HOW IT IS DECIDED. The victory screen is reached directly, through the operation
// that reaches a screen "exactly as reaching it in play does", because what is being
// decided is where a choice leads rather than how the screen was arrived at. `MENU`
// is found by the action it carries rather than by where it was drawn, and taken at
// the centre of the rectangle the build itself reported for it. The screen is read
// back.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  type Harness,
  openMenu,
  pressMenu,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("returns to the title when MENU is taken from the victory screen", async () => {
  await h.debug.reset();
  await openMenu(h, "victory");

  await pressMenu(h, "menu");
  await captureStill(h, "title");

  assertEqual(
    (await h.snapshot()).screen,
    "title",
    "the screen the victory screen's MENU choice returns to (specs/ui.md)",
  );
});
