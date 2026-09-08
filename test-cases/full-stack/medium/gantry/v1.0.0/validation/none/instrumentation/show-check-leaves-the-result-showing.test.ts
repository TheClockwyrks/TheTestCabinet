// instrumentation/show-check-leaves-the-result-showing — the pose computes the
// static check and leaves it showing, from wherever it is called.
//
// `specs/instrumentation.md` § The run and the screens: "`showCheck` computes
// the check and leaves it showing wherever it is called." The snapshot's own
// note says what "showing" means: "`checkResult` is the check result currently
// standing, exactly as the `check` action or the `showCheck` pose left it, and
// it is what the build screen draws. The `check` reading never sets it."
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
// THE SCREEN IS THE OTHER HALF, and it is asserted the other way round from
// what a player sees. "No operation asks which screen is showing … so an
// operation acts from wherever the game stands", so the pose is made once on
// `title` and the result it left there is the same result. Whether a PLAYER can
// run the check off the build screen is the key route's question, and
// `controls/check-key` and `controls/check-does-nothing-on-the-run-screen`
// decide it by pressing the key.

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

it("leaves the check the action would show, from wherever it is called", async () => {
  await openSite(h, SITE);
  await emptyYard(h);
  await poseCrane(h, MINIMAL_CRANE);

  assertNull(
    (await h.snapshot()).checkResult,
    "the check result a freshly opened site shows, which is none " +
      "(specs/state.md)",
  );

  // The screen is how a player reaches the `check` action and is not the
  // operation's condition, so the pose is made off the build screen first.
  await h.debug.setScreen("title");
  await h.debug.showCheck();
  const offTheBuildScreen = (await h.snapshot()).checkResult;

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
  assertDeepEqual(
    offTheBuildScreen,
    reading,
    "the result showCheck left when it was called on the title screen: the " +
      "operation acts from wherever the game stands (specs/instrumentation.md)",
  );
});
