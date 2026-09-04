// assets/crack-frames — the drill-damage overlay is a produced progression.
//
// `specs/assets.md`: "at least `CRACK_FRAMES` (`4`) transparent frames running
// front to back from faint hairlines to a shattered, about-to-break face", under
// `assets/tiles/crack/`, numbered from `frame00.png`. Three parts, and each is a
// sentence of that:
//
//   * the frames are there, at that path and under that numbering;
//   * there are at least four of them;
//   * every one is a different drawing from every other, because they run FRONT TO
//     BACK — a progression that repeated a picture would show a cell's damage
//     standing still while its health fell;
//   * and each carries transparency, because the overlay is drawn OVER the rock
//     it cracks and an opaque frame would hide the band underneath it.
//
// Which frame is drawn at which damage is a different requirement and its own
// point; this one is about the frames existing and being a progression.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThanOrEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import {
  allDistinct,
  cycleFrames,
  readPicture,
  type Picture,
} from "./produced";
import { CRACK_FRAMES } from "../constants";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("produces at least four distinct transparent crack frames", async () => {
  const frames = cycleFrames("tiles", "crack");
  const pictures: Picture[] = [];
  for (const frame of frames) {
    const picture = await readPicture(h, frame);
    if (picture !== null) pictures.push(picture);
  }
  await captureStill(h, "cracks");

  assertGreaterThanOrEqual(
    pictures.length,
    CRACK_FRAMES,
    "assets/tiles/crack/frameNN.png (specs/assets.md)",
  );
  assertEqual(allDistinct(pictures), true, "specs/assets.md");
  assertEqual(
    pictures.every((picture) => picture.transparent && picture.drawn),
    true,
    "every crack frame is transparent and drawn (specs/assets.md)",
  );
});
