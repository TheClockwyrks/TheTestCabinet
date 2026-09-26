// screens/mapselect-chooses — choosing a map leads to the difficulty select.
//
// THE REQUIREMENT. `specs/ui.md`, of `mapselect`: "Choosing a map leads to
// `difficultyselect`", and the run it eventually begins is "on the chosen map".
// So the choice does two things at once: it advances the screen, and it fixes
// which of the three topologies of `specs/yard.md` the run will be played on.
// Both are decided here, because a build that advances the screen and forgets the
// choice plays every run on one map.
//
// HOW IT IS DECIDED. Each of the three choices is taken in turn from a freshly
// opened map select, found by the action it carries rather than by where it was
// drawn and pressed at the centre of the rectangle the build itself reported for
// it. The screen and the reported map are read after each.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { MAP_MENU_ACTION, type MapDef, MAPS } from "../constants";
import {
  captureStill,
  createHarness,
  openMenu,
  pressMenu,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it.each(MAPS.map((map) => ({ map })))(
  "reaches the difficulty select on $map.id, and fixes it as the run's map",
  async ({ map }: { map: MapDef }) => {
    await h.debug.reset();
    await openMenu(h, "mapselect");

    await pressMenu(h, MAP_MENU_ACTION[map.id]);
    await captureStill(h, "difficulty");

    const chosen = await h.snapshot();
    assertEqual(
      chosen.screen,
      "difficultyselect",
      `taking ${map.name} from the map select to lead to the difficulty ` +
        "select (specs/ui.md)",
    );
    assertEqual(
      chosen.map,
      map.id,
      `the map the run is fixed to after ${map.name} is chosen (specs/ui.md)`,
    );
  },
);
