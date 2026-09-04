// assets/stone-variants — unbreakable stone has more than one stamp.
//
// `specs/assets.md`: "Unbreakable stone, at least two variants, reading as a
// smooth, cold, harder material against the grainy band rock, with a distinct
// silhouette rather than a re-tinted dirt tile", produced at
// `assets/tiles/stone-<n>.png`. So the variants are counted at that path and each
// must be a different drawing from the rest — two files holding one picture are
// one variant, whatever they are named.
//
// The numbering's starting point is not fixed by `specs/assets.md`, so the
// directory is read for every name of that shape rather than walked from a number
// this check chose. Whether the stone reads as harder than the rock around it is a
// reviewer's reading, off the still this item captures.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThanOrEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import {
  allDistinct,
  producedNames,
  readPicture,
  type Picture,
} from "./produced";
import { STONE_VARIANTS } from "./spec";

/** `assets/tiles/stone-<n>.png`, whatever the build numbered them from. */
const VARIANT = /^stone-\d+\.png$/;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("produces at least two distinct boulder variants", async () => {
  const names = producedNames("tiles").filter((name) => VARIANT.test(name));
  const pictures: Picture[] = [];
  for (const name of names) {
    const picture = await readPicture(h, "tiles", name);
    if (picture !== null) pictures.push(picture);
  }
  await captureStill(h, "boulders");

  assertGreaterThanOrEqual(
    pictures.length,
    STONE_VARIANTS,
    "assets/tiles/stone-<n>.png (specs/assets.md)",
  );
  assertEqual(allDistinct(pictures), true, "specs/assets.md");
});
