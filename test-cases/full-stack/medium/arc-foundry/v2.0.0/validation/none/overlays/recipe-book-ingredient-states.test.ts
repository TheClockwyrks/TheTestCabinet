// overlays/recipe-book-ingredient-states — selected, owned, and missing read apart.
//
// `specs/hud.md` fixes three states for every ingredient of every recipe, "told
// apart at a glance": SELECTED when "the current selection is a base structure at
// that ingredient's type and quality", OWNED when "the yard holds a base
// structure at that ingredient's type and quality that is not the current
// selection", and MISSING otherwise.
//
// THE THREE POSES. One Capacitor at Scrap, which `specs/combinations.md` makes an
// ingredient of the Static Web: standing and selected, standing and not selected,
// and gone. Nothing else is ever on the yard, so the only ingredient whose state
// can move is that one.
//
// WHAT IS SAMPLED. The book's own points, found by the double difference
// `book.ts` describes: the yard changes under all three poses, so the points the
// yard moves are excluded and the comparison reads the overlay alone. The three
// states are held pairwise apart, because a build that drew SELECTED and OWNED
// the same way would tell two of the three apart and satisfy neither the rule nor
// the player.

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

/** An ingredient of the Static Web (specs/combinations.md). */
const TYPE: ComponentType = "capacitor";
const TIER: Tier = 1;
const ANCHOR = { col: 10, row: 10 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws a selected, an owned, and a missing ingredient three ways", async () => {
  await openYard(h);

  let standing: number | null = null;
  const stand = async (): Promise<number> => {
    if (standing === null) {
      standing = await standComponent(h, TYPE, TIER, ANCHOR.col, ANCHOR.row);
    }
    return standing;
  };

  const poses: Pose[] = [
    {
      name: "owned",
      arrange: async (harness) => {
        await stand();
        await harness.debug.clearSelection();
      },
    },
    {
      name: "selected",
      arrange: async (harness) => {
        await harness.debug.select(await stand());
      },
    },
    {
      name: "missing",
      arrange: async (harness) => {
        await harness.debug.clearStructures();
        standing = null;
      },
    },
  ];

  const read = await readBook(h, "combos", poses);
  await captureStill(h, "states");
  assertGreaterThan(
    read.points,
    0,
    "how many points of the stage the recipe book was found to paint",
  );

  const [owned, selected, missing] = read.open as [
    (typeof read.open)[number],
    (typeof read.open)[number],
    (typeof read.open)[number],
  ];
  assertGreaterThan(
    movedPoints(owned, selected),
    0,
    "how many of the book's points read differently with the ingredient " +
      "selected than with it merely owned",
  );
  assertGreaterThan(
    movedPoints(owned, missing),
    0,
    "how many of the book's points read differently with the ingredient " +
      "missing than with it owned",
  );
  assertGreaterThan(
    movedPoints(selected, missing),
    0,
    "how many of the book's points read differently with the ingredient " +
      "missing than with it selected",
  );
});
