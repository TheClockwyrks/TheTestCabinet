// assets/material-sprites — the materials, the Core and the Sample are produced.
//
// `specs/assets.md`: `assets/materials/<name>.png` holds `resonite`, `cryenite`,
// `core`, and `core-sample`, and the sprites are "Resonite and Cryenite nodes, as
// raw crystal embedded in rock, distinct from both ore and gemstones; the glowing
// Core in its chamber; and the Core Sample". So all four must be there and all
// four must be different drawings.
//
// `specs/overview.md` is why the last part matters: a material node has to read as
// distinct from both ore and gemstones, and a player carrying a Core Sample has to
// see something other than the Core it was cut from. Whether they read as crystal
// and as a glowing core is a reviewer's reading off the still this item captures.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { allDistinct, readPicture, type Picture } from "./produced";
import { MATERIAL_SPRITES } from "../constants";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("produces four distinct material sprites", async () => {
  const missing: string[] = [];
  const pictures: Picture[] = [];
  for (const name of MATERIAL_SPRITES) {
    const picture = await readPicture(h, "materials", `${name}.png`);
    if (picture === null) missing.push(`assets/materials/${name}.png`);
    else pictures.push(picture);
  }
  await captureStill(h, "materials");

  assertEqual(missing.join(", "), "", "specs/assets.md");
  assertEqual(allDistinct(pictures), true, "specs/assets.md");
});
