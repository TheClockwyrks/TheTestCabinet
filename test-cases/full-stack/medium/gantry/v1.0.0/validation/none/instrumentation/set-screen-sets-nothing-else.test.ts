// instrumentation/set-screen-sets-nothing-else — showing a screen leaves
// `menuIndex` where it stands.
//
// `specs/instrumentation.md` § The run and the screens: "`setScreen(screen)` |
// Shows a named screen and sets nothing else; `menuIndex` is left as it stands
// (`specs/state.md`), so a caller posing a screen with a menu sets it with
// `setMenuIndex` afterwards." And below the table: "Arriving at a screen in play
// does more than show it: `specs/ui.md` puts the highlight somewhere on every
// menu … Each of those belongs to the operation that carries it."
//
// THE SCENARIO IS THE ARRIVAL THAT WOULD MOVE THE HIGHLIGHT. `specs/ui.md` has
// the results screen arrived at in play showing its menu "with `menuIndex` `0` on
// arriving", so a build that gave `setScreen` the arrival's effects writes `0`
// here and nowhere it is harder to see. The highlight is put on `2` first, which
// is inside the domain of both menus involved — the select screen's six sites and
// the results screen's three entries (`specs/ui.md`) — so a build that held it
// inside the arriving menu's range would still be leaving it "as it stands".

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { createHarness, type Harness } from "../harness";

/** Inside both menus involved: six sites on select, three entries on results. */
const HIGHLIGHT = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves the menu highlight where it stands when it shows a screen", async () => {
  await h.debug.setScreen("select");
  await h.debug.setMenuIndex(HIGHLIGHT);
  const posed = (await h.snapshot()).menuIndex;

  await h.debug.setScreen("results");
  const after = await h.snapshot();

  await h.advance(1);
  await h.capture("state", "The driven state this point decides");

  assertEqual(
    posed,
    HIGHLIGHT,
    `the highlight setMenuIndex(${HIGHLIGHT}) left on the select screen, ` +
      "which is the scenario this point rests on",
  );
  assertEqual(after.screen, "results", "the screen setScreen shows");
  assertEqual(
    after.menuIndex,
    HIGHLIGHT,
    "menuIndex after a setScreen, which sets nothing else " +
      "(specs/instrumentation.md)",
  );
});
