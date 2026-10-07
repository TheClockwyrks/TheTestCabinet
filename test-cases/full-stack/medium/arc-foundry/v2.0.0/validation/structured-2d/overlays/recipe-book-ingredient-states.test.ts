// overlays/recipe-book-ingredient-states — selected, owned, and missing read apart.
//
// `specs/hud.md` fixes three states for every ingredient of every recipe, "told
// apart at a glance": SELECTED when "the current selection is a base structure at
// that ingredient's type and quality", OWNED when "the yard holds a base
// structure at that ingredient's type and quality that is not the current
// selection", and MISSING otherwise.
//
// THE THREE POSES. One Capacitor at Scrap, which `specs/combinations.md` makes the
// second ingredient of the Static Web: gone, standing and not selected, and
// standing and selected. Nothing else is ever on the yard, so the only ingredient
// whose state can move is that one.
//
// WHAT IS DECIDED, AND FROM WHICH READING. The state itself is the game's own, so
// it is read off `recipeEntries`, which `specs/instrumentation.md` has the build
// report per cell — no guessing which pixels belong to which ingredient, and a
// build that marked a DIFFERENT ingredient fails here by name. "Told apart at a
// glance" is about the picture, so it is the one half decided from pixels, and
// only inside the rectangle the build reported for THIS cell: the three states are
// held pairwise apart there, because a build that drew SELECTED and OWNED the same
// way would tell two of the three apart and satisfy neither the rule nor the
// player.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  openYard,
  standComponent,
  type Harness,
} from "../harness";
import { APART, cell, cellPixels, movedPoints, openBook } from "./book";
import type { ComboId, ComponentType, Tier } from "../constants";

/** The Static Web's second ingredient (specs/combinations.md). */
const COMBO: ComboId = "staticweb";
const INGREDIENT = 1;
const TYPE: ComponentType = "capacitor";
const TIER: Tier = 1;
const ANCHOR = { col: 10, row: 10 };

type Pixel = [number, number, number, number];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("draws a selected, an owned, and a missing ingredient three ways", async () => {
  openYard(h);

  /** Arrange the yard with the book closed, then read the cell with it open. */
  const read = async (
    arrange: () => void,
  ): Promise<{ state: string; pixels: Pixel[] }> => {
    h.debug.setOverlay("combos", false);
    arrange();
    openBook(h);
    const pixels = await cellPixels(h, COMBO, INGREDIENT);
    return { state: cell(h, COMBO, INGREDIENT).state, pixels };
  };

  let standing = 0;
  const missing = await read(() => {
    h.debug.clearStructures();
  });
  const owned = await read(() => {
    standing = standComponent(h, TYPE, TIER, ANCHOR.col, ANCHOR.row);
    h.debug.clearSelection();
  });
  const selected = await read(() => {
    h.debug.select(standing);
  });
  captureStill(h, "states");

  // The cell the book reports is the ingredient this check is about.
  const reported = cell(h, COMBO, INGREDIENT);
  assertEqual(
    `${reported.type}@${reported.quality}`,
    `${TYPE}@${TIER}`,
    `the type and quality recipeEntries reports for ingredient ${INGREDIENT} ` +
      `of the ${COMBO} recipe (specs/combinations.md)`,
  );

  assertEqual(
    missing.state,
    "missing",
    "the state the book gives the Capacitor at Scrap with nothing on the yard",
  );
  assertEqual(
    owned.state,
    "owned",
    "the state the book gives the Capacitor at Scrap with one standing on the " +
      "yard and nothing selected",
  );
  assertEqual(
    selected.state,
    "selected",
    "the state the book gives the Capacitor at Scrap with that same structure " +
      "the current selection",
  );

  assertGreaterThanOrEqual(
    movedPoints(owned.pixels, selected.pixels),
    APART,
    "how many points inside the cell's own reported rectangle read differently " +
      "with the ingredient selected than with it merely owned",
  );
  assertGreaterThanOrEqual(
    movedPoints(owned.pixels, missing.pixels),
    APART,
    "how many points inside the cell's own reported rectangle read differently " +
      "with the ingredient missing than with it owned",
  );
  assertGreaterThanOrEqual(
    movedPoints(selected.pixels, missing.pixels),
    APART,
    "how many points inside the cell's own reported rectangle read differently " +
      "with the ingredient missing than with it selected",
  );
});
