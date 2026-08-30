// input/back-previous-screen — `back` returns to the previous screen elsewhere.
//
// THE REQUIREMENT. `specs/controls.md` closes `back`'s ordered list with the
// catch-all: "on any other screen the game returns to the previous screen."
// `specs/ui.md` says which screen that is for each of the three that have one: the
// map select's `BACK` "returns to `title`", the difficulty select's "returns to
// `mapselect`", and the how-to screen's "returns to `title`" — and adds that
// "every menu that this file gives a `BACK` entry can also be left with the back
// action", which is what makes the key equivalent to the entry.
//
// HOW IT IS DECIDED. Each of the three screens is reached directly, through the
// operation that moves to a screen "exactly as reaching it in play does", so a
// build with a broken title menu still has this point decided on its own terms.
// `back` is pressed once on each as a player presses it, a real browser key event
// through the build's own keyboard layer, and where the game landed is read. Each
// of the three is asserted separately, so a failure names the route that is
// missing rather than reporting that "back is broken".

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { keyFor, type Screen } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";

/** Each screen `specs/ui.md` gives a previous screen, and the screen it is. */
const ROUTES: { from: Screen; to: Screen }[] = [
  { from: "difficultyselect", to: "mapselect" },
  { from: "mapselect", to: "title" },
  { from: "howto", to: "title" },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it.each(ROUTES)("returns from $from to $to", async ({ from, to }) => {
  await h.debug.reset();
  await h.debug.setScreen(from);
  assertEqual(
    (await h.snapshot()).screen,
    from,
    `the ${from} screen showing before back is pressed (specs/ui.md)`,
  );

  await h.tap(keyFor("back"));
  await captureStill(h, "back");

  assertEqual(
    (await h.snapshot()).screen,
    to,
    `pressing ${keyFor("back")} on ${from} to return to the previous screen ` +
      "(specs/controls.md, specs/ui.md)",
  );
});
