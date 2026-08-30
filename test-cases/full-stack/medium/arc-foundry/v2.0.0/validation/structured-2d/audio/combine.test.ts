// Arc Foundry — audio/combine: the combine cue sounds when a fold resolves, of
// either kind, and on no frame before it.
//
// THE REQUIREMENT, from the cue table of `specs/ui.md`: `CUES.combine` is played
// when "a combine of either kind resolves", and each cue is played "on the frame
// its event happens, by the code that raised it, and at most once on that frame".
// `specs/scrap-press.md` fixes the two kinds: a quality-combine, where "two base
// structures of the same type and the same quality fold into one structure of that
// type one tier higher", and a recipe-combine, which "folds the exact multiset of
// base `(type, quality)` ingredients a combination tower's recipe demands into that
// tower".
//
// BOTH KINDS ARE DRIVEN, because the requirement names both. Each runs on its own
// emptied yard, and both fold standing components rather than candidates — a
// combine that consumes a candidate is the level's harvest and starts the wave,
// which would put a wave's own events under the reading.
//
// WHICH FRAME THAT IS, ON THIS ENGINE. A combine is a CONTROL's event:
// `specs/scrap-press.md` has it "resolve the instant it is committed", and a debug
// operation under an engine is a pure state transition that cannot reach the cue
// bus, so the cue the commit raises sounds on the ONE frame that follows it.
//
// THE RUN-UP IS HELD SILENT, so a build that blips every frame fails before the
// fold rather than passing on it.

import { afterEach, beforeEach, it } from "vitest";

import { CUES } from "../../src/constants";
import { assertContains, assertDeepEqual, assertEqual } from "../assert";
import {
  captureReplay,
  comboDef,
  createHarness,
  emptyYard,
  openYard,
  standComponent,
  structureAt,
  watchCues,
  type Harness,
  type Tier,
} from "../harness";
import { RUN_UP, beforeFrame, names, onFrame } from "./cues";

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
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/** Commit one fold from `initiator` and report what sounded across it. */
async function fold(
  outputId: string,
  initiator: number,
): Promise<{ before: string[]; on: string[] }> {
  await h.advance(1);
  const cues = watchCues(h);
  await h.advance(RUN_UP);

  const resolved = await captureReplay(h, outputId, async () => {
    h.debug.combine(initiator);
    await h.advance(1);
    return h.frame();
  });
  return {
    before: names(beforeFrame(cues, resolved)),
    on: names(onFrame(cues, resolved)),
  };
}

it("sounds on the frame after a quality fold and a recipe fold resolve, and not before", async () => {
  openYard(h, { wave: 1 });

  // A quality-combine: two Scrap Capacitors fold into one Tuned Capacitor.
  const pair = standComponent(
    h,
    "capacitor",
    1,
    ANCHORS[0]!.col,
    ANCHORS[0]!.row,
  );
  standComponent(h, "capacitor", 1, ANCHORS[1]!.col, ANCHORS[1]!.row);
  const quality = await fold("combine", pair);

  assertDeepEqual(
    quality.before,
    [],
    "no cue to sound over the frames before a quality fold is committed " +
      "(specs/ui.md)",
  );
  assertEqual(
    structureAt(h.snapshot(), ANCHORS[0]!.col, ANCHORS[0]!.row)?.quality,
    2,
    "two Scrap Capacitors to fold into one Tuned Capacitor at the initiating " +
      "footprint (specs/scrap-press.md)",
  );
  assertContains(
    quality.on,
    CUES.combine,
    `the ${CUES.combine} cue on the frame a quality fold resolves ` +
      "(specs/ui.md)",
  );

  // A recipe-combine: the Static Web's three Scrap ingredients fold into a tower.
  emptyYard(h);
  const ingredients: number[] = [];
  for (const [index, ingredient] of RECIPE.recipe.entries()) {
    ingredients.push(
      standComponent(
        h,
        ingredient.type,
        // `specs/combinations.md` states every ingredient's quality as one of the
        // five rungs; the recipe table types it as a plain number.
        ingredient.tier as Tier,
        ANCHORS[index]!.col,
        ANCHORS[index]!.row,
      ),
    );
  }
  const recipe = await fold("combine", ingredients[0]!);

  assertDeepEqual(
    recipe.before,
    [],
    "no cue to sound over the frames before a recipe fold is committed " +
      "(specs/ui.md)",
  );
  assertEqual(
    structureAt(h.snapshot(), ANCHORS[0]!.col, ANCHORS[0]!.row)?.type,
    RECIPE.id,
    `the Static Web's three ingredients to fold into it at the initiating ` +
      `footprint (specs/scrap-press.md)`,
  );
  assertContains(
    recipe.on,
    CUES.combine,
    `the ${CUES.combine} cue on the frame a recipe fold resolves ` +
      "(specs/ui.md)",
  );
});
