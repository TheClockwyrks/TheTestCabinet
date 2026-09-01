// Wick — screens/fallen-title: `TITLE` on the fallen screen returns to the
// title with the run discarded.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/ui.md`, "`fallen` and
// `dawn`": the menu is `END_ITEMS` (`TRY AGAIN`, `TITLE`, "in that order"),
// and "`confirm` takes the highlighted item: ... `TITLE` returns to `title`
// with `menuIndex = 0`". `specs/state.md`, "The idle run", says the idle
// values hold "whenever `screen` is `title` or `howto` ... and leaving a run
// for the title restores them", the table this suite spells as `IDLE_RUN`.
// `specs/controls.md` binds `confirm` to `Enter` and `Space`.
//
// THE DRIVE. An isolated `playing` run with every driver switch off, its
// level and its kill count posed so an idle or a fresh run is unmistakable,
// ended fallen by posing `hp` to `0` and running the one tick
// `specs/world.md` ends the run on, then one real `ArrowDown` onto
// `TITLE`, read back as the precondition, then the `Enter` this point is
// about. The debug surface carries no operation that poses `menuIndex`
// (`specs/instrumentation.md`), so the menu's own `down` is the only way onto
// the second item.
//
// THE TOLERANCE. None: a screen name, an index, and a run compared field for
// field against the idle run.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  IDLE_RUN,
  captureStill,
  createHarness,
  endFallen,
  isolate,
  tap,
  type Harness,
} from "../harness";

/** The index of TITLE in END_ITEMS (specs/ui.md). */
const TITLE_ITEM = 1;
/** The ended run's figures, none of which the idle run carries. */
const LEVEL = 6;
const KILLS = 143;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("reads title with menuIndex 0 and the idle run when Enter takes TITLE", async () => {
  isolate(h);
  h.debug.setLevel(LEVEL);
  h.debug.setKills(KILLS);
  const ended = await endFallen(h);
  assertEqual(ended.screen, "fallen", "the screen the press is made on");

  const posed = await tap(h, "ArrowDown");
  assertEqual(posed.menuIndex, TITLE_ITEM, "the highlighted item, TITLE");

  const after = await tap(h, "Enter");
  captureStill(h, "title");

  assertEqual(after.screen, "title", "the screen after confirming TITLE");
  assertEqual(after.menuIndex, 0, "menuIndex on arriving at the title");
  assertDeepEqual(
    after.run,
    IDLE_RUN,
    "the run on the title screen (specs/state.md, The idle run)",
  );
});
