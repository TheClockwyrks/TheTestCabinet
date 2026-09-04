// Arc Foundry — animation/component-fire-frames-distinct: within one component's
// firing cycle the four frames are four different pictures.
//
// THE REQUIREMENT, from `specs/assets.md`: a firing cycle shows "the head's
// charge-and-discharge, played once per shot", and what the cycles must deliver is
// "that a firing structure visibly charges and discharges". A cycle whose frames
// are one picture repeated shows neither, so the four frames of each of the eight
// cycles are pairwise different images.
//
// COMPARED AS PIXELS AND IN ONE DIRECTION. Each frame is decoded and the decoded
// RGBA compared, so two encodings of one picture read as one picture. What is
// asked is that the pictures differ at all; how much they differ, and whether the
// difference reads as a discharge, is the aesthetic rating's.

import { afterEach, beforeEach, it } from "vitest";
import { COMPONENT_TYPES } from "../constants";
import { assertDeepEqual } from "../assert";
import {
  createHarness,
  openYard,
  standComponent,
  type Harness,
} from "../harness";
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

it("draws four different pictures in each component's firing cycle", async () => {
  await evidence(h, "cycle", async () => {
    openYard(h);
    standComponent(h, "capacitor", 5, 24, 15);
    await h.advance(1);
  });

  const repeated: string[] = [];
  for (const type of COMPONENT_TYPES) {
    const frames = await decodeAll(cycleFrames(`components/${type}/fire`));
    repeated.push(...duplicatePairs(frames));
  }
  assertDeepEqual(
    repeated,
    [],
    "the four frames of each component's firing cycle to be four different " +
      "pictures, so a firing structure visibly charges and discharges " +
      "(specs/assets.md)",
  );
});
