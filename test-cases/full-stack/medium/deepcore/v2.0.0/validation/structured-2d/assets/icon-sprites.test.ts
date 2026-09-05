// assets/icon-sprites — the status bar's readings each have a produced icon.
//
// `specs/assets.md`: `assets/icons/<name>.png` holds "A status-bar icon", and the
// environment list asks for "The status-bar icons for fuel, hull, cargo, Credits,
// depth, and each material". `specs/mining.md` names the two materials, so the
// seven file names follow from the specification rather than from a list this
// check invented. `ICON_SIZE` (`24`) is the square each is authored at.
//
// ALL SEVEN MUST BE THERE, AND ALL SEVEN MUST BE DIFFERENT DRAWINGS. A status bar
// that stamps one picture beside every reading tells a player nothing about which
// reading is which, which is the whole of what an icon is for. The size is not
// read here: `specs/assets.md` states what a sprite is authored at, and how large
// the build draws it in its own bar is layout, which `specs/overview.md` hands to
// the build.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { ICON_SPRITES } from "../constants";
import {
  captureStill,
  createHarness,
  layCamp,
  openScene,
  pinDrill,
  pinMiner,
  standAtCamp,
  type Harness,
} from "../harness";
import { allDistinct, readPicture, type Picture } from "./produced";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("produces a distinct icon for each status-bar reading", async () => {
  const missing: string[] = [];
  const icons: Picture[] = [];
  for (const name of ICON_SPRITES) {
    const picture = await readPicture("icons", `${name}.png`);
    if (picture === null) missing.push(`assets/icons/${name}.png`);
    else icons.push(picture);
  }

  // The bar the icons belong to, so the evidence beside the verdict is the
  // place a player reads them rather than the files on their own.
  openScene(h);
  layCamp(h);
  pinMiner(h);
  pinDrill(h);
  standAtCamp(h);
  await h.advance(2);
  captureStill(h, "icons");

  assertEqual(missing.join(", "), "", "specs/assets.md");
  assertEqual(allDistinct(icons), true, "specs/assets.md");
});
