// screens/title-up-wraps — `up` on the first title item wraps round to the last.
//
// THE RULE, `specs/ui.md`, Screens, `title`: "`up` and `down` move the highlight
// by one item and wrap at both ends." This point decides the top end: from the
// first entry of `TITLE_ITEMS`, an `up` press does not stop and does not run off
// the front — it comes back to the last entry.
//
// THE CONFIGURATION is the title as the game opens on it, where "`menuIndex` is
// `0` on arriving at the title", and ONE press of `up`. Nothing is posed at all,
// because the top of the menu is where the title already stands.
//
// THE VERDICT. `menuIndex` is the index of the last entry of `TITLE_ITEMS` and
// the game is still on the title. A build that clamped at the top leaves the
// highlight on `0`; one that ran off the front leaves it negative; both are
// caught by the value.

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

/** The last entry of the title menu, which the wrap lands on. */
const LAST = TITLE_ITEMS.length - 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("wraps the highlight from the first item round to the last", async () => {
  assertGreaterThan(
    TITLE_ITEMS.length,
    1,
    "TITLE_ITEMS carries more than one entry, so the wrap moves the highlight",
  );

  await openTitle(h);
  const before = await h.snapshot();
  assertEqual(
    before.screen,
    "title",
    "the press this point reads is delivered on the title screen",
  );
  assertEqual(
    before.menuIndex,
    0,
    "the title opens with its first item highlighted, which is where the press starts",
  );

  const after = await pressAction(h, "up");
  await captureStill(h, "wrapped");

  assertEqual(
    after.screen,
    "title",
    "an up press at the top wraps rather than leaving the screen",
  );
  assertEqual(
    after.menuIndex,
    LAST,
    `the menu wraps at both ends, so up on ${TITLE_ITEMS[0]} highlights ` +
      `${TITLE_ITEMS[LAST]}`,
  );
});
