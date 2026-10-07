// screens/difficultyselect-starts — choosing a difficulty begins the run.
//
// THE REQUIREMENT. `specs/ui.md`, of `difficultyselect`: "Choosing a difficulty
// begins the run on the chosen map at that difficulty."
// `specs/campaign.md` says what the run it begins looks like: it "opens on its
// first build phase". This is the crossing from the menus into the game, and a
// build that never makes it cannot be played at all, which is why it is the one
// point on this checklist whose failure caps the domains at `broken`.
//
// HOW IT IS DECIDED. The whole route is walked as a player walks it, and only the
// route: the map select is opened directly, a map is chosen at the rectangle the
// build reported for it, and then a difficulty is chosen the same way. Four things
// are read off the run that opened — the screen, the phase, the map that was
// chosen two steps back, and the difficulty just chosen — because the crossing
// carries both choices with it or it has not carried the player anywhere.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { DIFFICULTY_MENU_ACTION, MAP_MENU_ACTION } from "../constants";
import {
  captureStill,
  createHarness,
  openMenu,
  pressMenu,
  type Harness,
} from "../harness";

/** The choices walked: neither is the value a reset leaves behind. */
const MAP = "switchyard";
const DIFFICULTY = "hard";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("opens a run on the chosen map at the chosen difficulty", async () => {
  await h.debug.reset();
  await openMenu(h, "mapselect");
  await pressMenu(h, MAP_MENU_ACTION[MAP]);
  await pressMenu(h, DIFFICULTY_MENU_ACTION[DIFFICULTY]);
  await captureStill(h, "run");

  const run = await h.snapshot();
  assertEqual(
    run.screen,
    "playing",
    "the screen choosing a difficulty begins the run on (specs/ui.md)",
  );
  assertEqual(
    run.phase,
    "build",
    "the phase a run opens on, which is its first build phase " +
      "(specs/campaign.md)",
  );
  assertEqual(
    run.map,
    MAP,
    "the map the run opened on, chosen two steps back (specs/ui.md)",
  );
  assertEqual(
    run.difficulty,
    DIFFICULTY,
    "the difficulty the run opened at (specs/ui.md)",
  );
});
