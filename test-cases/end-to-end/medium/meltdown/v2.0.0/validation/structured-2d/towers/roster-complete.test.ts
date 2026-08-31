// towers/roster-complete — every one of the eight is buildable, and the shop lists
// all eight in roster order.
//
// THE RULE. specs/towers.md opens "Eight towers stand on the floor: six emitters
// that fire, and the Forge and the Sink"; `src/constants.ts` fixes them in SHOP
// ORDER as `TOWER_TYPES`, and specs/hud.md draws the shop as one entry per type in
// that order. specs/building.md gives what each one must then do: arming holds a
// preview of the type, the held footprint reads valid on open floor the money
// covers, and placing commits a tower of that type on that footprint.
//
// WHY THIS IS THE GROUP'S BROKEN-CAPPED ITEM. A missing tower is not a wrong
// figure, it is a tower a player cannot build at all, and every other item in this
// group reads a tower that this one says exists. So the reading walks the whole
// roster and names the type that failed rather than merely reporting that one did.
//
// THE THREE STEPS ARE READ SEPARATELY FOR EACH TYPE, because they fail
// differently: a build whose shop entry arms nothing fails at the arm, one whose
// placement check refuses an open anchor fails at the preview, and one whose
// `place` builds a different type fails at the commit. Each failure names its step
// and its type.
//
// EIGHT QUIET ANCHORS, one per type, each clear of both vent-to-exhaust corridors
// and six tiles from the next, so no placement seals a route and no pair abuts.
// specs/building.md's validity check includes the never-seal rule, so a scenario
// that walled a corridor would refuse a placement for a reason that has nothing to
// do with whether the type is buildable.
//
// THE PURSE IS POSED ABOVE THE WHOLE ROSTER'S COST, because condition 4 of that
// same check is affordability and condition 4 is not what this item decides —
// `building/preview-invalid-when-unaffordable` is. With the money clear of every
// cost, a refused footprint is a refused footprint and not an empty purse.
//
// THE SHOP IS READ AS AN ORDERED LIST OF TYPES, not as a set: the order is what
// `arm1` .. `arm8` and the shop's own layout rest on, so a build carrying all eight
// in the wrong order is a different build from one carrying all eight.

import { afterEach, beforeEach, it } from "vitest";
import { TOWER_TYPES } from "../../src/constants";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  placeAt,
  startRun,
  type Harness,
} from "../harness";
import {
  costOf,
  freeSite,
  heldPreview,
  requirePlaced,
  towerOf,
} from "./roster";

/** The eight, in the shop order `src/constants.ts` fixes (specs/towers.md). */
const ROSTER = [...TOWER_TYPES];

/**
 * The money posed before the walk: every build cost on the roster, and the same
 * again over.
 *
 * Affordability is condition 4 of specs/building.md's validity check and is another
 * item's requirement, so it is put out of reach here rather than tested.
 */
const PURSE = 2 * ROSTER.reduce((total, type) => total + costOf(type), 0);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("arms, previews and places every one of the eight, in shop order", async () => {
  startRun(h);
  h.debug.setMoney(PURSE);

  assertDeepEqual(
    h.snapshot().controls.shop.map((entry) => entry.type),
    ROSTER,
    "the types the build panel's shop entries arm, in shop order " +
      "(specs/hud.md, specs/towers.md)",
  );

  for (const [index, type] of ROSTER.entries()) {
    const at = freeSite(index);

    h.debug.setArmed(type);
    assertEqual(
      heldPreview(h, `arming ${type}`).type,
      type,
      `the type held after arming ${type} (specs/building.md, Arming a type)`,
    );

    h.debug.setPreview(at.col, at.row);
    const held = heldPreview(h, `previewing ${type}`);
    assertEqual(
      held.valid,
      true,
      `the held ${type} footprint at (${at.col}, ${at.row}) reading valid on ` +
        `open floor with ${PURSE} in the purse (specs/building.md, Valid and ` +
        `invalid)`,
    );

    const id = requirePlaced(
      placeAt(h, type, at.col, at.row),
      `placing a ${type} at (${at.col}, ${at.row})`,
    );
    const built = towerOf(h.snapshot(), id);
    assertEqual(built.type, type, `the type the placed tower reports`);
    assertEqual(built.col, at.col, `the column the placed ${type} anchored on`);
    assertEqual(built.row, at.row, `the row the placed ${type} anchored on`);
  }

  await h.advance(1);
  captureStill(h, "roster");

  assertEqual(
    h.snapshot().towers.length,
    ROSTER.length,
    "towers standing on the floor after one of every type was placed",
  );
});
