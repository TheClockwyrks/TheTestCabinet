// assets/miner-fuel-out-cycle — the fuel-out cycle is a produced sheet.
//
// `specs/assets.md`: one `draw-sheet` cycle per animation state, one PNG per
// frame, under `assets/miner/<state>/`, numbered from `frame00.png`. The `fuel-out`
// state is asked for at least `2` frames, carrying slumped and powerless, the jetpack dead.
//
// Two things are read, and both are what the contract says rather than what any
// build happens to have done. The frames are THERE, at the path and under the
// numbering `specs/assets.md` states, and there are at least `2` of them. And
// the cycle carries more than one DRAWING — a cycle whose files are copies of one
// picture is the "single static frame in place of a miner cycle" the contract's
// closing paragraph refuses, and it animates nothing however many files it ships.
// A frame that equals an earlier one is not that: an `A, B, A` bob and an
// `A, B, A, B` brace are ordinary cycles, and a build is graded on the drawings it
// made rather than on the order it plays them in.
//
// Each frame is decoded with the same decoder that stands the produced sprites up
// for the game, and reduced to a coarse signature, so two frames count as the same
// drawing only when they really are one and a stray antialiased pixel cannot make
// two copies look different. Whether the frames carry what the table describes is a
// reviewer's reading; the still the item captures — the miner on screen in this
// very state — is what they read it from.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { showMiner } from "./miner";
import { cycleFrames, distinctCount, readPictures } from "./produced";
import { DRAWINGS_MIN, MINER_CYCLES } from "../constants";

/** The state this point is about, and where `specs/assets.md` puts its cycle. */
const STATE = "fuel-out";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("produces the fuel-out cycle with distinct frames", async () => {
  const pictures = await readPictures(cycleFrames("miner", STATE));

  await showMiner(h, STATE);
  captureStill(h, "cycle");

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
