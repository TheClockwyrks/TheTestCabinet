// assets/miner-hurt-cycle — the hurt cycle is a produced sheet.
//
// `specs/assets.md`: one `draw-sheet` cycle per animation state, one PNG per
// frame, under `assets/miner/<state>/`, numbered from `frame00.png`. The `hurt`
// state is asked for at least `2` frames, carrying a sharp flinch and recoil at the instant of damage.
//
// Two things are read, and both are what the contract says rather than what any
// build happens to have done. The frames are THERE, at the path and under the
// numbering `specs/assets.md` states, and there are at least `2` of them. And the cycle
// carries more than one DRAWING — a cycle whose files are copies of one picture is
// the "single static frame in place of a miner cycle" the contract's closing
// paragraph refuses, and it animates nothing however many files it ships. A frame
// that equals an earlier one is not that: an `A, B, A` bob and an `A, B, A, B`
// brace are ordinary cycles, and a build is graded on the drawings it made rather
// than on the order it plays them in.
//
// Each frame is decoded in the page the project already holds and reduced to a
// coarse signature, so two frames count as the same drawing only when they really
// are one, and a stray antialiased pixel cannot make two copies look different.
// Whether the frames carry what the table describes is a reviewer's reading; the
// still the item captures is what they read it from.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import {
  distinctCount,
  cycleFrames,
  readPicture,
  type Picture,
} from "./produced";
import { MINER_CYCLES } from "./spec";

/** How many different drawings a cycle carries at least, to be a cycle at all. */
const DRAWINGS_MIN = 2;

/** The state this point is about, and where `specs/assets.md` puts its cycle. */
const STATE = "hurt";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("produces the hurt cycle with distinct frames", async () => {
  const frames = cycleFrames("miner", STATE);
  const pictures: Picture[] = [];
  for (const frame of frames) {
    const picture = await readPicture(h, frame);
    if (picture !== null) pictures.push(picture);
  }
  await captureStill(h, "cycle");

  assertGreaterThanOrEqual(
    pictures.length,
    MINER_CYCLES[STATE],
    `assets/miner/${STATE}/frameNN.png (specs/assets.md)`,
  );
  assertGreaterThanOrEqual(
    distinctCount(pictures),
    DRAWINGS_MIN,
    `different drawings among assets/miner/${STATE}/ (specs/assets.md)`,
  );
});
