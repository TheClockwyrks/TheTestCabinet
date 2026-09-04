// screens/confirm-extras-sets-mode — taking EXTRAS puts the game in extras mode.
//
// THE RULE, from the table `specs/ui.md` gives the title's `confirm` under
// Screens, `title`:
//
//   | Item | Does |
//   | `EXTRAS` | Sets `state.mode` to `extras` and goes to `select`. |
//
// The half decided here is the MODE, which is what the two screens downstream
// serve: "`state.mode` is `campaign` or `extras`, and decides which course the
// `select` and `editor` screens serve." Where the confirm goes is
// `confirm-extras-opens-select`'s point.
//
// THE CONFIGURATION is the title as the game opens on it, where a `reset` has
// left "`mode` `campaign`" (`specs/instrumentation.md`), with the highlight put
// on the `EXTRAS` entry of `TITLE_ITEMS` by its index in that list rather than by
// a literal. The mode therefore stands at the value the press has to CHANGE, so a
// build whose `EXTRAS` item set nothing is caught.
//
// THE VERDICT. The mode stood at `campaign` with `EXTRAS` highlighted, and after
// one `confirm` press it is `extras`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThanOrEqual } from "../assert";
import { RECORDING_RUN_UP, RECORDING_SETTLE, TITLE_ITEMS } from "../constants";
import {
  captureReplay,
  createHarness,
  openTitle,
  pressAction,
  type Harness,
} from "../harness";

/** Where `EXTRAS` sits in the title menu. */
const EXTRAS_ITEM = TITLE_ITEMS.indexOf("EXTRAS");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sets the mode to extras when EXTRAS is taken", async () => {
  assertGreaterThanOrEqual(
    EXTRAS_ITEM,
    0,
    "TITLE_ITEMS carries an EXTRAS entry for the confirm to take",
  );

  await openTitle(h);
  await h.debug.setMenuIndex(EXTRAS_ITEM);
  await h.advance(1);

  const before = await h.snapshot();
  assertEqual(
    before.screen,
    "title",
    "the press this point reads is delivered on the title screen",
  );
  assertEqual(
    before.mode,
    "campaign",
    "a reset leaves the mode at campaign, so the press is what sets it to extras",
  );
  assertEqual(
    before.menuIndex,
    EXTRAS_ITEM,
    `the highlight stands on the EXTRAS entry of TITLE_ITEMS (index ${EXTRAS_ITEM})`,
  );

  const after = await captureReplay(h, "extras-mode", async () => {
    await h.advance(RECORDING_RUN_UP);
    const taken = await pressAction(h, "confirm");
    await h.advance(RECORDING_SETTLE);
    return taken;
  });

  assertEqual(
    after.mode,
    "extras",
    "confirm on EXTRAS sets the mode to extras, so the select and editor " +
      "screens serve the shelf",
  );
});
