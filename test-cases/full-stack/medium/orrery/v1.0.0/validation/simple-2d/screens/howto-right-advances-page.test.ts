// screens/howto-right-advances-page — `right` turns the how-to forward one page.
//
// THE RULE. "`left` and `right` move it by one, stopping at `0` and
// `HOWTO_PAGES - 1`" (`specs/ui.md`, `howto`), and the how-to row of
// `specs/controls.md`'s What each screen reads table grants exactly that:
// "`left` and `right` turn the page". `right` is the forward one — the
// navigation table of `specs/controls.md` gives it as "How-to: next page" and
// gives `left` "How-to: previous page". This point decides the FORWARD step from
// the page an arrival shows; the stop at the last page is
// `howto-right-stops-at-last-page`'s, and the backward step is `left`'s own.
//
// THE POSE. A fresh session and the how-to as arriving at it leaves it, which is
// page `0` — so the press under test is the first turn a player ever makes, and
// there is a page after it to reach because `HOWTO_PAGES` is `5`. Nothing else is
// posed: away from the editor there is no machine, no run and no challenge for a
// press to disturb.
//
// THE PRESS IS A REAL ONE. `right` reaches the game through the key
// `specs/controls.md` binds it to, `ArrowRight`, and the frame that delivers it —
// the surface carries no operation for a registered action, so a menu is worked
// here exactly as a player works it.
//
// THE VERDICT. `howtoPage` is `1`, one page on from `0`, and the game is still on
// the how-to: turning a page is not leaving the screen.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { HOWTO_PAGES } from "../constants";
import {
  captureStill,
  createHarness,
  openHowto,
  openTitle,
  pressAction,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("moves howtoPage from 0 to 1 on one right press", async () => {
  assertGreaterThan(
    HOWTO_PAGES,
    1,
    "the how-to holds HOWTO_PAGES (5) pages, so there is a page after the first " +
      "for right to reach",
  );

  await openTitle(h);
  await openHowto(h);

  const arrived = await h.snapshot();
  assertEqual(
    arrived.screen,
    "howto",
    "the press under test is made on the how-to",
  );
  assertEqual(
    arrived.howtoPage,
    0,
    "the how-to stands on page 0, the page arriving at it shows",
  );

  const after = await pressAction(h, "right");
  await captureStill(h, "next-page");

  assertEqual(
    after.screen,
    "howto",
    "right turns the page rather than leaving the screen",
  );
  assertEqual(
    after.howtoPage,
    1,
    "right moves the page by one, so page 0 becomes page 1",
  );
});
