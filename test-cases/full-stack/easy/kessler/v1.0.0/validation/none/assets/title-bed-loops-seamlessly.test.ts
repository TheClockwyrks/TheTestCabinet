// assets/title-bed-loops-seamlessly — the title bed's end runs into its start.
//
// specs/assets.md: each bed "loops without an audible seam, the file's end
// running into its start with no click, no gap, and no jump in level". A looping
// source plays the final sample and then the first, so all three faults are
// properties of the committed samples of `assets/audio/music-title.wav`, read at that
// junction.
//
// EACH BED IS ITS OWN POINT, because a build whose title bed loops cleanly and
// whose play bed clicks must grade differently from one where both click. The
// length belongs to `title-bed-at-least-12s`. How each of the three faults is
// read, and why every threshold is a tolerance rather than a spec figure, is
// `beds.ts`.

import { it } from "vitest";
import { BEDS } from "./bed-audio";
import { assertSeamless } from "./beds";

it("loops the title bed without an audible seam", () => {
  assertSeamless("title-seam", BEDS[0].name, BEDS[0].path);
});
