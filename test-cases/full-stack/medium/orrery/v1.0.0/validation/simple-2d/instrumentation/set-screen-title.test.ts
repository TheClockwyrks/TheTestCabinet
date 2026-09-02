// instrumentation/set-screen-title — `setScreen("title")` enters the title menu
// the way arriving at it does.
//
// THE RULE. `specs/instrumentation.md`, Navigation and progress: "`setScreen(name)`
// | Enters the screen `name`, one of `title`, `howto`, `select`, and `editor`,
// exactly as the real transition into it enters it, as the table below states",
// whose first row is "`title` | Shows the title menu, `menuIndex` at `0`."
// `specs/ui.md` fixes the same figure from the screen's own side: "The item at
// `state.menuIndex` is highlighted... `menuIndex` is `0` on arriving at the title."
//
// THE CONFIGURATION. A reset session whose menu highlight is deliberately moved
// off `0` — `setMenuIndex(2)`, the last of the three `TITLE_ITEMS` — and which is
// then taken away to the how-to, so the call under test is a real arrival rather
// than a no-op on the screen it already stood on.
//
// WHY THE HIGHLIGHT IS MOVED FIRST. `menuIndex` rests at `0`, so a build that
// changed the screen and nothing else would pass a check that arrived from a
// resting session. Posing `2` first is what makes `0` afterwards a consequence of
// the arrival.
//
// THE VERDICT. The screen is `title` and the highlight is back on the first item,
// and the title really is what is being drawn: the frame after the call is a
// different picture from the how-to's, and pressing `confirm` on the highlighted
// item takes the first of `TITLE_ITEMS` — `CAMPAIGN`, which "Sets `state.mode` to
// `campaign` and goes to `select`" (`specs/ui.md`).

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { STAGE_H, STAGE_W } from "../constants";
import {
  captureStill,
  createHarness,
  differingShare,
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

it("shows the title menu with its first item highlighted", async () => {
  await openTitle(h);
  await h.debug.setMenuIndex(2);
  assertEqual(
    (await h.snapshot()).menuIndex,
    2,
    "the highlight is posed off the first item before the arrival",
  );

  await openHowto(h);
  assertEqual(
    (await h.snapshot()).screen,
    "howto",
    "the session is somewhere else, so setScreen(title) is a real arrival",
  );
  const elsewhere = await h.pixelRect(0, 0, STAGE_W, STAGE_H);

  await h.debug.setScreen("title");
  const arrived = await h.snapshot();
  await h.advance(1);
  await captureStill(h, "title");
  assertEqual(
    arrived.screen,
    "title",
    'setScreen("title") enters the title screen',
  );
  assertEqual(
    arrived.menuIndex,
    0,
    "arriving at the title puts the highlight on its first menu item",
  );

  assertGreaterThan(
    differingShare(await h.pixelRect(0, 0, STAGE_W, STAGE_H), elsewhere),
    0,
    "the title screen is what is drawn afterwards, not the screen left behind",
  );

  await pressAction(h, "confirm");
  const taken = await h.snapshot();
  assertEqual(
    taken.screen,
    "select",
    "confirm takes the highlighted item, which is the title menu's first",
  );
  assertEqual(
    taken.mode,
    "campaign",
    "the title menu's first item is CAMPAIGN, which sets the mode to campaign",
  );
});
