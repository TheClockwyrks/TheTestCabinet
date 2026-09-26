// Arc Foundry — audio/combine: the combine cue sounds when a fold resolves, of
// either kind, and on no frame before it.
//
// THE REQUIREMENT, from the cue table of `specs/ui.md`: `CUES.combine` is played
// when "a combine of either kind resolves", and each cue is played "on the update
// its event happens, and at most once on that update". `specs/scrap-press.md` fixes
// the two kinds: a quality-combine, where "two base structures of the same type and
// the same quality fold into one structure of that type one tier higher", and a
// recipe-combine, which "folds the exact multiset of base `(type, quality)`
// ingredients a combination tower's recipe demands into that tower".
//
// BOTH KINDS ARE DRIVEN, because the requirement names both. Each runs on its own
// emptied yard, and both fold standing components rather than candidates — a
// combine that consumes a candidate is the level's harvest and starts the wave,
// which would put a wave's own events under the reading.
//
// WHY THIS ONE IS COUNTED ACROSS THE CALL. A combine is a CONTROL's event:
// `specs/scrap-press.md` has it "resolve the instant it is committed", and
// `specs/instrumentation.md` has `combine` commit through that same control. A
// build may sound the cue there or on the update that follows, so what is counted
// is every sound across the commit and the frame after it.
//
// THE RUN-UP IS HELD SILENT, so a build that blips every frame fails before the
// fold rather than passing on it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { comboDef } from "../constants";
import {
  captureReplay,
  createHarness,
  emptyYard,
  openYard,
  standComponent,
  structureAt,
  type Harness,
} from "../harness";
import { RUN_UP, firstSound, sounds } from "./cues";

/** The recipe `specs/combinations.md` gives the Static Web, all at Scrap. */
const RECIPE = comboDef("staticweb");

/** Four clear anchors, well away from the map's waypoint platforms and its chain. */
const ANCHORS = [
  { col: 16, row: 18 },
  { col: 20, row: 18 },
  { col: 24, row: 18 },
  { col: 28, row: 18 },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness({ armAudio: true });
});

afterEach(async () => {
  await h.dispose();
});

/** Commit one fold from `initiator` and report what was heard across it. */
async function fold(
  outputId: string,
  initiator: number,
): Promise<{ before: number; after: number }> {
  await h.advance(1);
  const opening = await sounds(h);
  await h.advance(RUN_UP);
  const settled = await sounds(h);

  return captureReplay(h, outputId, async () => {
    await h.debug.combine(initiator);
    await h.advance(1);
    return { before: settled - opening, after: (await sounds(h)) - settled };
  });
}

it("sounds when a quality fold and a recipe fold resolve, and not before", async () => {
  await openYard(h, { wave: 1 });
  await firstSound(h);

  // A quality-combine: two Scrap Capacitors fold into one Tuned Capacitor.
  const pair = await standComponent(
    h,
    "capacitor",
    1,
    ANCHORS[0]!.col,
    ANCHORS[0]!.row,
  );
  await standComponent(h, "capacitor", 1, ANCHORS[1]!.col, ANCHORS[1]!.row);
  const quality = await fold("combine", pair);

  assertEqual(
    quality.before,
    0,
    "nothing to sound over the frames before a quality fold is committed " +
      "(specs/ui.md)",
  );
  assertEqual(
    structureAt(await h.snapshot(), ANCHORS[0]!.col, ANCHORS[0]!.row)?.quality,
    2,
    "two Scrap Capacitors to fold into one Tuned Capacitor at the initiating " +
      "footprint (specs/scrap-press.md)",
  );
  assertGreaterThan(
    quality.after,
    0,
    "a cue to sound when a quality fold resolves (specs/ui.md)",
  );

  // A recipe-combine: the Static Web's three Scrap ingredients fold into a tower.
  await emptyYard(h);
  const ingredients: number[] = [];
  for (const [index, ingredient] of RECIPE.recipe.entries()) {
    ingredients.push(
      await standComponent(
        h,
        ingredient.type,
        ingredient.tier,
        ANCHORS[index]!.col,
        ANCHORS[index]!.row,
      ),
    );
  }
  const recipe = await fold("combine", ingredients[0]!);

  assertEqual(
    recipe.before,
    0,
    "nothing to sound over the frames before a recipe fold is committed " +
      "(specs/ui.md)",
  );
  assertEqual(
    structureAt(await h.snapshot(), ANCHORS[0]!.col, ANCHORS[0]!.row)?.type,
    RECIPE.id,
    `the Static Web's three ingredients to fold into it at the initiating ` +
      `footprint (specs/scrap-press.md)`,
  );
  assertGreaterThan(
    recipe.after,
    0,
    "a cue to sound when a recipe fold resolves (specs/ui.md)",
  );
});
