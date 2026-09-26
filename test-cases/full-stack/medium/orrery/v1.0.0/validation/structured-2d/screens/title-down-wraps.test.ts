// screens/title-down-wraps — `down` on the last title item wraps round to the
// first.
//
// THE RULE, `specs/ui.md`, Screens, `title`: "`up` and `down` move the highlight
// by one item and wrap at both ends." This point decides the bottom end: from the
// last entry of `TITLE_ITEMS`, a `down` press does not stop and does not run off
// the end — it comes back to `0`.
//
// THE CONFIGURATION is the title with the highlight posed onto the LAST entry of
// `TITLE_ITEMS`, and ONE press of `down`. `setMenuIndex` "Sets the highlighted
// item of the menu the current screen shows" (`specs/instrumentation.md`), which
// reaches the bottom of the menu without leaning on the `down` action this point
// is about.
//
// THE VERDICT. `menuIndex` is `0` and the game is still on the title. A build
// that clamped at the bottom leaves the highlight on the last entry; one that ran
// past the end leaves it at the entry count or beyond; both are caught by the
// value.

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

/** The last entry of the title menu, where the press starts. */
const LAST = TITLE_ITEMS.length - 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("wraps the highlight from the last item back to the first", async () => {
  assertGreaterThan(
    TITLE_ITEMS.length,
    1,
    "TITLE_ITEMS carries more than one entry, so the wrap moves the highlight",
  );

  await openTitle(h);
  await h.debug.setMenuIndex(LAST);
  await h.advance(1);

  const before = await h.snapshot();
  assertEqual(
    before.screen,
    "title",
    "the press this point reads is delivered on the title screen",
  );
  assertEqual(
    before.menuIndex,
    LAST,
    `the highlight stands on the last entry of TITLE_ITEMS (${TITLE_ITEMS[LAST]}) ` +
      "before the press",
  );

  const after = await pressAction(h, "down");
  await captureStill(h, "wrapped");

  assertEqual(
    after.screen,
    "title",
    "a down press at the bottom wraps rather than leaving the screen",
  );
  assertEqual(
    after.menuIndex,
    0,
    `the menu wraps at both ends, so down on ${TITLE_ITEMS[LAST]} highlights ` +
      `${TITLE_ITEMS[0]}`,
  );
});
