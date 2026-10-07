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
import { createHarness, openSite, type Harness } from "../harness";

/**
 * The structure the reading is taken against: a slew ring and the one rail that
 * hangs off its top flange, which together form a sound track
 * (`specs/structure.md` § The trolley and the rail).
 *
 * ENOUGH FOR THE READING TO BE ABOUT SOMETHING, and no more. Nothing below turns on the crane standing, on its cost, or on which issues come back: what this decides is that `check` ANSWERS and leaves the shown result alone. A whole crane
 * would put twenty further editor calls between the harness and the reading,
 * each of them a refusal belonging to an editor validator, which makes this
 * grade less precise rather than more.
 */
const RING = { x: 0, y: 2, z: 0 };
const RAIL_A = { x: 0, y: 4, z: 0 };
const RAIL_B = { x: 4, y: 4, z: 0 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("returns a check result and leaves the shown result untouched", async () => {
  await openSite(h, 0);
  // Nothing is cleared: a site opened after a reset has nothing built, and a
  // readiness reading is taken off the structure and the site alone
  // (specs/structure.md), so the yard and the tape are not this requirement's.
  await h.debug.setRing(RING.x, RING.y, RING.z);
  await h.debug.addMember(
    RAIL_A.x,
    RAIL_A.y,
    RAIL_A.z,
    RAIL_B.x,
    RAIL_B.y,
    RAIL_B.z,
    "rail",
  );
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
