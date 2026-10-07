// Meltdown — controls/pointer-hovers-the-shop: moving into a shop entry marks it
// hovered, and moving out clears it.
//
// specs/controls.md says it under the pointer: "Moving into a shop entry marks that
// entry as the one being hovered, and moving out of every shop entry clears the
// hover. Hovering arms nothing and selects nothing." specs/instrumentation.md
// reports the hovered entry as `hoverShop`, and specs/hud.md says what it is for:
// "With a shop entry hovered, that type's information at level I."
//
// THREE READINGS, BECAUSE THE RULE HAS THREE CLAUSES. The hover is set; nothing is
// armed and nothing is selected by it; and moving out clears it. The middle clause
// is the one the specification bothers to state, and it is the one a build gets
// wrong by treating a hover as a cheap tap: such a build arms a type the player only
// glanced at, and would sail through a check that read `hoverShop` alone. All three
// are read here because all three are one sentence of the specification.
//
// WHAT THE HOVER PANEL DRAWS IS A DIFFERENT POINT. `hud.shop-hover-panel` reads the
// fields the information area shows for a hovered entry. This point reads the field
// the pointer moves.
//
// THE RECTANGLE IS THE BUILD'S OWN, read off the snapshot, because specs/hud.md
// leaves "Where each element sits inside the strip" to the build and
// specs/instrumentation.md reports each rectangle so a scenario can operate the
// panel the build laid out.
//
// THE BLOOM, which is neither the first nor the last of the eight entries, so a
// build whose rectangles are shifted by one row reads as hovering a neighbour rather
// than as hovering nothing.
//
// MOVING OUT MEANS ONTO THE FLOOR. specs/floor.md confines the panel to its strip
// from `PANEL_X` rightward and states that "no panel readout or control is drawn on
// the floor", so a tile's centre is outside every shop rectangle whatever layout the
// build chose — which is what "out of every shop entry" needs, and something no
// single point inside the strip could guarantee.
//
// NOTHING IS PRESSED. Only `pointerMove` is used (specs/instrumentation.md: "Reports
// a move to that position"), because a press and release would be the tap that
// `controls.pointer-arms-from-the-shop` reads and would arm the type on purpose.
//
// THE MONEY CLEARS THE BLOOM'S BUILD COST, so the entry is not the disabled entry of
// specs/hud.md, whose hover behaviour no specification states.

import { afterEach, beforeEach, it } from "vitest";
import { TOWER_DEFS, tileCX, tileCY } from "../constants";
import { assertEqual, assertNull } from "../assert";
import {
  captureStill,
  createHarness,
  shopControl,
  startRun,
  type Harness,
} from "../harness";
import { FREE_SITE } from "../fixtures";

/** The entry hovered: a middle one of the eight. */
const TYPE = "bloom";

/** The money the run is posed with: twice the Bloom's build cost. */
const BUDGET = 2 * TOWER_DEFS[TYPE].cost;

/** Where the pointer moves to leave the panel: a tile's centre on the floor. */
const OFF_PANEL = FREE_SITE;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("marks a shop entry hovered on a move in, arms and selects nothing, and clears it on a move out", async () => {
  await startRun(h);
  await h.debug.setMoney(BUDGET);
  await h.advance(1);
  const before = await h.snapshot();
  assertNull(before.hoverShop, "the hover the scenario is posed with");

  const entry = shopControl(before, TYPE, "hovering the shop entry");
  await h.debug.pointerMove(entry.x + entry.w / 2, entry.y + entry.h / 2);
  await h.advance(1);
  const hovered = await h.snapshot();
  await captureStill(h, "hover");

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

  await h.debug.pointerMove(tileCX(OFF_PANEL.col), tileCY(OFF_PANEL.row));
  await h.advance(1);
  const left = await h.snapshot();

  assertNull(
    left.hoverShop,
    `the hovered entry after a move out onto the floor at tile (${OFF_PANEL.col}, ${OFF_PANEL.row})`,
  );
});
