// instrumentation/menu-run-uses-the-seed — the menus seed nothing of their own.
//
// `specs/instrumentation.md` puts every random draw behind one seed and one
// operation: "Every random draw runs off a generator `reset` seeds ... The press's
// type and quality rolls, each wave's composition and spawn order, and every crit
// roll all come off it", and "Given the same seed and the same sequence of calls
// and elapsed simulation time, the game reaches the same state every time." It
// then binds the menus to that same path: `startRun` "Enters a run on the current
// map at the current difficulty, THROUGH THE SAME PATH confirming the difficulty
// select takes."
//
// SO THE ROUTE IN IS WHAT THIS READS. `seeded-rolls-repeat` seeds a run and
// re-rolls it through `startRun`, which is the surface's own way in;
// `difficultyselect-starts` walks the menus and reads where they land. Neither
// walks the menus and then reads the rolls. A build that grabs a fresh seed on the
// difficulty confirm — so real playthroughs differ, which is a reasonable thing to
// want — passes both of those and makes every menu-driven run unreproducible: the
// seed a reviewer set is thrown away at the last step before the game begins.
//
// TWO IDENTICAL WALKS, COMPARED. The same seed, the same two menu choices pressed
// at the rectangles the build reported for them, and the same three rocks at the
// same three anchors. What is compared is the ordered sequence of rolls, because
// that is what the seed decides.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  openMenu,
  pressMenu,
  type Harness,
} from "../harness";

/** A seed that is not the default, so a build ignoring `options.seed` shows. */
const SEED = 42;

/** The two menu choices walked. */
const MAP = "substation";
const DIFFICULTY = "medium";

/** Three anchors clear of the Substation's chain, its entry and its collector. */
const ANCHORS = [
  { col: 10, row: 0 },
  { col: 14, row: 0 },
  { col: 18, row: 0 },
];

/** One roll, as the press produced it. */
type Roll = { type: string | null; quality: number | null };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

/** Walk the menus into a run on the seed, place the rocks, and read what they rolled. */
async function walk(): Promise<Roll[]> {
  h.debug.reset({ seed: SEED });
  openMenu(h, "mapselect");
  await pressMenu(h, `map-${MAP}`);
  await pressMenu(h, `difficulty-${DIFFICULTY}`);
  assertEqual(
    h.snapshot().screen,
    "playing",
    "the run the two menu choices opened (specs/ui.md)",
  );

  const rolls: Roll[] = [];
  for (const anchor of ANCHORS) {
    const before = h.snapshot().structures.length;
    h.debug.placeRock(anchor.col, anchor.row);
    const after = h.snapshot();
    assertEqual(
      after.structures.length,
      before + 1,
      `the rock placed at (${anchor.col}, ${anchor.row}) to land a candidate`,
    );
    const landed = after.structures[after.structures.length - 1]!;
    rolls.push({ type: landed.type, quality: landed.quality });
  }
  return rolls;
}

it("rolls the same press twice from two menu-driven runs on one seed", async () => {
  const first = await walk();
  const second = await walk();
  captureStill(h, "rolls");

  assertDeepEqual(
    second,
    first,
    `the rolls of a second run walked into through the menus on seed ${SEED}, ` +
      "against the first: confirming a difficulty seeds nothing of its own " +
      "(specs/instrumentation.md)",
  );
});
