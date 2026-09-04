// Facet — targets/back-target-leaves-howto: taking the BACK control leaves the
// how-to screen.
//
// specs/controls.md gives `howto` one target, `back`, and says what taking it
// does: "`back` — The same as the `back` action on that screen." specs/ui.md
// fixes where that lands: "`back` returns to `title` with the `HOW TO PLAY` item
// of `TITLE_ITEMS` highlighted, so a player who came in to read the rules is put
// back where they were rather than at the top of the menu." That file also puts
// the control on the screen for exactly this reason: "The screen carries the
// `back` pointer target `specs/controls.md` names, drawn as a control reading
// `BACK_LABEL` (`BACK`), so a player with only a pointer can leave it."
//
// THE HOW-TO SCREEN CARRIES NO MENU, so this control and the `back` key are the
// only two ways off it. `keyboard/back-key` reads the key; this point reads the
// control, and a build that wired one and not the other strands half its players.
//
// THE LANDING IS READ HERE TOO, and it is the same landing
// `screens/back-leaves-howto` reads from the key — because taking a target "does
// exactly what the same choice does from the keyboard", so a build whose control
// went somewhere else has not wired the control to the action at all. The
// highlighted item is `TITLE_ITEMS.indexOf("HOW TO PLAY")` rather than the figure
// `1` written down, so the reading follows the item list specs/ui.md fixes rather
// than a number this check remembered.
//
// The screen is reached through `openHowTo()`, which specs/instrumentation.md
// defines as the choice of `HOW TO PLAY` "exactly as choosing that item does", so
// nothing here depends on how a player got there.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThanOrEqual } from "../assert";
import { TITLE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  takeTarget,
  targetById,
  type Harness,
} from "../harness";

/** Where `HOW TO PLAY` sits in the title menu, which is where `back` puts the highlight. */
const HOWTO_INDEX = TITLE_ITEMS.indexOf("HOW TO PLAY");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("returns to the title with HOW TO PLAY highlighted", async () => {
  // The fixture is what it claims: the item the landing is stated against is in
  // the list specs/ui.md fixes.
  assertGreaterThanOrEqual(
    HOWTO_INDEX,
    0,
    `the index of "HOW TO PLAY" in TITLE_ITEMS`,
  );

  await h.debug.reset();
  await h.debug.openHowTo();
  const opened = await h.snapshot();
  assertEqual(opened.screen, "howto", "the screen the control is taken on");

  const back = targetById(opened, "back");
  const left = await takeTarget(h, back);

  // The frame the title is drawn on, and the picture of it.
  await h.advance(1);
  await captureStill(h, "title");

  assertEqual(
    left.screen,
    "title",
    "the screen taking the back control reached",
  );
  assertEqual(
    left.menuIndex,
    HOWTO_INDEX,
    "the highlighted item on returning, which is where the player came from",
  );
  assertEqual(
    left.armedTarget,
    null,
    "the armed target the release disarmed as it took the control",
  );
});
