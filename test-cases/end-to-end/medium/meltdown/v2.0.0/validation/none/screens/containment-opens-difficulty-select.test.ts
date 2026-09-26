// Meltdown — screens/containment-opens-difficulty-select: Containment opens the
// difficulty list.
//
// THE RULE. `specs/screens.md`, on `modeselect`'s five rows: `CONTAINMENT` leads
// to `difficultyselect`, while "Any other row" leads to `playing`. It is the first
// of `MODE_ITEMS`, and `specs/modes.md` says why it alone has a second screen:
// Containment "is the only mode with a difficulty".
//
// WHY THIS ITEM IS CAPPED `broken` AND NAMES EVERY FUNCTIONAL DOMAIN. It is the
// second of the three doors between the title screen and a Containment run — the
// mode every difficulty, wave-progression, interest and Core item is read on. A
// build that cannot pass it cannot be played at all on the standard mode, so its
// heat model, its defence, its run and its presentation are all unreachable, and
// since a run's functional rating is the worst across the domains in play, an item
// naming presentation alone would leave such a build carrying a flawless heat,
// defence and run rating.
//
// THE DISTINGUISHING READING. Every wrong model reads a different screen:
// a build that started a run straight from this row reads `playing`, one that led
// nowhere reads `modeselect`, and one that fell back to the title reads `title`.
//
// THE ROW IS POSED, NOT WALKED, and the mode is posed with it. `setMenuIndex` sets
// the highlighted row outright and `setMode` changes no other field
// (`specs/instrumentation.md`), so a build whose arrow keys are broken still gets a
// fair reading of where its Containment row leads. What the difficulty list DRAWS
// is `screens.difficulty-lists-its-rows`'s and
// `screens.difficulty-shows-its-figures`'s; where its rows lead is
// `screens.difficulty-starts-the-run`'s.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { MODES, MODE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  tapAction,
  type Harness,
} from "../harness";

/** The row confirmed: `CONTAINMENT`, the first of the six `MODE_ITEMS`. */
const CONTAINMENT_ROW = MODES.indexOf("containment");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("opens the difficulty list when Containment is confirmed on the mode list", async () => {
  const { debug } = h;
  await debug.reset();
  await debug.setScreen("modeselect");
  await debug.setMenuIndex(CONTAINMENT_ROW);
  await h.advance(1);

  const posed = await h.snapshot();
  assertEqual(
    posed.screen,
    "modeselect",
    "the screen the scenario is posed on",
  );
  assertEqual(
    posed.menuIndex,
    CONTAINMENT_ROW,
    "the row the scenario is posed on",
  );

  await tapAction(h, "confirm");
  await h.advance(1);
  await captureStill(h, "difficulty");

  const after = await h.snapshot();
  assertEqual(
    after.screen,
    "difficultyselect",
    `the screen confirming ${MODE_ITEMS[CONTAINMENT_ROW]}, row ${CONTAINMENT_ROW} of ${MODE_ITEMS.length} on the mode list, leads to`,
  );
});
