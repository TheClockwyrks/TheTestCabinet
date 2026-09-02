// Meltdown — controls/pointer-hovers-the-shop: moving into a shop entry marks it
// hovered, and moving out clears it.
//
// THE RULE. specs/controls.md says it under The pointer: "Moving into a shop entry
// marks that entry as the one being hovered, and moving out of every shop entry
// clears the hover. Hovering arms nothing and selects nothing."
// specs/instrumentation.md reports the hovered entry as `hoverShop`, and
// specs/hud.md says what it is for: "With a shop entry hovered, that type's
// information at level I."
//
// THREE READINGS, BECAUSE THE RULE HAS THREE CLAUSES. The hover is set; nothing is
// armed and nothing is selected by it; and moving out clears it. The middle clause
// is the one the specification bothers to state, and the one a build gets wrong by
// treating a hover as a cheap tap: such a build arms a type the player only
// glanced at, and would sail through a check that read `hoverShop` alone.
//
// WHAT THE HOVER PANEL DRAWS IS A DIFFERENT ITEM. `hud.shop-hover-panel` reads the
// fields the information area shows for a hovered entry. This item reads the field
// the pointer moves.
//
// THE RECTANGLE IS THE BUILD'S OWN, read off the snapshot, because specs/hud.md
// leaves "Where each element sits inside the strip" to the build and
// specs/instrumentation.md reports each rectangle so a scenario can operate the
// panel the build laid out.
//
// THE BLOOM, which is neither the first nor the last of the eight entries, so a
// build whose rectangles are shifted by one row reads as hovering a neighbour
// rather than as hovering nothing.
//
// MOVING OUT MEANS ONTO THE FLOOR. specs/floor.md confines the panel to its strip
// from `PANEL_X` rightward, so a tile's centre is outside every shop rectangle
// whatever layout the build chose — which is what "out of every shop entry" needs,
// and something no single point inside the strip could guarantee.
//
// NOTHING IS PRESSED. Only a pointer MOVE is delivered, because a press and
// release would be the tap `controls.pointer-arms-from-the-shop` reads and would
// arm the type on purpose.
//
// THE MONEY CLEARS THE BLOOM'S BUILD COST, so the entry is not specs/hud.md's
// disabled entry, whose hover behaviour no specification states.

import { afterEach, beforeEach, it } from "vitest";
import { TOWER_DEFS } from "../constants";
import { assertEqual, assertNull } from "../assert";
import {
  captureStill,
  createHarness,
  movePointerTo,
  rectCenter,
  startRun,
  tileCenter,
  type Harness,
} from "../harness";
import { QUIET_SITE, requireShopEntry } from "./scene";

/** The entry hovered: a middle one of the eight. */
const TYPE = "bloom";

/** The money the run is posed with: twice the Bloom's build cost. */
const PURSE = 2 * TOWER_DEFS[TYPE].cost;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("marks a shop entry hovered on a move in, arms and selects nothing, and clears it on a move out", async () => {
  startRun(h);
  h.debug.setMoney(PURSE);
  await h.advance(1);

  const before = h.snapshot();
  assertNull(before.hoverShop, "the hover the scenario is posed with");

  const entry = rectCenter(
    requireShopEntry(before, TYPE, "hovering the shop entry"),
  );
  await movePointerTo(h, entry.x, entry.y);
  captureStill(h, "hover");

  const hovered = h.snapshot();
  assertEqual(
    hovered.hoverShop,
    TYPE,
    `the hovered entry after a move into the reported ${TYPE} shop rectangle`,
  );
  assertNull(
    hovered.build,
    `the held preview after a move into the ${TYPE} shop rectangle, which hovering arms nothing`,
  );
  assertNull(
    hovered.selected,
    `the selection after a move into the ${TYPE} shop rectangle, which hovering selects nothing`,
  );

  const offPanel = tileCenter(QUIET_SITE.col, QUIET_SITE.row);
  await movePointerTo(h, offPanel.x, offPanel.y);

  assertNull(
    h.snapshot().hoverShop,
    `the hovered entry after a move out onto the floor at tile (${QUIET_SITE.col}, ${QUIET_SITE.row})`,
  );
});
