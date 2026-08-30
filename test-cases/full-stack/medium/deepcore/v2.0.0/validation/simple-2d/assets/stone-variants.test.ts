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
// reviewer's reading, off the still this item captures: two boulders posed side by
// side in a band's rock.

import { afterEach, beforeEach, it } from "vitest";
import { PLAYABLE_COL_MIN } from "../../src/constants";
import { assertEqual, assertGreaterThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  fillRow,
  layFloor,
  openScene,
  pinDrill,
  pinMiner,
  standOn,
  type Harness,
} from "../harness";
import { allDistinct, producedNames, readPictures } from "./produced";
import { STONE_VARIANTS } from "./spec";

/** `assets/tiles/stone-<n>.png`, whatever the build numbered them from. */
const VARIANT = /^stone-\d+\.png$/;

/** Where the boulders in the still are posed. */
const ROW = 200;
const MINER_COL = PLAYABLE_COL_MIN + 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness({ assets: true });
});

afterEach(() => {
  h?.dispose();
});

it("produces at least two distinct boulder variants", async () => {
  const names = producedNames("tiles").filter((name) => VARIANT.test(name));
  const pictures = await readPictures(
    names.map((name) => ["tiles", name] as const),
  );

  openScene(h);
  pinDrill(h);
  layFloor(h, ROW);
  standOn(h, MINER_COL, ROW);
  pinMiner(h);
  fillRow(h, ROW - 1, MINER_COL + 2, MINER_COL + 6, "rock");
  h.debug.setTile(MINER_COL + 3, ROW - 1, "stone");
  h.debug.setTile(MINER_COL + 5, ROW - 1, "stone");
  await h.advance(2);
  captureStill(h, "boulders");

  assertGreaterThanOrEqual(
    pictures.length,
    STONE_VARIANTS,
    "assets/tiles/stone-<n>.png (specs/assets.md)",
  );
  assertEqual(allDistinct(pictures), true, "specs/assets.md");
});
