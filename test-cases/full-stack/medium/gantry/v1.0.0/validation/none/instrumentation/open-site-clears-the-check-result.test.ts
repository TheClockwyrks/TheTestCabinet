// instrumentation/open-site-clears-the-check-result — opening a site takes the
// shown check result away.
//
// `specs/state.md` § What a site opening does: opening a site "clears the pending
// node and the shown check result", and `specs/instrumentation.md` § The run and
// the screens binds `openSite` to that list — it "carries the effects
// `specs/state.md` states for opening a site". § Snapshot shape reports the shown
// result as `checkResult`, "the result the build screen is currently showing,
// exactly as the `check` action left it", resting at `null` "while the build
// screen is showing no check result".
//
// The result has to be put there by the `check` ACTION, because the `check`
// reading cannot: "The reading is pure: it computes the check and returns it, and
// it displays nothing", and § Snapshot shape repeats it — "The `check` reading
// never sets it." So the one route to a shown result is the key `specs/controls.md`
// `showCheck` poses on the build screen where the action lives. That is
// the direct route to this scenario rather than a detour: it is the only one.
//
// Nothing is built. `specs/ui.md` gives what the screen shows when the check finds
// "A readiness issue" as a result like any other, so an empty structure is enough
// to put one there, and the world stays as bare as the point allows.

import { afterEach, beforeEach, it } from "vitest";
import { assertNotNull, assertNull } from "../assert";
import { clearAll, createHarness, openSite, type Harness } from "../harness";

/** The key `specs/controls.md` binds the `check` action to. */

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("clears the shown check result when a site is opened", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await h.debug.showCheck();
  const shown = await h.snapshot();
  assertNotNull(
    shown.checkResult,
    "the result the `check` action left the build screen showing, which is " +
      "the scenario this point rests on (specs/ui.md)",
  );

  await h.debug.openSite(1);
  const opened = await h.snapshot();

  await h.advance(1);
  await h.capture("state", "The driven state this point decides");

  assertNull(
    opened.checkResult,
    "checkResult on a site just opened (specs/state.md)",
  );
});
