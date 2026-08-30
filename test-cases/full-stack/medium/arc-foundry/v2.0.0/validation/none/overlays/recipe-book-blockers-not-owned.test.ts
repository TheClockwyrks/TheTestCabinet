// overlays/recipe-book-blockers-not-owned — a wall and a tower own nothing.
//
// `specs/hud.md`: "blockers and combination towers are never ingredients and
// never count as owned." `specs/scrap-press.md` gives a blocker "no type, no
// quality", and `specs/combinations.md` states that "a combination tower is never
// an ingredient".
//
// So a yard holding a blocker and a Static Web — a tower whose own recipe is
// three base components — must read exactly like an empty yard in the book. The
// control is the third pose: a Capacitor at Scrap, one of the Static Web's
// ingredients, which must move the book. Without it a book that never marked
// anything owned would pass this point by drawing nothing.
//
// The comparison is over the book's own points, found by the double difference
// `book.ts` describes, so the blocker's and the tower's sprites on the yard are
// not what is being read.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  openYard,
  standBlocker,
  standCombo,
  standComponent,
  type Harness,
} from "../harness";
import type { ComponentType, Tier } from "../constants";

import { readBook, movedPoints, type Pose } from "./book";

/** An ingredient of the Static Web (specs/combinations.md). */
const TYPE: ComponentType = "capacitor";
const TIER: Tier = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("counts neither a blocker nor a tower as an ingredient", async () => {
  await openYard(h);

  const poses: Pose[] = [
    {
      name: "empty",
      arrange: async (harness) => {
        await harness.debug.clearStructures();
      },
    },
    {
      name: "a blocker and a tower",
      arrange: async (harness) => {
        await harness.debug.clearStructures();
        await standBlocker(harness, 10, 10);
        await standCombo(harness, "staticweb", 14, 10);
      },
    },
    {
      name: "a Capacitor at Scrap",
      arrange: async (harness) => {
        await harness.debug.clearStructures();
        await standComponent(harness, TYPE, TIER, 10, 10);
      },
    },
  ];

  const read = await readBook(h, "combos", poses);
  await captureStill(h, "book");
  assertGreaterThan(
    read.points,
    0,
    "how many points of the stage the recipe book was found to paint",
  );

  const [empty, walled, owned] = read.open as [
    (typeof read.open)[number],
    (typeof read.open)[number],
    (typeof read.open)[number],
  ];
  assertGreaterThan(
    movedPoints(empty, owned),
    0,
    "how many of the book's points a Capacitor at Scrap moves, which is what " +
      "an ingredient becoming owned looks like",
  );
  assertEqual(
    movedPoints(empty, walled),
    0,
    "how many of the book's points a blocker and a combination tower move, " +
      "neither of which is ever an ingredient",
  );
});
