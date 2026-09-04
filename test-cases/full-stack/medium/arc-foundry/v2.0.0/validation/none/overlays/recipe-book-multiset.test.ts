// overlays/recipe-book-multiset — one structure covers one ingredient, not two.
//
// `specs/hud.md`: "ownership counts as a multiset, so a recipe calling for two
// ingredients at the same type and quality reads as covered only when the yard
// holds two."
//
// A SPECIFICATION GAP, AND WHAT IS DECIDED INSTEAD. None of the twelve recipes in
// `specs/combinations.md` calls for two ingredients at the same type AND quality;
// the nearest is the Singularity, which "calls for two Arc-Nodes at different
// tiers", and `specs/combinations.md` states the counting rule there: "a recipe is
// satisfied only when the yard holds every ingredient it lists, counted as a
// multiset". So the requirement is instantiated at the one recipe the twelve
// provide: a yard holding a single Arc-Node has covered ONE of the Singularity's
// two Arc-Node ingredients, and standing the second one has to move the book
// again. A build that counted ownership by type, or that let one structure
// satisfy every ingredient naming it, marks both on the first Arc-Node and moves
// nothing on the second.
//
// Both tiers appear in that one recipe and nowhere else in the twelve, so each
// step moves exactly one ingredient of one recipe.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  openYard,
  standComponent,
  type Harness,
} from "../harness";
import type { ComponentType, Tier } from "../constants";
import { readBook, movedPoints, type Pose } from "./book";

/** The Singularity's two Arc-Nodes (specs/combinations.md). */
const TYPE: ComponentType = "arcnode";
const FIRST: Tier = 2;
const SECOND: Tier = 5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("covers the second Arc-Node only once a second one stands", async () => {
  await openYard(h);

  const poses: Pose[] = [
    {
      name: "neither",
      arrange: async (harness) => {
        await harness.debug.clearStructures();
      },
    },
    {
      name: "one",
      arrange: async (harness) => {
        await harness.debug.clearStructures();
        await standComponent(harness, TYPE, FIRST, 10, 10);
      },
    },
    {
      name: "both",
      arrange: async (harness) => {
        await harness.debug.clearStructures();
        await standComponent(harness, TYPE, FIRST, 10, 10);
        await standComponent(harness, TYPE, SECOND, 14, 10);
      },
    },
  ];

  const read = await readBook(h, "combos", poses);
  await captureStill(h, "multiset");
  assertGreaterThan(
    read.points,
    0,
    "how many points of the stage the recipe book was found to paint",
  );

  const [neither, one, both] = read.open as [
    (typeof read.open)[number],
    (typeof read.open)[number],
    (typeof read.open)[number],
  ];
  assertGreaterThan(
    movedPoints(neither, one),
    0,
    `how many of the book's points the first Arc-Node at tier ${FIRST} moves`,
  );
  assertGreaterThan(
    movedPoints(one, both),
    0,
    `how many of the book's points the second Arc-Node at tier ${SECOND} ` +
      "moves, which is what the first one may not have covered already",
  );
});
