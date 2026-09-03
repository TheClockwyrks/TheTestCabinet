// controls/check-key — `KeyC` runs the static check on the build screen, and on
// no other screen.
//
// `specs/controls.md` § The actions: the `check` action is bound to `KeyC` and
// does "the static check, on the build screen (`specs/structure.md`)", and the
// paragraph under the table fixes the other half — "Every action applies where
// the table says and does nothing elsewhere." What the action leaves is the shown
// result: `specs/instrumentation.md` reports it as `checkResult`, "the result the
// build screen is currently showing, exactly as the `check` action left it",
// resting at `null` "while the build screen is showing no check result".
//
// THE PROGRAM SCREEN IS PRESSED FIRST, while nothing is showing. Opening a site
// clears the shown result (`specs/state.md`), so the reading stands at `null`
// when the first press lands, and a build that ran the check off the build screen
// has put a result there for the second reading to catch. Pressing in that order
// is what lets one scenario decide both directions without clearing anything in
// between — the second press is the one that is supposed to show a result, and it
// comes last.
//
// The crane is the minimal one, so the check has a real verdict to report rather
// than a bare list of readiness issues, and the yard is emptied so nothing else
// stands. WHAT THE RESULT SAYS IS NOT ASSERTED HERE: the issues, the cost, the
// verdict and the member list are the `check` items' own, and this one decides
// the binding and the screen it applies on.

import { afterEach, beforeEach, it } from "vitest";
import { assertNotNull, assertNull } from "../assert";
import { BINDINGS } from "../constants";
import {
  clearAll,
  createHarness,
  openSite,
  standMinimalCrane,
  type Harness,
} from "../harness";

/** The `check` action's binding, as `specs/controls.md` fixes it. */
const CHECK_KEY = BINDINGS.check[0]!;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("shows a result on the build screen and none on the program screen", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  assertNull(
    (await h.snapshot()).checkResult,
    "the result showing before the check action is taken (specs/state.md)",
  );

  // Off the build screen the action does nothing, so nothing is shown.
  await h.debug.setScreen("program");
  await h.press(CHECK_KEY);
  assertNull(
    (await h.snapshot()).checkResult,
    `the result after ${CHECK_KEY} on the program screen, where the check ` +
      "action does not apply (specs/controls.md)",
  );

  // On the build screen it runs the check, and the screen shows what it found.
  await h.debug.setScreen("build");
  await h.press(CHECK_KEY);
  assertNotNull(
    (await h.snapshot()).checkResult,
    `the result after ${CHECK_KEY} on the build screen, which runs the static ` +
      "check (specs/controls.md)",
  );

  await h.advance(1);
  await h.capture("state", "the build screen showing what the check found");
});
