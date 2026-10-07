// instrumentation/reset-clears-the-shown-check-result — a reset leaves no check
// result showing.
//
// `specs/instrumentation.md` § The run and the screens: "`reset` restores every
// field the snapshot reports to its title-screen value, bar one: […] no check
// result showing". § Snapshot shape reports it as `checkResult`, "the result the
// build screen is currently showing, exactly as the `check` action left it",
// resting at `null` "while the build screen is showing no check result".
//
// The result has to be put there by the `check` ACTION, because the `check`
// reading cannot: "The reading is pure: it computes the check and returns it, and
// it displays nothing", and § Snapshot shape repeats it — "The `check` reading
// never sets it." So the one route to a shown result is `showCheck`, which
// "Poses the `check` action: computes the static check and leaves it showing on
// the build screen, exactly as the action does". That is the direct route to this
// scenario rather than a detour: it is the only one.
//
// Nothing is built. `specs/ui.md` gives what the screen shows when the check finds
// "A readiness issue" as a result like any other, so an empty structure is enough
// to put one there, and the world stays as bare as the point allows.

import { afterEach, beforeEach, it } from "vitest";
import { assertNotNull, assertNull } from "../assert";
import { createHarness, emptyYard, openSite, type Harness } from "../harness";

/** The key `specs/controls.md` binds the `check` action to. */

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("shows no check result after a reset", async () => {
  await openSite(h, 0);
  await emptyYard(h);
  await h.debug.showCheck();
  const shown = await h.snapshot();
  assertNotNull(
    shown.checkResult,
    "the result the `check` action left the build screen showing, which is " +
      "the scenario this point rests on (specs/ui.md)",
  );

  await h.debug.reset();
  const s = await h.snapshot();

  await h.advance(1);
  await h.capture("state", "The driven state this point decides");

  assertNull(
    s.checkResult,
    "checkResult after a reset (specs/instrumentation.md)",
  );
});
