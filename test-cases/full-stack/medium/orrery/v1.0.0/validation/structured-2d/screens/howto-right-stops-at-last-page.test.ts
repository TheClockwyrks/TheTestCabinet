// screens/howto-right-stops-at-last-page — the how-to's pages STOP at the last
// one rather than wrapping round to the first.
//
// THE RULE. "`left` and `right` move it by one, STOPPING at `0` and
// `HOWTO_PAGES - 1`" (`specs/ui.md`, `howto`), where `HOWTO_PAGES` is `5`, so the
// last page is page `4`. The how-to's pages are the one run of items in this game
// that does not wrap — the title menu and both select lists wrap "at both ends" —
// so a `right` press on the last page is a press that does nothing.
//
// THE POSE. The how-to, turned to `HOWTO_PAGES - 1` with `setHowtoPage`, which
// `specs/instrumentation.md` bounds at exactly that page ("Sets the how-to's
// current page, `0` to `HOWTO_PAGES - 1` (`4`)"). The pose costs no press, so the
// only press in the suite is the one under test.
//
// THE VERDICT. `howtoPage` is still `HOWTO_PAGES - 1` after the press, and it is
// read against `0` as well, so a build that wrapped is reported as wrapping. The
// screen is still the how-to.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotEqual } from "../assert";
import { HOWTO_PAGES } from "../constants";
import {
  captureStill,
  createHarness,
  openHowto,
  openTitle,
  pressAction,
  type Harness,
} from "../harness";

/** The last page the how-to holds. */
const LAST_PAGE = HOWTO_PAGES - 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves howtoPage at the last page when right is pressed on it", async () => {
  await openTitle(h);
  await openHowto(h);
  await h.debug.setHowtoPage(LAST_PAGE);

  const posed = await h.snapshot();
  assertEqual(
    posed.screen,
    "howto",
    "the press under test is made on the how-to",
  );
  assertEqual(
    posed.howtoPage,
    LAST_PAGE,
    "the how-to stands on HOWTO_PAGES - 1, the last page, which is where right " +
      "stops",
  );

  const after = await pressAction(h, "right");
  await captureStill(h, "held");

  assertEqual(
    after.screen,
    "howto",
    "a right press that turns no page does not leave the screen either",
  );
  assertNotEqual(
    after.howtoPage,
    0,
    "the pages stop at HOWTO_PAGES - 1 rather than wrapping round to page 0",
  );
  assertEqual(
    after.howtoPage,
    LAST_PAGE,
    "right on the last page leaves the page where it stands",
  );
});
