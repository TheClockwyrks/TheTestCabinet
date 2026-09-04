// Wick — screens/paused-confirm-main-menu: confirming `MAIN MENU` abandons the
// run and returns to the title.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/ui.md`, "`paused`", gives
// the item table the row "`MAIN MENU` | Abandons the run and returns to
// `title` with `menuIndex = 0`", and "`up` and `down` move the highlight and
// wrap at both ends, and `confirm` takes the highlighted item".
// `specs/controls.md` binds `down` to `ArrowDown` and `confirm` to `Enter`.
// `specs/state.md`, "The idle run", says `run` holds the idle values "whenever
// `screen` is `title`, `howto`, or `almanac` ... and leaving a run for the
// title restores them", the table this suite spells as `IDLE_RUN`.
//
// THE DRIVE. An isolated `playing` world with a moth, a gem, a clock posed off
// `0` and the lamplighter posed away from the origin, so a title screen still
// carrying any of it fails; the pause posed through `setScreen("paused")` —
// which `specs/instrumentation.md` says enters it "exactly as `pause` does" —
// one `ArrowDown` onto `MAIN MENU`, read back as the precondition, then the
// `Enter` this point is about.
//
// THE TOLERANCE. None: a screen name, an index, and a run compared field for
// field against the idle run.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { PAUSE_ITEMS } from "../constants";
import {
  IDLE_RUN,
  captureStill,
  createHarness,
  isolate,
  placeEnemy,
  placeGem,
  poseScreen,
  tap,
  type Harness,
} from "../harness";

/** The index `MAIN MENU` occupies in the pause menu (specs/ui.md, PAUSE_ITEMS). */
const MAIN_MENU_INDEX = PAUSE_ITEMS.indexOf("MAIN MENU");

/** Where the lamplighter stands, and the clock it stands at, before the pause. */
const PLAYER_X = 140;
const PLAYER_Y = -75;
const TICK = 2700;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("reads title with menuIndex 0 and the idle run after Enter on MAIN MENU", async () => {
  isolate(h);
  h.debug.setTick(TICK);
  h.debug.setPlayerPosition(PLAYER_X, PLAYER_Y);
  placeEnemy(h, "moth", PLAYER_X - 320, PLAYER_Y);
  placeGem(h, "large", PLAYER_X, PLAYER_Y + 320);

  const paused = poseScreen(h, "paused");
  assertEqual(paused.screen, "paused", "the screen the presses are made on");

  const posed = await tap(h, "ArrowDown");
  assertEqual(
    posed.menuIndex,
    MAIN_MENU_INDEX,
    "the highlighted item before the confirm",
  );

  const after = await tap(h, "Enter");
  captureStill(h, "title");

  assertEqual(after.screen, "title", "the screen after Enter on MAIN MENU");
  assertEqual(after.menuIndex, 0, "menuIndex on arriving at the title");
  assertDeepEqual(
    after.run,
    IDLE_RUN,
    "the run after abandoning (specs/state.md, The idle run)",
  );
});
