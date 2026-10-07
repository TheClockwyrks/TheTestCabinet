// Arc Foundry — animation/combo-fire-cycles-present: every combination tower
// ships a four-frame cycle under `combos/<id>/fire/`.
//
// THE REQUIREMENT, from the animation table of `specs/assets.md`: "Combination
// firing — `combos/<id>/fire/0.png` .. `3.png` — the tower's discharge, played
// once per shot. One cycle per tower, twelve in all." `specs/combinations.md`
// fixes the twelve identifiers, so there are forty-eight files.
//
// WHAT IS ASSERTED. That every one of the forty-eight is on disk and decodes as
// an image. No size is asserted: `specs/assets.md` fixes sizes for the sprites and
// for the Load's idle cycles and deliberately fixes none for a firing cycle.
// Whether the four frames differ is `animation/combo-fire-frames-distinct`; this
// point decides only that the files were produced.

import { afterEach, beforeEach, it } from "vitest";
import { COMBO_IDS } from "../constants";
import { assertDeepEqual } from "../assert";
import { createHarness, openYard, standCombo, type Harness } from "../harness";
import { cycleFrames, decodeAll, evidence, missing } from "./images";

const FRAMES = COMBO_IDS.flatMap((id) => cycleFrames(`combos/${id}/fire`));

/** Two clear rows of six, well away from the map's waypoint platforms. */
const ANCHORS = [10, 24].flatMap((row) =>
  [6, 12, 18, 24, 30, 36].map((col) => ({ col, row })),
);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("produces a four-frame firing cycle for all twelve combination towers", async () => {
  await evidence(h, "fire", async () => {
    openYard(h);
    for (const [index, id] of COMBO_IDS.entries()) {
      const anchor = ANCHORS[index]!;
      standCombo(h, id, anchor.col, anchor.row);
    }
    await h.advance(1);
  });

  assertDeepEqual(
    missing(FRAMES),
    [],
    "a four-frame cycle under assets/combos/<id>/fire/ for each of the twelve " +
      "combination towers (specs/assets.md)",
  );
  await decodeAll(FRAMES);
});
