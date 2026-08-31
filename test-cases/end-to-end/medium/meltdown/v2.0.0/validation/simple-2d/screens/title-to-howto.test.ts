// screens/title-to-howto — confirming the second title row opens the how-to
// screen.
//
// THE RULE. specs/screens.md's `title` table: the `HOW TO PLAY` row leads to
// `howto`. specs/controls.md binds `confirm` to `Enter`, "Takes the highlighted
// row."
//
// ONE ROW, ONE DIRECTION. What the OTHER title row does is
// `screens.title-to-mode-select`'s requirement, and what the how-to screen then
// draws is `screens.howto-content`'s. This item decides where the second row
// leads and nothing else, so the highlight is posed on it outright and one press
// is made.
//
// THE ROW IS POSED RATHER THAN MOVED TO. Whether `down` moves the highlight is
// `controls.menu-down`'s requirement; a build with a broken `down` key must fail
// that item alone rather than every item that needs the second row.

import { afterEach, beforeEach, it } from "vitest";
import { BINDINGS, TITLE_ITEMS } from "../../src/constants";
import { assertEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { poseMenu } from "./menu";

/** The key specs/controls.md binds `confirm` to. */
const CONFIRM = BINDINGS.confirm[0];

/** The row `HOW TO PLAY` sits on, second of the two `TITLE_ITEMS`. */
const HOWTO_ROW = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("opens the how-to screen when HOW TO PLAY is confirmed", async () => {
  assertEqual(
    TITLE_ITEMS[HOWTO_ROW],
    "HOW TO PLAY",
    "posing: the row this item is about (specs/screens.md, TITLE_ITEMS)",
  );
  poseMenu(h, "title", HOWTO_ROW);
  await h.advance(1);
  assertEqual(
    h.snapshot().screen,
    "title",
    "posing: the screen the press is made on (specs/screens.md)",
  );

  await h.tap(CONFIRM);
  captureStill(h, "howto");

  assertEqual(
    h.snapshot().screen,
    "howto",
    `${CONFIRM} on the HOW TO PLAY row: the screen it leads to ` +
      `(specs/screens.md)`,
  );
});
