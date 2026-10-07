// check/check-result-stands-until-the-structure-changes — the shown check result
// stands until the structure changes.
//
// specs/structure.md § The static check: "The result the action leaves stands
// until the structure or the tape changes, when it goes back to none. The build
// screen shows it until then, so what is shown always describes the crane and the
// tape on screen." This point is the structure half of that sentence.
//
// THE ACTION AND NOT THE READING. specs/instrumentation.md is explicit that the
// two are different things: the `check` reading "is pure: it computes the check
// and returns it, and it displays nothing", and "`checkResult` is the result the
// build screen is currently showing, exactly as the `check` action left it. The
// `check` reading never sets it." So the result is put on screen by `showCheck`,
// which poses the `check` action, and read back off `snapshot().checkResult`.
//
// The edit is one member placed through the structure pose, which "enter[s] the
// rule pipeline the build tools feed" (specs/instrumentation.md), so it is the
// same structure change a click makes. It is a strut between two of the site's
// anchors, so it is accepted: a refused edit changes nothing and would leave this
// point deciding the wrong thing.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull, assertNull } from "../assert";
import {
  clearAll,
  createHarness,
  openSite,
  standMinimalCrane,
  type Harness,
} from "../harness";

const SITE = 0;

/** The key specs/controls.md binds the `check` action to on the build screen. */

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("clears the shown result when a member is placed", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  await standMinimalCrane(h);

  await h.debug.showCheck();
  const shown = (await h.snapshot()).checkResult;
  assertNotNull(
    shown,
    "the result the `check` action leaves the build screen showing " +
      "(specs/structure.md § The static check)",
  );

  const before = (await h.snapshot()).structure.members.length;
  await h.debug.addMember(0, 0, 0, 0, 0, 2, "strut");
  const after = await h.snapshot();
  await h.advance(1);
  await h.capture("state", "The driven state this point decides");

  assertEqual(
    after.structure.members.length,
    before + 1,
    "the member the edit placed, so the structure did change",
  );
  assertNull(
    after.checkResult,
    "the shown check result once the structure changed " +
      "(specs/structure.md § The static check)",
  );
});
