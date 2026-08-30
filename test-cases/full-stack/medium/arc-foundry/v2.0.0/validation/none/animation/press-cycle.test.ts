// Arc Foundry — animation/press-cycle: the press ships a four-frame stamping
// cycle whose frames are four different pictures.
//
// THE REQUIREMENT, from the animation table of `specs/assets.md`: "Press —
// `press/0.png` .. `3.png` — the press stamping, played when a rock is placed."
// Every cycle in that table is four frames "played as a loop", and a cycle whose
// frames are one picture repeated shows no stamp, so this point asks both halves
// at once: the four files exist and decode, and they are pairwise different
// images.
//
// WHY BOTH HALVES ARE ONE POINT HERE. The press is a single cycle rather than a
// family of them, so "the press has a four-frame stamping cycle" is one
// requirement in one direction; the Load's and the components' cycles are split
// into a presence point and a distinctness point because each of those is a
// family and a build can miss one member of it without missing the other.
//
// No size is asserted: `specs/assets.md` fixes one for the Load's idle cycles and
// deliberately fixes none for the press.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual } from "../assert";
import {
  createHarness,
  openYard,
  standCandidate,
  type Harness,
} from "../harness";
import {
  cycleFrames,
  decodeAll,
  duplicatePairs,
  evidence,
  missing,
} from "./images";

const FRAMES = cycleFrames("press");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("produces four different stamping frames", async () => {
  await evidence(h, "press", async () => {
    await openYard(h);
    await standCandidate(h, "capacitor", 1, 24, 15);
    await h.advance(1);
  });

  assertDeepEqual(
    missing(FRAMES),
    [],
    "assets/press/0.png through 3.png on disk (specs/assets.md)",
  );
  const frames = await decodeAll(FRAMES);
  assertDeepEqual(
    duplicatePairs(frames),
    [],
    "the press's four frames to be four different pictures (specs/assets.md)",
  );
});
