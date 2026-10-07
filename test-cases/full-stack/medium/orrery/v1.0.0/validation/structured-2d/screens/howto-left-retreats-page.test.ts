// screens/howto-left-retreats-page — `left` turns the how-to back one page.
//
// THE RULE. "`left` and `right` move it by one, stopping at `0` and
// `HOWTO_PAGES - 1`" (`specs/ui.md`, `howto`). `left` is the backward one: the
// navigation table of `specs/controls.md` gives it as "How-to: previous page",
// and the how-to row of What each screen reads grants it — "`left` and `right`
// turn the page". This point decides the BACKWARD step from a page with pages on
// both sides of it; the stop at page `0` is `howto-left-stops-at-first-page`'s.
//
// THE POSE. The how-to, turned to page `2` with `setHowtoPage` — the faculty gate
// `specs/instrumentation.md` names for the page, so the pose costs no press and
// the only press in the suite is the one under test. Page `2` has pages on either
// side of it, so a build that moved the page the wrong way lands on `3` and is
// reported rather than colliding with a stop.
//
// THE VERDICT. `howtoPage` is `1`, one page back from `2`, and the game is still
// on the how-to.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { HOWTO_PAGES } from "../constants";
import {
  captureStill,
  createHarness,
  openHowto,
  openTitle,
  pressAction,
  type Harness,
} from "../harness";

/** A page with a page on either side of it, so a turn either way is visible. */
const POSED_PAGE = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("moves howtoPage from 2 to 1 on one left press", async () => {
  await openTitle(h);
  await openHowto(h);
  await h.debug.setHowtoPage(POSED_PAGE);

  const posed = await h.snapshot();
  assertEqual(
    posed.screen,
    "howto",
    "the press under test is made on the how-to",
  );
  assertEqual(
    posed.howtoPage,
    POSED_PAGE,
    `the how-to stands on page ${POSED_PAGE}, which is neither of the two pages ` +
      `left and right stop at, 0 and ${HOWTO_PAGES - 1}`,
  );

  const after = await pressAction(h, "left");
  await captureStill(h, "previous-page");

  assertEqual(
    after.screen,
    "howto",
    "left turns the page rather than leaving the screen",
  );
  assertEqual(
    after.howtoPage,
    POSED_PAGE - 1,
    "left moves the page by one, so page 2 becomes page 1",
  );
});
