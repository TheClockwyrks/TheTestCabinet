// screens/select-highlight-follows-the-open-site — arriving at `select` puts the
// highlight on the site the yard screens last showed.
//
// `specs/ui.md` § The screens, Site select: "On arriving, the highlight sits on
// the site the yard screens last showed (`siteIndex`, `specs/state.md`)."
//
// SITE `3` RATHER THAN SITE `0`. A build that put the highlight at `0` whatever
// the open site would agree with a build that reads `siteIndex` on every site the
// game starts on, so the site opened here is one the highlight cannot reach by
// accident. `openSite` reaches it "locked or not"
// (`specs/instrumentation.md`), which is what lets this item be decided without
// playing three sites to get there — the unlocking rule is its own review point.
//
// ARRIVING IS THE POINT, so the screen is reached by pressing `back` on the build
// screen, which `specs/ui.md` says "returns to `select`". `setScreen` could not
// decide it: it "shows a named screen and sets nothing else", leaving `menuIndex`
// where it stood, and the requirement is precisely about what an arrival sets.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { BINDINGS } from "../constants";
import { createHarness, openSite, type Harness } from "../harness";

/** `back`'s binding, as `specs/controls.md` fixes it. */
const BACK = BINDINGS.back[0]!;

/** The site opened before the arrival: not the one a default would land on. */
const SITE = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("highlights the open site on arriving at the site list", async () => {
  await openSite(h, SITE);
  const posed = await h.snapshot();
  assertEqual(posed.screen, "build", "the yard screen `back` is pressed on");
  assertEqual(posed.siteIndex, SITE, "the site the yard screens are showing");

  await h.press(BACK);
  const arrived = await h.snapshot();
  await h.advance(1);
  await h.capture("select-highlight", "The highlight on the last site shown");

  assertEqual(
    arrived.screen,
    "select",
    "the screen `back` on `build` returns to (specs/ui.md)",
  );
  assertEqual(
    arrived.menuIndex,
    SITE,
    `the highlighted site on arriving at select, which is siteIndex (${SITE}) ` +
      "(specs/ui.md)",
  );
});
