// overlays/recipe-book-blockers-not-owned — a wall and a tower own nothing.
//
// `specs/hud.md`: "blockers and combination towers are never ingredients and
// never count as owned." `specs/scrap-press.md` gives a blocker "no type, no
// quality", and `specs/combinations.md` states that "a combination tower is never
// an ingredient".
//
// So a yard holding a blocker and a Static Web — a tower whose own recipe is three
// base components — must read exactly like an empty yard in the book: every one of
// the book's ingredient cells still Missing. The control is the third pose, a
// Capacitor at Scrap, which `specs/combinations.md` makes an ingredient of the
// Static Web and of no other recipe among the twelve. Without it, a book that never
// marked anything owned would pass this point by marking nothing.
//
// EVERY CELL IS READ, BY NAME. `specs/instrumentation.md` has the build report each
// ingredient cell it draws and the state it drew it in, so what is decided here is
// the state of every cell in every recipe rather than whether some pixel of the
// overlay moved. A build that marked one unrelated ingredient owned on a blocker
// fails, and the failure names the cell.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  openYard,
  recipeEntries,
  standBlocker,
  standCombo,
  standComponent,
  type Harness,
} from "../harness";
import { describe } from "./book";
import type { ComboId, ComponentType, Tier } from "../constants";

/** The Static Web's Capacitor at Scrap (specs/combinations.md). */
const COMBO: ComboId = "staticweb";
const TYPE: ComponentType = "capacitor";
const TIER: Tier = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

/** Every cell the book is not drawing as Missing, named. */
function marked(): string[] {
  return recipeEntries(h)
    .filter((e) => e.state !== "missing")
    .map(describe);
}

it("counts neither a blocker nor a tower as an ingredient", async () => {
  openYard(h);
  h.debug.setOverlay("combos", true);

  const cells = recipeEntries(h);
  assertGreaterThan(
    cells.length,
    0,
    "how many ingredient cells the recipe book reports while it is open " +
      "(specs/instrumentation.md)",
  );

  // An empty yard owns nothing.
  assertEqual(
    marked().join(", "),
    "",
    "which ingredient cells the book marks over an empty yard (specs/hud.md)",
  );

  // A blocker and a combination tower own nothing either.
  standBlocker(h, 10, 10);
  standCombo(h, COMBO, 14, 10);
  captureStill(h, "book");
  assertEqual(
    marked().join(", "),
    "",
    "which ingredient cells the book marks while the yard holds a blocker and " +
      "a Static Web, neither of which is ever an ingredient (specs/hud.md)",
  );

  // A base component does, which is what makes the two readings above a verdict.
  h.debug.clearStructures();
  standComponent(h, TYPE, TIER, 10, 10);
  const owned = recipeEntries(h).filter((e) => e.state === "owned");
  assertEqual(
    owned.map(describe).join(", "),
    `${COMBO}[${cells
      .filter((c) => c.combo === COMBO)
      .findIndex((c) => c.type === TYPE)}] ${TYPE}@${TIER} = owned`,
    `which ingredient cells the book marks owned while the yard holds one ` +
      `${TYPE} at tier ${TIER}, which only the ${COMBO}'s recipe calls for ` +
      "(specs/combinations.md, specs/hud.md)",
  );
});
