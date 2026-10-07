// screens/mapselect-highlights-the-chosen-map — returning from the difficulty
// select highlights the map that was chosen.
//
// THE REQUIREMENT. `specs/ui.md`'s table of what a menu opens on names the row:
// returning to `mapselect` from `difficultyselect` highlights "The map entry that
// was chosen". It is the rule's one row whose entry is not fixed in advance — which
// entry is highlighted depends on which one the player took — so a build that sends
// every return to the first entry passes the other three rows and fails this one.
//
// HOW IT IS DECIDED. The map select is opened directly, so a build with a broken
// title menu still has this point decided on its own terms, and the Switchyard — the
// second of the three, so the first entry is not the answer by accident — is taken
// at the centre of the rectangle the BUILD reported for it. The difficulty select's
// `BACK` choice is then taken, and `menuIndex` is read back against the place that
// map holds in the entries the build reports for the map select.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  type Harness,
  openMenu,
  pressMenu,
} from "../harness";

/** The map that leads away: the second of the three, not the entry a fresh menu opens on. */
const CHOSEN = "map-switchyard";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("highlights the chosen map on the map select returned to", async () => {
  h.debug.reset();
  const entries = openMenu(h, "mapselect");
  const at = entries.findIndex((entry) => entry.action === CHOSEN);
  assertGreaterThan(
    at,
    0,
    `menuButtons() to carry \`${CHOSEN}\` past the entry a fresh menu opens on, ` +
      "so returning to it is a change (specs/instrumentation.md, specs/ui.md)",
  );

  await pressMenu(h, CHOSEN);
  assertEqual(
    h.snapshot().screen,
    "difficultyselect",
    "the screen choosing a map leads to (specs/ui.md)",
  );

  await pressMenu(h, "back");
  captureStill(h, "mapselect");

  const back = h.snapshot();
  assertEqual(
    back.screen,
    "mapselect",
    "the screen the difficulty select's BACK choice returns to (specs/ui.md)",
  );
  assertEqual(
    back.menuIndex,
    at,
    "the entry highlighted on a map select returned to, which is the map that " +
      "was chosen (specs/ui.md)",
  );
});
