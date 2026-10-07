// screens/howto-left-stops-at-first-page — the how-to's pages STOP at the first
// one rather than wrapping round to the last.
//
// THE RULE. "`left` and `right` move it by one, STOPPING at `0` and
// `HOWTO_PAGES - 1`" (`specs/ui.md`, `howto`). The how-to's pages are the one
// place in this game where a run of items does not wrap: the title menu's
// highlight "wrap[s] at both ends" and a select list's "wrap[s] at both ends" as
// well, and the how-to is written the other way on purpose. So a `left` press on
// page `0` is a press that does nothing.
//
// THE POSE. A fresh session and the how-to as arriving at it leaves it, page `0`
// — the page the stop is stated at. The pose costs no press, so the only press in
// the suite is the one under test.
//
// THE VERDICT. `howtoPage` is still `0` after the press. It is read against `0`
// AND against the last page, `HOWTO_PAGES - 1` (`4`), so a build that wrapped is
// reported as wrapping rather than merely as being on the wrong page, and the
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

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves howtoPage at 0 when left is pressed on the first page", async () => {
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
    "the how-to stands on page 0, the first page, which is where left stops",
  );

  const after = await pressAction(h, "left");
  await captureStill(h, "held");

  assertEqual(
    after.screen,
    "howto",
    "a left press that turns no page does not leave the screen either",
  );
  assertNotEqual(
    after.howtoPage,
    HOWTO_PAGES - 1,
    "the pages stop at 0 rather than wrapping round to the last page",
  );
  assertEqual(
    after.howtoPage,
    0,
    "left on page 0 leaves the page where it stands",
  );
});
