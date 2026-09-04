// sprites/produced-sprites-are-drawn — the yard is drawn FROM the produced files.
//
// `specs/assets.md` divides everything the game shows in two: a file produced
// with one of the six tools, or one of the code-drawn elements it lists. A
// component is in the first half — `components/<type>/base.png` is "the fixed
// mount a head turns on" and `components/<type>/head-<tier>.png` "the rotating
// head" — and `specs/overview.md` puts "placing the produced yard sprites" among
// what the build does. A repository that produced the files and then drew its
// components in code has satisfied every path and canvas in this category while
// shipping art nothing plays.
//
// WHAT IS READ. The images the frame blitted, and where each landed on the stage,
// mapped through whatever transform drew it — a head is rotated to its heading
// (`specs/components.md`), so what a blit's arguments say and where it lands are
// two different things. The count of blits landing inside one `2` by `2`
// footprint is taken with the tiles empty and again with a component standing on
// them, and standing the component has to add to it. The count is a DIFFERENCE
// rather than a total because `specs/assets.md` also has the yard's substrate
// blitted across those same tiles, and that blit is not the component.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  type Harness,
  imageDraws,
  openYard,
  standComponent,
} from "../harness";
import { FOOTPRINT, TILE } from "../constants";
import { serveProducedAssets } from "./host";

// The produced files, served to the engine off disk, so the still beside this
// point's verdict shows the art the run made rather than the fallback a build
// draws when nothing arrived.
serveProducedAssets();

const ANCHOR = { col: 10, row: 10 };
const FOOTPRINT_BOX = {
  x0: ANCHOR.col * TILE,
  y0: 56 + ANCHOR.row * TILE,
  x1: ANCHOR.col * TILE + FOOTPRINT * TILE,
  y1: 56 + ANCHOR.row * TILE + FOOTPRINT * TILE,
};

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

/** How many images the frame blitted with their middle inside the footprint. */
async function blitsOnTheFootprint(): Promise<number> {
  return imageDraws(await h.frameCalls()).filter(
    (draw) =>
      draw.cx >= FOOTPRINT_BOX.x0 &&
      draw.cx <= FOOTPRINT_BOX.x1 &&
      draw.cy >= FOOTPRINT_BOX.y0 &&
      draw.cy <= FOOTPRINT_BOX.y1,
  ).length;
}

it("blits more onto a component's tiles once the component stands", async () => {
  openYard(h);

  const bare = await blitsOnTheFootprint();

  standComponent(h, "capacitor", 3, ANCHOR.col, ANCHOR.row);
  h.debug.clearSelection();
  const standing = await blitsOnTheFootprint();
  captureStill(h, "drawn");

  assertGreaterThan(
    standing,
    bare,
    `how many images the frame blitted onto the footprint at (${ANCHOR.col}, ` +
      `${ANCHOR.row}) with a Charged Capacitor standing on it, against the ` +
      `${bare} it blitted onto the same tiles bare`,
  );
});
