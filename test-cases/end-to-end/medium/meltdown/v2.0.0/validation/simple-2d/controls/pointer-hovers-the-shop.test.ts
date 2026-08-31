// Meltdown — controls/pointer-hovers-the-shop: moving into a shop entry marks it
// hovered, and moving out clears it.
//
// THE RULE. specs/controls.md says it under the pointer: "Moving into a shop entry
// marks that entry as the one being hovered, and moving out of every shop entry
// clears the hover. Hovering arms nothing and selects nothing."
// specs/instrumentation.md reports the hovered entry as `hoverShop`, and
// specs/hud.md says what it is for: "With a shop entry hovered, that type's
// information at level I."
//
// THREE READINGS, BECAUSE THE RULE HAS THREE CLAUSES. The hover is set; nothing is
// armed and nothing is selected by it; and moving out clears it. The middle clause
// is the one the specification bothers to state, and it is the one a build gets
// wrong by treating a hover as a cheap tap: such a build arms a type the player
// only glanced at, and would sail through a check that read `hoverShop` alone. All
// three are read here because all three are one sentence of the specification.
//
// WHAT THE HOVER PANEL DRAWS IS A DIFFERENT POINT. `hud.shop-hover-panel` reads
// the fields the information area shows for a hovered entry. This point reads the
// field the pointer moves.
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
// from `PANEL_X` rightward and keeps every panel readout and control inside it, so
// a tile's centre is outside every shop rectangle whatever layout the build chose
// — which is what "out of every shop entry" needs, and something no single point
// inside the strip could guarantee.
//
// NOTHING IS PRESSED. Only a move is delivered, because a press and release would
// be the tap `controls.pointer-arms-from-the-shop` reads and would arm the type on
// purpose.
//
// THE MONEY CLEARS THE BLOOM'S BUILD COST, so the entry is not the disabled entry
// of specs/hud.md, whose hover behaviour no specification states.

import { afterEach, beforeEach, it } from "vitest";
import { TOWER_DEFS } from "../../src/constants";
import { assertEqual, assertNull } from "../assert";
import {
  captureStill,
  centreOf,
  createHarness,
  shopEntry,
  startRun,
  type Harness,
} from "../harness";
import { tileCentre } from "../geometry";
import { FREE_SITE, movePointerTo } from "./panel";

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

afterEach(() => {
  h?.dispose();
});

it("marks a shop entry hovered on a move in, arms and selects nothing, and clears it on a move out", async () => {
  startRun(h);
  h.debug.setMoney(BUDGET);
  await h.advance(1);
  const before = h.snapshot();
  assertNull(
    before.hoverShop,
    "posing: the hover the scenario is posed with (specs/controls.md)",
  );

  const entry = centreOf(shopEntry(before.controls, TYPE));
  await movePointerTo(h, entry.x, entry.y);
  captureStill(h, "hover");
  const hovered = h.snapshot();

  assertEqual(
    hovered.hoverShop,
    TYPE,
    `the hovered entry after a move into the reported ${TYPE} shop rectangle ` +
      "(specs/controls.md, The pointer)",
  );
  assertNull(
    hovered.build,
    `the held preview after a move into the ${TYPE} shop rectangle — hovering ` +
      "arms nothing (specs/controls.md, The pointer)",
  );
  assertNull(
    hovered.selected,
    `the selection after a move into the ${TYPE} shop rectangle — hovering ` +
      "selects nothing (specs/controls.md, The pointer)",
  );

  const away = tileCentre(OFF_PANEL.col, OFF_PANEL.row);
  await movePointerTo(h, away.x, away.y);

  assertNull(
    h.snapshot().hoverShop,
    `the hovered entry after a move out onto the floor at tile ` +
      `(${OFF_PANEL.col}, ${OFF_PANEL.row}) — moving out of every shop entry ` +
      "clears the hover (specs/controls.md, The pointer)",
  );
});
