// instrumentation/check-reading-is-pure — the check reading computes the check
// and displays nothing.
//
// `specs/instrumentation.md` § Readings: "The reading is pure: it computes the
// check and returns it, and it displays nothing, so the result the build screen
// is showing is untouched." Its snapshot notes say it from the field's side:
// "`checkResult` is the result the build screen is currently showing, exactly as
// the `check` action left it. The `check` reading never sets it."
//
// THE SCENARIO IS THE BUILD SCREEN SHOWING NOTHING, which is where the difference
// is visible: `checkResult` rests at "`null` while the build screen is showing no
// check result", and opening a site clears it (`specs/state.md`), so a build
// whose reading wrote through to the screen leaves a result standing where a
// player pressed nothing.
//
// A STANDING CRANE IS POSED FIRST so the reading has something to answer with. It
// is the minimal crane, which has no readiness issue on any site, so the result
// the reading returns is a full one — the issues, the cost, the verdict, and the
// members — and a build that answered nothing at all is caught by the same check
// that would otherwise have nothing to distinguish it from a build that answered
// and displayed.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertNotNull, assertNull } from "../assert";
import {
  clearAll,
  createHarness,
  openSite,
  standMinimalCrane,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("returns a check result and leaves the shown result untouched", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  const showing = (await h.snapshot()).checkResult;

  const answered = await h.check();
  const after = (await h.snapshot()).checkResult;

  await h.advance(1);
  await h.capture("state", "The driven state this point decides");

  assertNull(
    showing,
    "what the build screen is showing before the reading, which a site " +
      "opening clears (specs/instrumentation.md)",
  );
  assertNotNull(
    answered,
    "the result the check reading returns (specs/instrumentation.md)",
  );
  assertGreaterThan(
    answered.budget,
    0,
    "the budget the returned result carries, so the reading answered the " +
      "check rather than an empty object (specs/structure.md)",
  );
  assertNull(
    after,
    "what the build screen is showing after the check reading, which never " +
      "sets it (specs/instrumentation.md)",
  );
});
