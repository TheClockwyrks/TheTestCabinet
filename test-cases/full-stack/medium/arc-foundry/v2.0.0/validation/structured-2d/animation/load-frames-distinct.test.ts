// Arc Foundry — animation/load-frames-distinct: within one Load type's cycle the
// four frames are four different pictures.
//
// THE REQUIREMENT, from `specs/assets.md`: an idle cycle "loops while its subject
// is on the yard", and what the cycles must deliver is "that the Load visibly
// crackles". A cycle whose four frames are the same picture cannot crackle
// however fast it is played, so the four frames of each of the seven cycles are
// pairwise different images.
//
// COMPARED AS PIXELS, NOT AS BYTES. Two encodings of one picture are one picture,
// and `./images.ts` decodes each frame and compares the decoded RGBA. Frames of
// different sizes are different pictures by definition and are not compared
// further.
//
// EXACT, WITH NO TOLERANCE, AND IN ONE DIRECTION ONLY. What is asked is that the
// pictures differ at all — a single pixel is enough. How MUCH they differ, and
// whether the difference reads as crackle, is the aesthetic rating's, not this
// point's. So a build that redrew one spark between frames passes and a build
// that committed `0.png` four times fails, which is the line the review item
// draws.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual } from "../assert";
import { createHarness, type Harness, openYard, releaseUnit } from "../harness";
import { cycleFrames, decodeAll, duplicatePairs, evidence } from "./images";
import { SPAWN_TYPES } from "../constants";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws four different pictures in each Load type's cycle", async () => {
  await evidence(h, "cycle", async () => {
    openYard(h);
    releaseUnit(h, "slug", { tile: { col: 24, row: 16 }, frozen: true });
    await h.advance(1);
  });

  const repeated: string[] = [];
  for (const type of SPAWN_TYPES) {
    const frames = await decodeAll(cycleFrames(`load/${type}`));
    repeated.push(...duplicatePairs(frames));
  }
  assertDeepEqual(
    repeated,
    [],
    "the four frames of each Load cycle to be four different pictures, so the " +
      "unit visibly crackles (specs/assets.md)",
  );
});
