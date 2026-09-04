// instrumentation/open-site-leaves-the-screen-as-it-stands — openSite carries
// the opening and nothing else.
//
// `specs/instrumentation.md` § The run and the screens: "`openSite(index)`
// Opens site `index`, counted from `0`, locked or not — the opening
// `specs/state.md` fixes, as below — and sets nothing else; the screen is left
// as it stands." The prose beneath the table says the other half: "Entering a
// site from the select screen is the two operations `openSite` then
// `setScreen("build")`, in that order."
//
// TWO SCREENS, BECAUSE ONE WOULD NOT DECIDE IT. A build that always showed
// `title` after an opening would pass a check made from the title screen alone.
// So the call is made once from `title`, where a reset leaves the game, and
// once from `select`, and each time the screen read afterwards is the one that
// was showing before. Only the screen is read; which site opened and what it
// carries are their own points.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { createHarness, type Harness } from "../harness";

/** Two sites, so neither reading can be the other's leftover. */
const FROM_TITLE = 4;
const FROM_SELECT = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves the screen showing when a site is opened", async () => {
  const before = await h.snapshot();
  assertEqual(
    before.screen,
    "title",
    "the screen a reset leaves, which is where the first call is made from",
  );

  await h.debug.openSite(FROM_TITLE);
  const fromTitle = await h.snapshot();

  await h.debug.setScreen("select");
  await h.debug.openSite(FROM_SELECT);
  const fromSelect = await h.snapshot();

  await h.advance(1);
  await h.capture("state", "The driven state this point decides");

  assertEqual(
    fromTitle.screen,
    "title",
    `the screen openSite(${FROM_TITLE}) left showing, called on title ` +
      "(specs/instrumentation.md)",
  );
  assertEqual(
    fromTitle.siteIndex,
    FROM_TITLE,
    "the site that opening opened, so the call did something",
  );
  assertEqual(
    fromSelect.screen,
    "select",
    `the screen openSite(${FROM_SELECT}) left showing, called on select ` +
      "(specs/instrumentation.md)",
  );
  assertEqual(
    fromSelect.siteIndex,
    FROM_SELECT,
    "the site that opening opened, so the call did something",
  );
});
