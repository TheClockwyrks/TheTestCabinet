// assets/ore-overlays — every ore and gemstone has its own overlay.
//
// `specs/assets.md`: one overlay per ore and one per gemstone, at
// `assets/ore/<name>.png`, "named in lower case". `specs/mining.md` names the ten
// ores and the three gemstones, and `specs/instrumentation.md` fixes an ore's id
// as "its name in lower case", so the thirteen file names follow from the
// specification rather than from a list this check invented — `ORE_IDS` is that
// same set.
//
// Every one must be there and every pair must be a different drawing.
// `specs/overview.md` requires a player to tell the ten ores apart from one
// another and a gemstone from an ore at a glance, so two ores sharing a stamp is
// the failure this decides; whether the smears read as smears and the jewels as
// jewels is a reviewer's reading off the still.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { ORE_IDS } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { allDistinct, readPicture, type Picture } from "./produced";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("produces a distinct overlay for each of the thirteen minerals", async () => {
  const missing: string[] = [];
  const pictures: Picture[] = [];
  for (const ore of ORE_IDS) {
    const picture = await readPicture(h, "ore", `${ore}.png`);
    if (picture === null) missing.push(`assets/ore/${ore}.png`);
    else pictures.push(picture);
  }
  await captureStill(h, "ores");

  assertEqual(missing.join(", "), "", "specs/assets.md");
  assertEqual(allDistinct(pictures), true, "specs/assets.md");
});
