// screens/select-confirm-on-a-locked-site — `confirm` on a locked site does
// nothing.
//
// `specs/ui.md` § The screens, Site select: "`confirm` on an open or cleared site
// enters it, opening the `build` screen with that site's stored structure and
// tape; `confirm` on a locked site does nothing."
//
// SITE `3` IS LOCKED ON A GAME THAT HAS CLEARED NOTHING. `specs/ui.md`: "The site
// at index `0` is open from the start, the site at index `n + 1` opens once the
// site at index `n` is cleared", and `reset` leaves "every site uncleared"
// (`specs/instrumentation.md`), so nothing but site `0` is open. Nothing is
// cleared here and nothing is opened, so the row the highlight sits on is locked
// by the rule rather than by a pose.
//
// "DOES NOTHING" IS READ AS BOTH HALVES OF ONE ACT: the screen does not change,
// and no site is opened. `siteIndex` is the reading for the second half —
// entering a site is `openSite`, which sets it (`specs/instrumentation.md`) — so a
// build that quietly opened the locked site and stayed on the list is caught as
// well as one that walked onto the build screen.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { BINDINGS } from "../constants";
import { createHarness, type Harness } from "../harness";

/** `confirm`'s binding, as `specs/controls.md` fixes it. */
const CONFIRM = BINDINGS.confirm[0]!;

/** A site three rungs above the one a fresh game leaves open. */
const LOCKED = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("stays on the site list under confirm on a locked site", async () => {
  await h.debug.reset();
  await h.debug.setScreen("select");
  await h.debug.setMenuIndex(LOCKED);

  const posed = await h.snapshot();
  assertEqual(posed.screen, "select", "the screen `confirm` is taken on");
  assertEqual(posed.menuIndex, LOCKED, "the highlighted site");
  assertEqual(
    posed.cleared[LOCKED - 1],
    false,
    `site ${LOCKED} being uncleared, which is what leaves site ${LOCKED + 1} ` +
      "locked (specs/ui.md)",
  );
  const before = posed.siteIndex;

  await h.press(CONFIRM);
  const after = await h.snapshot();
  assertEqual(
    after.screen,
    "select",
    `the screen after \`confirm\` on locked site ${LOCKED + 1}, which does ` +
      "nothing (specs/ui.md)",
  );
  assertEqual(
    after.siteIndex,
    before,
    "the open site after `confirm` on a locked site, no site having been " +
      "opened (specs/ui.md)",
  );

  await h.advance(1);
  await h.capture("state", "The site list under confirm on a locked site");
});
