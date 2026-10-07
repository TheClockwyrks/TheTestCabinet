// instrumentation/set-menu-index-outside-the-entry-count-is-invalid — a highlight
// beyond the menu's entries fails loudly rather than being clamped or ignored.
//
// `specs/instrumentation.md` § The operations, the first of the three rules over
// every operation: "An argument outside the domain its operation states is
// invalid, and the call fails loudly rather than guessing what was meant." The
// domain is stated in the table: "`setMenuIndex(index)` | Sets the highlighted
// entry of the menu on the screen showing, counted from `0`; the domain is the
// entry count of the menu that screen shows (`specs/ui.md`)."
//
// THE SCENARIO IS THE SMALLEST MENU IN THE GAME. `specs/ui.md` gives the title
// screen the two entries of `TITLE_ITEMS` (`SITES`, `HOW TO PLAY`), so its domain
// is `0` and `1` alone, and `2` is the first index past the end. `2` and `-1` are
// the same edge case — an index outside the entry count — reached from either
// side, so they share this validator; each is a call that must fail.
//
// The highlight is left where a reset leaves it, `0` (`specs/ui.md`: "with
// `menuIndex` `0` on arriving"), and read back after both calls: a build that
// clamped `2` to the last entry rather than failing would be caught by the
// reading as well as by the missing failure.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import { TITLE_ITEMS } from "../constants";
import { createHarness, type Harness } from "../harness";

/** The first index past the title menu's two entries (specs/ui.md). */
const PAST_THE_END = TITLE_ITEMS.length;

/** The first index below it. */
const BELOW_THE_START = -1;

/** Whether a call raised, without letting the failure escape the check. */
async function raises(call: () => Promise<void>): Promise<boolean> {
  try {
    await call();
    return false;
  } catch {
    return true;
  }
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("fails an index at or beyond the menu's entry count, and one below zero", async () => {
  const before = (await h.snapshot()).menuIndex;

  const past = await raises(() => h.debug.setMenuIndex(PAST_THE_END));
  const below = await raises(() => h.debug.setMenuIndex(BELOW_THE_START));
  const after = (await h.snapshot()).menuIndex;

  await h.advance(1);
  await h.capture("state", "The driven state this point decides");

  assertEqual(
    before,
    0,
    "the highlight the title screen stands on, which the two calls must leave",
  );
  assertTrue(
    past,
    `setMenuIndex(${PAST_THE_END}) on the title screen, whose menu carries ` +
      `${TITLE_ITEMS.length} entries, to fail loudly ` +
      "(specs/instrumentation.md)",
  );
  assertTrue(
    below,
    `setMenuIndex(${BELOW_THE_START}) to fail loudly, the same domain reached ` +
      "from below (specs/instrumentation.md)",
  );
  assertEqual(
    after,
    before,
    "menuIndex after two invalid calls, which change nothing rather than " +
      "clamping (specs/instrumentation.md)",
  );
});
