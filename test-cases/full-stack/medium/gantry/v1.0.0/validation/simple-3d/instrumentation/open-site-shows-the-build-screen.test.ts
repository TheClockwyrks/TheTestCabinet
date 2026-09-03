// instrumentation/open-site-shows-the-build-screen — openSite lands on build.
//
// `specs/instrumentation.md` § The run and the screens: "`openSite` carries the
// effects `specs/state.md` states for opening a site and then shows the `build`
// screen; the two together are what entering a site from the select screen does
// (`specs/ui.md`)." The table above it says the same in one line: "Opens site
// `index`, counted from `0`, locked or not, and shows the `build` screen."
//
// The call is made from the title screen, which is where a reset leaves the game,
// so the screen that is read afterwards was reached by `openSite` and by nothing
// else — no `setScreen` on the way, and no menu pressed. Only the screen is read;
// which site opened and what it carries are their own points.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { createHarness, type Harness } from "../harness";

const SITE = 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("shows the build screen after opening a site", async () => {
  const before = await h.snapshot();
  assertEqual(
    before.screen,
    "title",
    "the screen a reset leaves, which is where this call is made from",
  );

  await h.debug.openSite(SITE);
  const opened = await h.snapshot();

  await h.advance(1);
  await h.capture("state", "The driven state this point decides");

  assertEqual(
    opened.screen,
    "build",
    `the screen openSite(${SITE}) shows (specs/instrumentation.md)`,
  );
});
