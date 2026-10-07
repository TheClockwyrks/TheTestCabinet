// screens/site-unlocks-on-a-clear — the site after a cleared one opens.
//
// `specs/ui.md` § The screens, Site select: "The site at index `0` is open from
// the start, the site at index `n + 1` opens once the site at index `n` is
// cleared, and cleared and open sites stay so for the session."
//
// OPENNESS IS NOT A SNAPSHOT FIELD, so the entry is the reading. `specs/ui.md`
// fixes what an open row does and what a locked one does in the same paragraph —
// "`confirm` on an open or cleared site enters it, opening the `build` screen ...
// `confirm` on a locked site does nothing" — so a `confirm` that lands on the
// build screen with that site open is exactly what a locked row refuses. The
// refusal itself is its own review point; what this one decides is that clearing
// site `1` opens site `2`.
//
// `setCleared` is the precondition a clear leaves — "sets whether site `index`
// has been cleared this session, and with it which sites are open"
// (`specs/instrumentation.md`) — rather than an outcome: running site `1` to a
// clear would grade the run, the tape and the statics on the way to a question
// about the list.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { BINDINGS } from "../constants";
import { createHarness, type Harness } from "../harness";

/** `confirm`'s binding, as `specs/controls.md` fixes it. */
const CONFIRM = BINDINGS.confirm[0]!;

/** The site cleared, and the one after it, which the clear opens. */
const CLEARED = 0;
const NEXT = CLEARED + 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("opens the site after the one that was cleared", async () => {
  await h.debug.reset();
  await h.debug.setCleared(CLEARED, true);
  await h.debug.setScreen("select");
  await h.debug.setMenuIndex(NEXT);

  const posed = await h.snapshot();
  assertEqual(posed.screen, "select", "the screen `confirm` is taken on");
  assertEqual(posed.menuIndex, NEXT, "the highlighted site");
  assertEqual(
    posed.cleared[CLEARED],
    true,
    `site ${CLEARED + 1} standing cleared, which is what opens site ` +
      `${NEXT + 1} (specs/ui.md)`,
  );

  await h.press(CONFIRM);
  const entered = await h.snapshot();
  await h.advance(1);
  await h.capture("state", "The site the clear before it opened");

  assertEqual(
    entered.screen,
    "build",
    `the screen \`confirm\` on site ${NEXT + 1} opens once site ` +
      `${CLEARED + 1} is cleared, which a locked site refuses (specs/ui.md)`,
  );
  assertEqual(
    entered.siteIndex,
    NEXT,
    `the site entered, which is site ${NEXT + 1} (specs/ui.md)`,
  );
});
