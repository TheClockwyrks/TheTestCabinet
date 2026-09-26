// Wick — screens/chest-shows-evolve-result: an evolution is shown as the
// evolved weapon's icon and name.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/ui.md`, "`chest`", the
// result table: for `kind` `evolve` the overlay shows "The evolved weapon's
// icon and its name from `WEAPON_NAMES`." `specs/evolutions.md`, "Opening a
// chest", makes the result an evolution when "the first base weapon at
// `MAX_WEAPON_LEVEL` whose recipe passive is held" is found, and "The recipe"
// pairs Taper with Wick to give Pyre. `specs/assets.md` gives Pyre's icon its
// path, which this suite spells as `ICON_PATHS`.
//
// THE DRIVE. An isolated `playing` run with every driver switch off, holding
// Taper at `MAX_WEAPON_LEVEL` (`8`) and Wick, and nothing else; a chest posed
// at the lamplighter's own centre and the one tick that collects it. The
// result is read off the snapshot first, so a build whose chest did something
// else fails on the result rather than on the picture.
//
// WHAT THE ICON READING CAN AND CANNOT SEE. The evolved weapon now sits in a
// weapon slot, and `specs/ui.md` leaves it open whether a build draws the HUD
// beneath this overlay, so the icon is read as "the produced file was blitted
// on this frame" rather than as a count. The NAME is the reading no HUD can
// satisfy: `specs/ui.md` draws a slot as an icon with pips and never as words.
//
// THE TOLERANCE. The name is exact as a substring; the icon is a file path
// that either was blitted or was not.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertGreaterThanOrEqual,
  assertTrue,
} from "../assert";
import { ICON_PATHS, MAX_WEAPON_LEVEL, WEAPON_NAMES } from "../constants";
import {
  blitsFrom,
  captureStill,
  createHarness,
  holdPassive,
  holdWeapon,
  isolate,
  openChest,
  type Harness,
} from "../harness";
import { drewText } from "../case-harness/text";

/** The evolution Taper at its top level beside Wick produces. */
const EVOLVED = "pyre";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("draws the evolved weapon's icon and name", async () => {
  isolate(h);
  holdWeapon(h, "taper", MAX_WEAPON_LEVEL);
  holdPassive(h, "wick", 1);

  const overlay = await openChest(h);
  const { calls, blits } = await h.frameDraw();
  captureStill(h, "evolve");

  assertEqual(overlay.screen, "chest", "the screen the frame is read on");
  assertDeepEqual(
    overlay.run.chestResult,
    { kind: "evolve", weapon: EVOLVED },
    "the chest's result (specs/evolutions.md, Opening a chest)",
  );
  assertTrue(
    drewText(calls, WEAPON_NAMES[EVOLVED]),
    `the overlay drew ${WEAPON_NAMES[EVOLVED]}, the evolved weapon's name (specs/ui.md, chest)`,
  );
  assertGreaterThanOrEqual(
    blitsFrom(blits, ICON_PATHS[EVOLVED]).length,
    1,
    `blits of ${ICON_PATHS[EVOLVED]}, the evolved weapon's produced icon`,
  );
});
