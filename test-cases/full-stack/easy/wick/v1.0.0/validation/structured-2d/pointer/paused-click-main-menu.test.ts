// Wick — pointer/paused-click-main-menu: clicking MAIN MENU abandons the run.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/controls.md`, The pointer,
// rule 2, Click: "A primary press edge inside the rectangle of the item at
// `menuIndex` `i` sets `menuIndex` to `i`, playing `menu-move` if that changed
// it, and then takes that item exactly as `confirm` on it does."
// `specs/ui.md`, "`paused`", gives the menu `PAUSE_ITEMS`, "`RESUME`,
// `MAIN MENU`, in that order", with `menuIndex` `0` on arriving, and
// `MAIN MENU`: "Abandons the run and returns to `title` with `menuIndex = 0`."
// `specs/state.md`, "The idle run", says `run` holds the idle values "whenever
// `screen` is `title`, `howto`, or `almanac` ... and leaving a run for the
// title restores them", the table this suite spells as `IDLE_RUN`.
//
// WHAT IS READ, AND WHY IT DECIDES THE CLAIM. `screen`, `menuIndex`, and the
// whole run. The click lands two items away from the highlight the pause opens
// on, so a build whose click confirms whatever the highlight sat on resumes
// instead and reads `playing`, and a build that returns to the title carrying
// any of the abandoned run fails the run comparison.
//
// THE DRIVE. An isolated `playing` world with a moth, a gem, a clock posed off
// `0` and the lamplighter posed away from the origin, so a title screen still
// carrying any of it fails; the pause posed through `setScreen("paused")` — by
// setting `screen` alone, with the run left as it stands
// (`specs/instrumentation.md`) — then a primary press and release in the middle
// of `MAIN MENU`'s own rectangle, read off `menuRects`.
//
// THE TOLERANCE. None: a screen name, an index, and a run compared field for
// field against the idle run.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import { PAUSE_ITEMS } from "../constants";
import {
  IDLE_RUN,
  captureStill,
  clickRect,
  createHarness,
  isolate,
  menuRects,
  placeEnemy,
  placeGem,
  poseScreen,
  type Harness,
} from "../harness";

/** The index of MAIN MENU, the second item of PAUSE_ITEMS (specs/ui.md). */
const MAIN_MENU = 1;

/** Where the lamplighter stands, and the clock it stands at, before the pause. */
const PLAYER_X = 120;
const PLAYER_Y = -60;
const TICK = 1800;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("reads title with menuIndex 0 and the idle run after a click on MAIN MENU", async () => {
  isolate(h);
  h.debug.setTick(TICK);
  h.debug.setPlayerPosition(PLAYER_X, PLAYER_Y);
  placeEnemy(h, "moth", PLAYER_X + 300, PLAYER_Y);
  placeGem(h, "large", PLAYER_X + 300, PLAYER_Y);

  const paused = poseScreen(h, "paused");
  assertEqual(paused.screen, "paused", "the screen the click is made on");
  assertEqual(paused.menuIndex, 0, "the highlighted item before the click");

  const rects = menuRects(h);
  assertLength(
    rects,
    PAUSE_ITEMS.length,
    "the pause menu's rectangles, one per item (specs/controls.md, The pointer)",
  );

  const after = await clickRect(h, rects[MAIN_MENU]);
  captureStill(h, "abandoned");

  assertEqual(
    after.screen,
    "title",
    "the screen after a click on MAIN MENU (specs/ui.md, paused)",
  );
  assertEqual(after.menuIndex, 0, "menuIndex on arriving at the title");
  assertDeepEqual(
    after.run,
    IDLE_RUN,
    "the run after abandoning (specs/state.md, The idle run)",
  );
});
