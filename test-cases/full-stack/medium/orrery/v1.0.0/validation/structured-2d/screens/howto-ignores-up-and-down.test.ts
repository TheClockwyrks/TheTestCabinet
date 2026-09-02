// screens/howto-ignores-up-and-down — `up` and `down` do nothing on the how-to.
//
// THE RULE. The how-to's row of `specs/controls.md`'s What each screen reads
// table is "`left` and `right` turn the page; `confirm` and `back` return to
// `title`; `mute`", and the sentence under the table settles what the row's
// silence means: "An action a row omits does nothing on that screen." `up` and
// `down` are omitted, and the navigation table's entries for them name the two
// places they DO act — "Menus and select lists: moves the highlight" and "Tape
// focus: moves the tape cursor" — neither of which is the how-to. So the pages
// are turned by `left` and `right` alone, and the vertical pair is inert here.
//
// THE POSE. The how-to, turned to page `2` with `setHowtoPage` — a page with
// pages on BOTH sides of it, so a build that mapped `up` or `down` onto the page
// turn moves off it whichever way it mapped them, where page `0` or the last page
// would hide half of that against their own stop.
//
// THE VERDICT. After each of the two presses, taken one at a time so the failure
// names the key that broke it, `howtoPage` is still the posed page and `screen`
// is still `howto`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
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

it("leaves the page and the screen alone under up and under down", async () => {
  await openTitle(h);
  await openHowto(h);
  await h.debug.setHowtoPage(POSED_PAGE);

  const posed = await h.snapshot();
  assertEqual(posed.screen, "howto", "the presses are made on the how-to");
  assertEqual(
    posed.howtoPage,
    POSED_PAGE,
    "the how-to stands on a page with a page on either side of it, so a turn " +
      "either way would show",
  );

  const afterUp = await pressAction(h, "up");
  const afterDown = await pressAction(h, "down");
  await captureStill(h, "unchanged");

  assertEqual(
    afterUp.screen,
    "howto",
    "up is omitted from the how-to's row, so it does not leave the screen",
  );
  assertEqual(
    afterUp.howtoPage,
    POSED_PAGE,
    "up is omitted from the how-to's row, so it turns no page",
  );
  assertEqual(
    afterDown.screen,
    "howto",
    "down is omitted from the how-to's row, so it does not leave the screen",
  );
  assertEqual(
    afterDown.howtoPage,
    POSED_PAGE,
    "down is omitted from the how-to's row, so it turns no page",
  );
});
