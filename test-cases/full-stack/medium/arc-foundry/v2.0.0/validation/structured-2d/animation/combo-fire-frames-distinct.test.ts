// Arc Foundry — animation/combo-fire-frames-distinct: within one tower's firing
// cycle the four frames are four different pictures.
//
// THE REQUIREMENT, from `specs/assets.md`: a combination tower's cycle is "the
// tower's discharge, played once per shot", and what a firing cycle must deliver
// is "that a firing structure visibly charges and discharges". A cycle whose four
// frames are one picture repeated shows no discharge, so the four frames of each
// of the twelve cycles are pairwise different images.
//
// COMPARED AS PIXELS AND IN ONE DIRECTION, exactly as the component cycles are:
// each frame is decoded and the RGBA compared, and what is asked is that the
// pictures differ at all rather than how much.

import { afterEach, beforeEach, it } from "vitest";
import { COMBO_IDS } from "../constants";
import { assertDeepEqual } from "../assert";
import { createHarness, openYard, standCombo, type Harness } from "../harness";
import { cycleFrames, decodeAll, duplicatePairs, evidence } from "./images";
import { serveProducedAssets } from "./produced";

let h: Harness;

beforeEach(async () => {
  serveProducedAssets();
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws four different pictures in each tower's firing cycle", async () => {
  await evidence(h, "cycle", async () => {
    openYard(h);
    standCombo(h, "nullcore", 24, 15);
    await h.advance(1);
  });

  const repeated: string[] = [];
  for (const id of COMBO_IDS) {
    const frames = await decodeAll(cycleFrames(`combos/${id}/fire`));
    repeated.push(...duplicatePairs(frames));
  }
  assertDeepEqual(
    repeated,
    [],
    "the four frames of each combination tower's firing cycle to be four " +
      "different pictures (specs/assets.md)",
  );
});
