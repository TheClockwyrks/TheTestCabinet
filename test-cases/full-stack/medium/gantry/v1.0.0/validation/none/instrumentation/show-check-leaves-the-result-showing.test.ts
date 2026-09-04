// instrumentation/show-check-leaves-the-result-showing — the pose computes the
// static check and leaves it showing.
//
// `specs/instrumentation.md` § The run and the screens: "`showCheck` Poses the
// `check` action: computes the static check and leaves it showing on the build
// screen, exactly as the action does (`specs/structure.md`)." The snapshot's
// own note says what "showing" means: "`checkResult` is the result the build
// screen is currently showing, exactly as the `check` action or the `showCheck`
// pose left it. The `check` reading never sets it."
//
// SO THE POSE IS CHECKED THE WAY EVERY OTHER ONE IS — set a value and read it
// back. `checkResult` reads `null` on a site just opened, `showCheck` is
// called, and what it left is compared field for field against the `check`
// reading taken at the same structure. A build that showed something else, or
// showed nothing, fails.
//
// THE CRANE IS A SOUND ONE, so the result has something in every field: a
// structure that does not stand reports no member, and a check comparing two
// empty member lists would pass for a build that answered an empty result to
// everything.
//
// The screen restriction is its own half: the pose "applies on the build
// screen, where the `check` action does, and does nothing on any other", so it
// is called once on `title` first and `checkResult` is read as still `null`.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertNotNull,
  assertNull,
  assertTrue,
} from "../assert";
import {
  MINIMAL_CRANE,
  createHarness,
  emptyYard,
  openSite,
  poseCrane,
  type Harness,
} from "../harness";

/** The site the crane is posed on. */
const SITE = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves the check the action would show on the build screen", async () => {
  await openSite(h, SITE);
  await emptyYard(h);
  await poseCrane(h, MINIMAL_CRANE);

  assertNull(
    (await h.snapshot()).checkResult,
    "the check result a freshly opened site shows, which is none " +
      "(specs/state.md)",
  );

  // Off the build screen the pose does nothing, whatever the structure.
  await h.debug.setScreen("title");
  await h.debug.showCheck();
  assertNull(
    (await h.snapshot()).checkResult,
    "the check result after showCheck on the title screen, where the `check` " +
      "action does not apply (specs/instrumentation.md)",
  );

  await h.debug.setScreen("build");
  await h.debug.showCheck();

  const shown = (await h.snapshot()).checkResult;
  const reading = await h.check();

  await h.advance(1);
  await h.capture("state", "The driven state this point decides");

  assertNotNull(
    shown,
    "the check result showCheck left the build screen showing " +
      "(specs/instrumentation.md)",
  );
  assertTrue(
    reading.stable,
    "a structure that stands, so the result compared below carries a member " +
      "for every member of the crane",
  );
  assertDeepEqual(
    shown,
    reading,
    "the shown result against what the `check` reading reports at the same " +
      "structure: showCheck poses the action exactly (specs/instrumentation.md)",
  );
});
