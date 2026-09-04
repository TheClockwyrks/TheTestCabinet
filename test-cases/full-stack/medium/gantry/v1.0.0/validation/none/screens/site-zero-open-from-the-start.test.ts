// screens/site-zero-open-from-the-start — site 1 is open on a game that has
// cleared nothing.
//
// `specs/ui.md` § The screens, Site select: "The site at index `0` is open from
// the start, the site at index `n + 1` opens once the site at index `n` is
// cleared." This is the first half of that sentence: the site a player can enter
// with nothing behind them.
//
// OPENNESS IS NOT A SNAPSHOT FIELD, so the entry is the reading. The same
// paragraph fixes what an open row does — "`confirm` on an open or cleared site
// enters it, opening the `build` screen with that site's stored structure and
// tape" — and what a locked one does, which is nothing, so a `confirm` that lands
// on site `1`'s build screen is the list reporting the row open.
//
// `reset` is what puts the game where the requirement speaks of: "site `0` open,
// every site uncleared with no recorded score" (`specs/instrumentation.md`). No
// site is opened and nothing is cleared on the way, so what the `confirm` finds is
// the state a fresh game stands in.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import { BINDINGS, SITE_NAMES } from "../constants";
import { createHarness, type Harness } from "../harness";

/** `confirm`'s binding, as `specs/controls.md` fixes it. */
const CONFIRM = BINDINGS.confirm[0]!;

/** The first site: First Lift, at index 0. */
const SITE = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("enters the first site on a game that has cleared nothing", async () => {
  await h.debug.reset();
  await h.debug.setScreen("select");
  await h.debug.setMenuIndex(SITE);

  const posed = await h.snapshot();
  assertEqual(posed.screen, "select", "the screen `confirm` is taken on");
  assertTrue(
    posed.cleared.every((done) => done === false),
    "every site standing uncleared, which is where a fresh game starts " +
      "(specs/instrumentation.md)",
  );

  await h.press(CONFIRM);
  const entered = await h.snapshot();
  await h.advance(1);
  await h.capture("state", "The site that is open from the start");

  assertEqual(
    entered.screen,
    "build",
    `the screen \`confirm\` on site 1, ${SITE_NAMES[SITE]}, opens with ` +
      "nothing cleared, which a locked site refuses (specs/ui.md)",
  );
  assertEqual(
    entered.siteIndex,
    SITE,
    "the site entered from the first row (specs/ui.md)",
  );
});
