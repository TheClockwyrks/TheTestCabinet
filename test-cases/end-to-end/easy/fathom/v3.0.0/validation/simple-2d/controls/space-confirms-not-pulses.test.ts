// controls/space-confirms-not-pulses — Space takes a menu item and spends no
// pulse.
//
// specs/movement.md binds `Space` to TWO actions, `a` and `confirm`, and settles
// them by screen rather than by key: its "Where each action is read" table gives
// `"title"` `confirm` and not `a`. This point is that boundary in one direction —
// the press that took the menu item did not also fire the sonar.
//
// BOTH HALVES ARE READ ON THE ONE PRESS, which is what makes the point worth
// having: a build that wired `Space` straight to the pulse fails the screen, a
// build that fires both does the wrong one of the two and would pass an item that
// only looked at the half it got right, and a build that does neither fails the
// screen as well.
//
// THE SONAR IS ARMED BEFORE THE PRESS. `reset` leaves the cooldown at `0` and
// `sonar.ready` true (specs/instrumentation.md), so a pulse is available to be
// spent and its absence afterwards is a reading of something. The selection is
// posed onto `DIVE` with `setMenuIndex`, so the screen the confirm reaches says
// which item it took.
//
// Nothing advances on `"title"` (specs/ui.md), so no bystander can move under the
// press and none is posed away.

import { afterEach, beforeEach, it } from "vitest";

import { assertEqual, assertLength } from "../assert";
import { BINDINGS, TITLE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  openTitle,
  type Harness,
} from "../harness";

/** The key specs/movement.md binds `a` AND `confirm` to. */
const KEY = BINDINGS.a[0];

/** The title's entries, by index (specs/ui.md, `TITLE_ITEMS`). */
const DIVE = TITLE_ITEMS.indexOf("DIVE");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("opens the dive on Space and puts no pulse in flight", async () => {
  openTitle(h);
  h.debug.setMenuIndex(DIVE);
  const title = h.snapshot();
  assertEqual(title.screen, "title", "the screen the press is made on");
  assertEqual(title.menuIndex, DIVE, "the posed title selection");
  assertEqual(
    title.sonar.ready,
    true,
    "the pulse is ready before the press, so its absence after it is a " +
      "reading of something (specs/instrumentation.md)",
  );

  await h.tap(KEY);
  const after = h.snapshot();
  // Before the assertions, so a failing check still leaves the screen it read.
  captureStill(h, "confirmed");

  assertEqual(
    after.screen,
    "countdown",
    `the screen ${KEY} reaches from the title with DIVE selected, where ` +
      "specs/movement.md has the screen read `confirm`",
  );
  assertLength(
    after.pulses,
    0,
    `wavefronts in flight after ${KEY} was pressed on a menu screen, which ` +
      "reads `confirm` and not `a` (specs/movement.md)",
  );
  assertEqual(
    after.sonar.cooldown,
    0,
    `the sonar cooldown after ${KEY} was pressed on a menu screen ` +
      "(specs/movement.md)",
  );
  assertEqual(
    after.sonar.ready,
    true,
    `the pulse's readiness after ${KEY} was pressed on a menu screen ` +
      "(specs/movement.md)",
  );
});
