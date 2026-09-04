// audio/death-is-the-longest-cue — the end of a round is the heaviest sound in
// the game.
//
// WHAT THE SPECIFICATION FIXES. `specs/assets.md`'s sound bar: "`death` is the
// one heavy sound in the game, clearly longer and lower than the other two, and
// unmistakable as the end of a round." Longer is the half of that a file carries
// as a figure; lower is a timbre, and the presentation domain's aesthetic rating
// is where a person judges it.
//
// WHAT IS READ. The three files' own lengths, and `death` against each of the
// other two. "Clearly" longer is the bar's own hedge rather than a figure, so
// what is asserted is the comparison the bar makes — `death` is longer than `eat`
// and longer than `combo-up` — and by how much is the build's to choose.
//
// HOW THE FILES ARE READ. Off the repository the build produced, at the paths
// `specs/assets.md` fixes. Each length comes off the container's own header — the
// `data` chunk against the bytes-a-second the `fmt ` chunk declares — so the
// three are compared on the same footing whatever encodes their samples
// (`audio/sounds.ts`). That each exists at all and carries signal is its own
// `audio/*-file-produced` point.
//
// THE EVIDENCE. This point drives nothing, so its declared still is a picture of
// the moment the cue belongs to: the head one cell from the wall it runs into.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, fail } from "../assert";
import { CUES, INTERIOR_COL_MAX } from "../constants";
import {
  captureStill,
  chainFrom,
  createHarness,
  type Cell,
  type Harness,
} from "../harness";
import { CUE_FILES, readSounds, showRound } from "./sounds";

/** The three event cues, `death` first. */
const FILES = [
  CUE_FILES[CUES.death],
  CUE_FILES[CUES.eat],
  CUE_FILES[CUES.comboUp],
] as const;

/** The last interior cell of row 8: one step east of it is the wall border. */
const BRINK: Cell = { col: INTERIOR_COL_MAX, row: 8 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("ships a death cue longer than both of the other event cues", async () => {
  const read = readSounds(FILES);

  await showRound(h, {
    snake: chainFrom(BRINK, "right", 4),
    dir: "right",
    pellet: null,
    travel: false,
  });
  captureStill(h, "death");

  const lengths = read.map(({ sound, reason }, i) => {
    if (sound === null) fail(`a readable PCM WAV at ${FILES[i]}`, reason);
    return sound.duration;
  });
  const [death, eat, comboUp] = lengths;

  assertGreaterThan(
    death,
    eat,
    `the length of ${FILES[0]} in seconds, against ${FILES[1]}`,
  );
  assertGreaterThan(
    death,
    comboUp,
    `the length of ${FILES[0]} in seconds, against ${FILES[2]}`,
  );
});
