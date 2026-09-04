// screens/menu-index-zero-on-arrival — arriving at the title puts the highlight
// back on the first item.
//
// THE RULE, `specs/ui.md`, Screens, `title`: "`menuIndex` is `0` on arriving at
// the title." It is an ARRIVAL rule rather than a rule about the first arrival:
// however far the highlight had been moved on an earlier visit, the next one
// starts on the first item again. `specs/instrumentation.md` says the surface
// enters a screen the same way play does — `setScreen(name)` "Enters the screen
// `name` ... exactly as the real transition into it enters it" — and its own row
// for the title repeats the figure: "`title` | Shows the title menu, `menuIndex`
// at `0`."
//
// THE CONFIGURATION. The title is opened, the highlight is posed onto the LAST
// entry of `TITLE_ITEMS` — the furthest from `0` a title menu can hold it — the
// screen is left for `select`, and the title is entered again. Nothing else is
// posed: no challenge is open, no run is live and no progress is touched, because
// the point is about one field's value at one transition.
//
// WHY THE HIGHLIGHT IS POSED RATHER THAN WALKED. `setMenuIndex` "Sets the
// highlighted item of the menu the current screen shows", which reaches the
// state the rule is about without leaning on the `down` action, whose own points
// are `title-down-moves-highlight` and `title-down-wraps`.
//
// THE VERDICT. The highlight stood on the last item before the screen was left,
// and the game is on the title with `menuIndex` `0` after coming back.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotEqual } from "../assert";
import { TITLE_ITEMS } from "../constants";
import {
  captureReplay,
  createHarness,
  openTitle,
  type Harness,
} from "../harness";

/** The furthest from `0` the title menu's highlight can stand. */
const LAST = TITLE_ITEMS.length - 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sets menuIndex to 0 on entering the title, however far the highlight had moved", async () => {
  await openTitle(h);
  await h.debug.setMenuIndex(LAST);
  await h.advance(1);

  const moved = await h.snapshot();
  assertNotEqual(
    LAST,
    0,
    "TITLE_ITEMS carries more than one entry, so the highlight can be moved off 0",
  );
  assertEqual(
    moved.menuIndex,
    LAST,
    `the highlight stands on the last entry of TITLE_ITEMS (${TITLE_ITEMS[LAST]}) ` +
      "before the screen is left",
  );

  await captureReplay(h, "arrived", async () => {
    await h.debug.setScreen("select");
    await h.advance(1);
    await h.debug.setScreen("title");
    await h.advance(1);
  });

  const arrived = await h.snapshot();
  assertEqual(
    arrived.screen,
    "title",
    "the game is back on the title, which is the arrival the rule is about",
  );
  assertEqual(
    arrived.menuIndex,
    0,
    "menuIndex is 0 on arriving at the title, however far the highlight had moved",
  );
});
