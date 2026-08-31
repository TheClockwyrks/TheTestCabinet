// Meltdown — controls/esc-pauses: Escape opens the pause screen when there is
// nothing else for `back` to do.
//
// THE RULE. specs/controls.md binds `back` to `Escape` (The bindings) and
// resolves it "in this order, taking the first case that applies: 1. A placement
// is armed: cancel it... 2. A tower is selected: deselect it... 3. The screen is
// `playing`: open the pause screen." (What `back` does). This item is the THIRD
// case, which is reached exactly when the first two do not apply, and
// specs/screens.md names the screen it opens: `paused`.
//
// THE PRECONDITION IS THE POINT. With a placement armed or a tower selected,
// Escape is required NOT to pause — those are
// `controls.esc-cancels-a-held-placement` and `controls.esc-deselects`, each
// reading its own case. So the scenario poses the state in which case 3 is the
// first that applies: `startRun` leaves `build` and `selected` both null, and both
// are read back before the press, so a build that armed or selected something of
// its own accord is caught posing rather than judged on a case it was never in.
//
// ESCAPE AND KeyP ARE SEPARATE ITEMS, because Escape carries a whole resolution
// order and KeyP carries none: a build can pause perfectly on KeyP and never wire
// `back` at all. `controls.pause-key` reads that half. Only the OPENING is read
// here, because that is the case specs/controls.md gives `back` on the `playing`
// screen; what `back` does ON the pause screen is specs/screens.md's rule and
// `screens.pause-resume`'s item.
//
// THE FREEZE IS NOT READ HERE. That the floor stops while the screen is `paused`
// is `waves.pause-freezes-the-floor`, measured there on the build's own clock,
// because a question about whether time passes belongs on the clock the player's
// game runs on. `screen` is a field, and a field reads the same however the clock
// is driven.
//
// THE WORLD IS AN EMPTY, QUIET, LIVE RUN, so no leak, no wave clear and no
// arriving unit can move the screen while the press is read.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNull } from "../assert";
import {
  captureStill,
  createHarness,
  startRun,
  type Harness,
} from "../harness";

/** The key specs/controls.md binds `back` to, as a `KeyboardEvent.code`. */
const KEY = "Escape";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("opens the pause screen on an Escape press with nothing armed and nothing selected", async () => {
  startRun(h);
  await h.advance(1);

  const before = h.snapshot();
  assertEqual(before.screen, "playing", "the screen the scenario is posed on");
  assertNull(before.build, "the held preview the scenario is posed with");
  assertNull(before.selected, "the selection the scenario is posed with");

  await h.tap(KEY);
  captureStill(h, "paused");

  assertEqual(
    h.snapshot().screen,
    "paused",
    `${KEY}: the screen one press leaves live play on with nothing armed and nothing selected`,
  );
});
