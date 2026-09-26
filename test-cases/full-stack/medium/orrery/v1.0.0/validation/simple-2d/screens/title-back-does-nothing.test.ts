// screens/title-back-does-nothing — `back` on the title leaves everything where
// it stood.
//
// THE RULE is two sentences that say the same thing from either side.
// `specs/ui.md`, Screens, `title`: "`back` does nothing." And `specs/controls.md`,
// What each screen reads, whose title row is "`up` and `down` move the highlight;
// `confirm` takes it; `mute`" — `back` is not on it, and "An action a row omits
// does nothing on that screen." The title is the top of the game: there is no
// screen behind it to go back to.
//
// THE CONFIGURATION is the title with the highlight posed OFF its arrival value,
// onto the second entry of `TITLE_ITEMS`, and ONE press of `back`. The pose is
// what makes the point decidable: with the highlight left at `0`, a build that
// answered `back` by re-entering the title — which "`menuIndex` is `0` on
// arriving at the title" would put back at `0` — would be indistinguishable from
// one that did nothing at all.
//
// THE VERDICT. The screen is still `title` and `menuIndex` is still `1`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { TITLE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  openTitle,
  pressAction,
  type Harness,
} from "../harness";

/** Where the highlight is left standing: anywhere but the arrival value. */
const HELD = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves the title screen and its highlight untouched", async () => {
  assertGreaterThan(
    TITLE_ITEMS.length,
    HELD,
    "TITLE_ITEMS carries an entry the highlight can be held on, away from 0",
  );

  await openTitle(h);
  await h.debug.setMenuIndex(HELD);
  await h.advance(1);

  const before = await h.snapshot();
  assertEqual(
    before.screen,
    "title",
    "the press this point reads is delivered on the title screen",
  );
  assertEqual(
    before.menuIndex,
    HELD,
    `the highlight is held on ${TITLE_ITEMS[HELD]}, away from the value an ` +
      "arrival at the title would set",
  );

  const after = await pressAction(h, "back");
  await captureStill(h, "unchanged");

  assertEqual(
    after.screen,
    "title",
    "back does nothing on the title, so it does not leave the screen",
  );
  assertEqual(
    after.menuIndex,
    HELD,
    "back does nothing on the title, so it leaves the highlight where it stood",
  );
});
