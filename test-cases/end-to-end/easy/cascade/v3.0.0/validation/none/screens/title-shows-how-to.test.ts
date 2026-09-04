// screens/title-shows-how-to — the title screen draws its `HOW TO PLAY` item.
//
// THE RULE. `specs/screens.md`, the `title` screen's element table: Items,
// `TITLE_ITEMS`, "`NEW GAME`, `HOW TO PLAY`, in that order". This point decides
// that the literal `HOW TO PLAY` is drawn on that screen.
//
// ONE LITERAL PER POINT, because the two fail differently and a build can miss
// either alone: a title showing only `NEW GAME` and a title showing only
// `HOW TO PLAY` are different screens to a player, and a single item covering
// both would score them the same. `screens/title-shows-new-game` is the
// other.
//
// HOW THE LABEL IS MATCHED. Case-insensitively, and as part of a run rather than
// as the whole of it: the copy is the case's, fixed in `specs/screens.md`, but how
// a build presents it is the build's, and a menu entry is commonly drawn with a
// selection marker or padding around it. Requiring the exact run would fail a
// screen that shows precisely the right words.
//
// WHAT THIS DOES NOT DECIDE. Where the label landed, which is
// `presentation/*`'s; whether it can be READ against what it sits on, which is
// `presentation/text-legible`'s; and what the item DOES, which is
// `screens/title-how-to-opens`'s.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { TITLE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  drewText,
  openTitle,
  type Harness,
} from "../harness";

/** The literal this point is about, as `specs/screens.md` fixes it. */
const LABEL = TITLE_ITEMS[1];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws its HOW TO PLAY item", async () => {
  await openTitle(h);

  const calls = await h.frameCalls();
  // Before the assertion, so a title missing the item still leaves the picture
  // of the screen it drew.
  await captureStill(h, "title");

  assertEqual(
    drewText(calls, LABEL),
    true,
    `the title screen draws the item "${LABEL}" (specs/screens.md)`,
  );
});
