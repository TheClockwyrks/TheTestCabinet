// input/menu-confirm — the confirm action takes the entry at the current index.
//
// THE REQUIREMENT. `specs/ui.md`: "the confirm action takes the highlighted
// entry". `specs/controls.md` binds `confirm` to `Enter`. The requirement is
// specifically that confirm takes the entry the highlight is ON, so a build that
// always takes the first entry, or that is off by one, fails here even though its
// menu draws correctly and its destinations are right.
//
// HOW IT IS DECIDED. The map select is the menu it is decided on: `specs/ui.md`
// gives it four entries that lead to three different places, so taking the wrong
// one is visible. Every entry is highlighted in turn and confirmed with a real key
// event dispatched at the engine's own surface, and where the game landed is read
// against where THAT entry leads: a map choice leads to the difficulty select and
// fixes the map the run will open on, and `BACK` leads to the title. Which entry
// sits at which index is read off the build's own `menuButtons`, in the order it
// presents them, so no layout and no ordering is assumed.

import { afterEach, beforeEach, it } from "vitest";

import { MAP_IDS, type MapId } from "../../src/constants";
import { assertEqual, fail } from "../assert";
import {
  captureStill,
  createHarness,
  openMenu,
  pressAction,
  type Harness,
} from "../harness";

/**
 * The map each map-choosing action fixes, keyed the other way round.
 *
 * `MENU_ACTIONS` names a map's choice `map-<id>` (specs/instrumentation.md), so
 * the pairing is the case's own rather than a guess about the build's ordering.
 */
const MAP_OF_ACTION = new Map<string, MapId>(
  MAP_IDS.map((id) => [`map-${id}`, id]),
);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("takes exactly the entry the highlight is on", async () => {
  h.debug.reset();
  const entries = openMenu(h, "mapselect");

  for (const [index, entry] of entries.entries()) {
    h.debug.reset();
    openMenu(h, "mapselect");
    h.debug.setMenuIndex(index);
    await pressAction(h, "confirm");
    if (index === 0) captureStill(h, "confirm");

    const landed = h.snapshot();
    const map = MAP_OF_ACTION.get(entry.action);

    if (map !== undefined) {
      assertEqual(
        landed.screen,
        "difficultyselect",
        `confirming entry ${index} of the map select, which is the ` +
          `\`${entry.action}\` choice, to lead to the difficulty select ` +
          "(specs/ui.md)",
      );
      assertEqual(
        landed.map,
        map,
        `the map fixed by confirming entry ${index}, the \`${entry.action}\` ` +
          "choice (specs/ui.md)",
      );
    } else if (entry.action === "back") {
      assertEqual(
        landed.screen,
        "title",
        `confirming entry ${index} of the map select, which is its BACK ` +
          "choice, to return to the title (specs/ui.md)",
      );
    } else {
      fail(
        "the map select to present its three maps and a BACK choice and " +
          "nothing else (specs/ui.md, specs/instrumentation.md)",
        `entry ${index} carries the action \`${entry.action}\``,
      );
    }
  }
});
