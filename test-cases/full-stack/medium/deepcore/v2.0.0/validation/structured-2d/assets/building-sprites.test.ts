// assets/building-sprites — the camp's fixtures are produced sprites.
//
// `specs/assets.md`: `assets/surface/<id>.png` holds "One of the six buildings, by
// its id, plus `cave-mouth`, `ground`, and `sky`", and asks for "The six surface
// buildings, each reading clearly as what it is". `specs/world.md` gives the six
// their ids, so the nine file names follow from the specification rather than from
// a list this check invented.
//
// All nine must be there, and the six BUILDINGS must be different drawings from
// one another: a player standing at the camp picks the Fuel Depot out from the Ore
// Market by looking at it, and two fixtures sharing a stamp make that impossible.
// The three that are not buildings are held only to being present, because the
// ground and the sky are backdrops rather than things to tell apart.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { showAtCamp } from "./miner";
import { allDistinct, readPicture, type Picture } from "./produced";
import { BUILDING_SPRITES, SURFACE_SPRITES } from "./spec";

let h: Harness;

beforeEach(async () => {
  h = await createHarness({ assets: true });
});

afterEach(() => {
  h?.dispose();
});

it("produces the nine surface sprites, the six buildings distinct", async () => {
  const missing: string[] = [];
  const buildings: Picture[] = [];
  for (const id of [...BUILDING_SPRITES, ...SURFACE_SPRITES]) {
    const picture = await readPicture("surface", `${id}.png`);
    if (picture === null) missing.push(`assets/surface/${id}.png`);
    else if (BUILDING_SPRITES.includes(id)) buildings.push(picture);
  }

  showAtCamp(h);
  await h.advance(2);
  captureStill(h, "camp");

  assertEqual(missing.join(", "), "", "specs/assets.md");
  assertEqual(allDistinct(buildings), true, "specs/assets.md");
});
