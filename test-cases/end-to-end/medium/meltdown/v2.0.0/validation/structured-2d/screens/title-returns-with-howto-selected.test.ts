// Meltdown — screens/title-returns-with-howto-selected — leaving the how-to screen puts
// the title's highlight back on HOW TO PLAY.
//
// THE RULE. `specs/screens.md`, "What is highlighted on arrival": arriving at
// `title` from `howto` highlights `HOW TO PLAY`, row `1`. It is the one arrival in
// that table whose row is not `0`, and the reason the table gives is that
// "returning to a screen highlights the row that led away from it, so a player who
// steps into a screen and comes back finds the highlight where they left it".
//
// THE ROUND TRIP IS DRIVEN, NOT POSED, because an arrival highlight is an ENTRY
// EFFECT and `setScreen` runs none (`specs/instrumentation.md`): a posed title
// screen carries whatever highlight the pose left, so a build that never moves its
// highlight would pass such a check outright. The title is opened on row `1`, that
// row is confirmed into `howto`, and the way back is `back`.
//
// THE HIGHLIGHT IS READ ON THE TITLE, AFTER THE RETURN. A build that returns to
// row `0` is the ordinary defect this catches: it drops a player who was reading
// the how-to page back onto `PLAY`, one press away from a run they did not ask
// for.
//
// WHY THE WAY BACK IS `back` AND NOT THE `BACK` ROW. Both leave `howto` for
// `title`, and which row the page's own row leads to is
// `screens.howto-back-row`'s. This item is about the highlight the ARRIVAL sets,
// so it takes the shorter of the two routes.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { TITLE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  resetTo,
  tapAction,
  type Harness,
} from "../harness";

/** The row that leads to the how-to screen, and the row the return must set. */
const HOWTO_ROW = TITLE_ITEMS.indexOf("HOW TO PLAY");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("returns to the title with HOW TO PLAY highlighted", async () => {
  resetTo(h);
  h.debug.setScreen("title");
  h.debug.setMenuIndex(HOWTO_ROW);
  await h.advance(1);

  const opened = h.snapshot();
  assertEqual(opened.screen, "title", "the screen the trip starts on");
  assertEqual(opened.menuIndex, HOWTO_ROW, "the row the trip leads away from");

  await tapAction(h, "confirm");
  const inside = h.snapshot();
  assertEqual(
    inside.screen,
    "howto",
    "precondition: HOW TO PLAY opens the how-to screen (specs/screens.md)",
  );

  await tapAction(h, "back");
  captureStill(h, "returned");

  const back = h.snapshot();
  assertEqual(
    back.screen,
    "title",
    "precondition: back leaves the how-to screen for the title",
  );
  assertEqual(
    back.menuIndex,
    HOWTO_ROW,
    "the row the title is highlighted on after a trip into the how-to " +
      "screen, which specs/screens.md fixes at HOW TO PLAY",
  );
});
