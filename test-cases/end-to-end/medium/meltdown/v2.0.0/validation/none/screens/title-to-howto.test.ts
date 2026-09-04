// Meltdown — screens/title-to-howto: HOW TO PLAY opens the how-to screen.
//
// THE RULE. `specs/screens.md`, on the `title` screen's two rows: `HOW TO PLAY`
// leads to `howto`. It is the second of `TITLE_ITEMS`, and "`confirm` takes the
// highlighted row".
//
// THE SECOND ROW, WHICH IS THE WHOLE POINT. `screens.title-to-mode-select` reads
// where the FIRST row leads; this one reads the second, so a build that wired one
// row and not the other grades differently from a build that wired neither. Both
// rows lead somewhere, and to different places, so a build that sent both to
// `modeselect` fails here and passes there.
//
// THE ROW IS POSED, NOT WALKED. `setMenuIndex` sets the highlighted row outright
// (`specs/instrumentation.md`), so a build whose arrow keys are broken still gets a
// fair reading of where its second row leads — those keys are `controls.menu-down`
// and `controls.menu-up`.
//
// WHAT THE HOW-TO SCREEN DRAWS once it is open is `screens.howto-content`'s
// reading, and the way back off it is `screens.back-from-howto`'s. This item is
// about the door alone.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { TITLE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  tapAction,
  type Harness,
} from "../harness";

/** The row confirmed: `HOW TO PLAY`, the second of the two `TITLE_ITEMS`. */
const HOWTO_ROW = TITLE_ITEMS.length - 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("opens the how-to screen when the title menu's second row is confirmed", async () => {
  const { debug } = h;
  await debug.reset();
  await debug.setScreen("title");
  await debug.setMenuIndex(HOWTO_ROW);
  await h.advance(1);

  const posed = await h.snapshot();
  assertEqual(posed.screen, "title", "the screen the scenario is posed on");
  assertEqual(posed.menuIndex, HOWTO_ROW, "the row the scenario is posed on");

  await tapAction(h, "confirm");
  await h.advance(1);
  await captureStill(h, "howto");

  const after = await h.snapshot();
  assertEqual(
    after.screen,
    "howto",
    `the screen confirming ${TITLE_ITEMS[HOWTO_ROW]}, row ${HOWTO_ROW} of the title menu, leads to`,
  );
});
