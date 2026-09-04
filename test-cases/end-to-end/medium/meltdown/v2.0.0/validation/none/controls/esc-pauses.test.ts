// Meltdown — controls/esc-pauses: Escape opens the pause screen when there is
// nothing else for `back` to do.
//
// specs/controls.md binds `back` to `Escape` and resolves it "in this order,
// taking the first case that applies: 1. A placement is armed: cancel it... 2. A
// tower is selected: deselect it... 3. The screen is `playing`: open the pause
// screen. 4. Otherwise: leave the current screen". This point is the third case,
// which is the case reached exactly when the first two do not apply.
//
// THE PRECONDITION IS THE POINT. With a placement armed or a tower selected,
// `Escape` is required NOT to pause — those are
// `controls.esc-cancels-a-held-placement` and `controls.esc-deselects`, and each
// reads its own case. So this scenario poses the state in which case 3 is the
// first that applies: `startRun` leaves `build` and `selected` both `null`, and
// they are read back below before the press, so a build that armed or selected
// something of its own accord is caught posing rather than judged on a case it
// was never in.
//
// `Escape` AND `KeyP` ARE SEPARATE POINTS, because `Escape` carries a whole
// resolution order and `KeyP` carries none. A build can pause perfectly on `KeyP`
// and never wire `back` at all; `controls.pause-key` reads that half, and reads
// the return from the pause screen with it. Only the opening is read here, because
// that is the case specs/controls.md gives `back` on the `playing` screen — what
// `back` does ON the pause screen is specs/screens.md's ("`back` resumes...
// which is what `RESUME` does") and belongs to `screens.esc-resumes`, which
// presses `back` on the pause screen and reads what it returned to.
//
// THE FREEZE IS NOT READ HERE. That the floor stops while the screen is `paused`
// is `waves.pause-freezes-the-floor`, measured there on the build's own clock.
// `screen` is a field, and a field reads the same however the clock is driven.
//
// THE WORLD IS AN EMPTY, QUIET, LIVE RUN, so nothing on the floor can move the
// screen while the press is read.

import { afterEach, beforeEach, it } from "vitest";
import { BINDINGS } from "../constants";
import { assertEqual, assertNull } from "../assert";
import {
  captureStill,
  createHarness,
  startRun,
  type Harness,
} from "../harness";

/** The key specs/controls.md binds `back` to, and the only one. */
const KEY = BINDINGS.back;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("opens the pause screen on an Escape press with nothing armed and nothing selected", async () => {
  await startRun(h);
  await h.advance(1);
  const before = await h.snapshot();
  assertEqual(before.screen, "playing", "the screen the scenario is posed on");
  assertNull(before.build, "the held preview the scenario is posed with");
  assertNull(before.selected, "the selection the scenario is posed with");

  await h.tap(KEY);
  await h.advance(1);
  const after = await h.snapshot();
  await captureStill(h, "paused");

  assertEqual(
    after.screen,
    "paused",
    `${KEY}: the screen one press leaves live play on with nothing armed and nothing selected`,
  );
});
