// screens/howto-page-zero-on-arrival — arriving at the how-to shows its FIRST
// page, whatever page the last visit left it turned to.
//
// THE RULE. "`state.howtoPage` names the page shown, `0` on arriving"
// (`specs/ui.md`, `howto`). The title menu says the same of the item that goes
// there — "`HOW TO PLAY` — Goes to `howto`, page `0`" — and
// `specs/instrumentation.md` says it of the operation that enters the screen:
// `setScreen(name)` "Enters the screen `name` ... exactly as the real transition
// into it enters it", and its table's `howto` row reads "Shows the how-to,
// `howtoPage` at `0`". So the page a visit ends on is not the page the next visit
// begins on: arriving sets it.
//
// THE POSE. A fresh session, the how-to entered once and turned to the LAST page
// `HOWTO_PAGES - 1` (`4`) — the page furthest from the one arriving must show, so
// a build that simply kept whatever it held is at the opposite end of the run of
// pages from the verdict. The page is turned with `setHowtoPage`, the faculty
// gate `specs/instrumentation.md` names for it ("Sets the how-to's current page,
// `0` to `HOWTO_PAGES - 1`"), rather than with four `right` presses, because the
// keys that turn the page are their own items and this one is about arriving.
// The screen is then left for the title and entered again, both through
// `setScreen`, which is the real transition by specification.
//
// THE VERDICT. The second arrival reports `screen` `howto` and `howtoPage` `0`,
// and the page it had been turned to is read back before the screen is left so
// that "however far the pages had been turned" is a reading rather than an
// assumption.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { HOWTO_PAGES } from "../constants";
import {
  captureStill,
  createHarness,
  openHowto,
  openTitle,
  type Harness,
} from "../harness";

/** The page furthest from the one an arrival must show. */
const LAST_PAGE = HOWTO_PAGES - 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("shows page 0 on arriving, after a visit that left the how-to on its last page", async () => {
  await openTitle(h);
  await openHowto(h);
  await h.debug.setHowtoPage(LAST_PAGE);

  const turned = await h.snapshot();
  assertEqual(
    turned.screen,
    "howto",
    "the first visit is on the how-to, which is the screen whose page is turned",
  );
  assertEqual(
    turned.howtoPage,
    LAST_PAGE,
    "the first visit is left turned to the last page, so the second arrival has " +
      "something to reset",
  );

  await h.debug.setScreen("title");
  await openHowto(h);
  await captureStill(h, "first-page");

  const arrived = await h.snapshot();
  assertEqual(arrived.screen, "howto", "entering howto shows the how-to");
  assertEqual(
    arrived.howtoPage,
    0,
    "howtoPage is 0 on arriving, however far the pages had been turned before " +
      "the screen was left",
  );
});
