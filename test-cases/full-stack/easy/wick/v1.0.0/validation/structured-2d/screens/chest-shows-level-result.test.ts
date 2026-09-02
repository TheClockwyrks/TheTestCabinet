// Wick — screens/chest-shows-level-result: a level is shown as the item's
// icon, its name, and the level it became.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/ui.md`, "`chest`", the
// result table: for `kind` `level` the overlay shows "The item's icon and
// name, and `LEVEL_LABEL` with the level it became."
// `specs/evolutions.md`, "Opening a chest", reaches that result when nothing
// can evolve: "One held item below its max level ... is chosen uniformly at
// random from the game's seeded generator and rises by `1` ... The result is
// `{ kind: "level", item, level }`, with `level` the level it became."
//
// THE DRIVE. An isolated `playing` run with every driver switch off, holding
// Ember at level `HELD_LEVEL` (`3`) and nothing else. Ember is below
// `MAX_WEAPON_LEVEL` so no evolution is possible, and it is the ONLY item
// below a maximum, so the random choice has one candidate and the result is
// Ember at level `4` whatever the generator draws. A chest posed at the
// lamplighter's own centre and the one tick that collects it open the overlay.
//
// WHY THE RUN'S OWN LEVEL IS FAR AWAY. The HUD draws `LEVEL_LABEL` beside the
// lamplighter's level too (`specs/ui.md`, `playing`), and the isolation poses
// that level at `ISOLATE_LEVEL` (`50`), whose digits cannot be read as the
// result's `4`.
//
// WHAT THE ICON READING CAN AND CANNOT SEE. The levelled item sits in a weapon
// slot, and `specs/ui.md` leaves it open whether a build draws the HUD beneath
// this overlay, so the icon is read as "the produced file was blitted on this
// frame" rather than as a count. The NAME and the level are readings no HUD
// can satisfy: `specs/ui.md` draws a slot as an icon with pips and never as
// words, and the HUD's own `LEVEL` reads the lamplighter's level.
//
// THE TOLERANCE. The name is exact as a substring; the level reading is
// `LEVEL_LABEL` followed by the level with any run of spaces between them,
// which is the form `specs/ui.md` spells, and the digits must stand as their
// own token; the icon is a file path that either was blitted or was not.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertGreaterThanOrEqual,
  assertTrue,
} from "../assert";
import {
  ICON_PATHS,
  LEVEL_LABEL,
  MAX_WEAPON_LEVEL,
  WEAPON_NAMES,
} from "../constants";
import {
  blitsFrom,
  captureStill,
  createHarness,
  drawnText,
  drewText,
  holdWeapon,
  isolate,
  openChest,
  type Harness,
} from "../harness";

/** The one item held below a maximum, so the chest's level result is certain. */
const ITEM = "ember";
const HELD_LEVEL = 3;
const BECAME = HELD_LEVEL + 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("draws the levelled item's icon, name, and new level", async () => {
  if (!(HELD_LEVEL < MAX_WEAPON_LEVEL)) {
    throw new Error("the held level must leave the weapon below its maximum");
  }

  isolate(h);
  holdWeapon(h, ITEM, HELD_LEVEL);

  const overlay = await openChest(h);
  const { calls, blits } = await h.frameDraw();
  captureStill(h, "level");

  assertEqual(overlay.screen, "chest", "the screen the frame is read on");
  assertDeepEqual(
    overlay.run.chestResult,
    { kind: "level", item: ITEM, level: BECAME },
    "the chest's result (specs/evolutions.md, Opening a chest)",
  );
  assertTrue(
    drewText(calls, WEAPON_NAMES[ITEM]),
    `the overlay drew ${WEAPON_NAMES[ITEM]}, the item's name (specs/ui.md, chest)`,
  );
  const tag = new RegExp(`${LEVEL_LABEL}\\s*${BECAME}(?![\\w])`, "i");
  assertTrue(
    drawnText(calls).some((line) => tag.test(line)),
    `a run of text reading ${LEVEL_LABEL} ${BECAME}, the level the item became (specs/ui.md, chest)`,
  );
  assertGreaterThanOrEqual(
    blitsFrom(blits, ICON_PATHS[ITEM]).length,
    1,
    `blits of ${ICON_PATHS[ITEM]}, the item's produced icon`,
  );
});
