// presentation/sprites-sampled-crisp — the produced pixel art is blitted with
// smoothing off.
//
// WHAT THE SPECIFICATION FIXES. `specs/overview.md` lists it among the things a
// player reads at a glance: "Crispness — the produced sprites are sampled without
// smoothing, so their pixel art stays sharp at every scale the stage is fitted
// to." `specs/assets.md` states the same of the files: each sprite is "pixel art
// on a transparent, straight-alpha canvas of `CELL x CELL` (`32 x 32`)... drawn
// at that native size and sampled without smoothing, so the pixel art stays sharp
// at every scale the stage is fitted to."
//
// WHAT IS READ. `imageSmoothingEnabled` as it stood at each blit that painted a
// cell of the snake. `image-init.js` reads it at the `drawImage` itself rather
// than from the frame's operations, because a build is free to set it once when
// it builds its context and never mention it again — a frame's operation log
// would then show the flag being set nowhere at all, and a check reading the log
// could not tell that build from one that left smoothing on.
//
// WHY IT IS READ AT TWO SIZES. The requirement is worded "at every scale the
// stage is fitted to", and at the stage's own size the flag changes nothing a
// player can see, so a build could satisfy a check taken there alone and still
// blur at every real window. The second surface is half again as wide and tall,
// where the stage is scaled up by a half and every sprite is genuinely resampled.
//
// WHAT IS NOT READ. Blits that painted anything other than the snake. The
// requirement is about the produced sprites, and `specs/assets.md` leaves the
// board, the pellet, the HUD and the screens drawn in code, so a build that
// blits something of its own elsewhere under smoothing is not in breach of it.
//
// THE WORLD THIS POSES. A chain holding all three body cases — a straight run, a
// bend, and a last cell — beside the head, so every sprite the snake is drawn
// from is on the board at once. Nothing else is: the pellet is cleared, the
// obstacle course is cleared, and travel is switched off.

import { afterEach, it } from "vitest";
import { assertGreaterThan, fail } from "../assert";
import type { Cell } from "../constants";
import {
  blitsOnCell,
  captureStill,
  createHarness,
  poseScene,
  type Blit,
  type Harness,
} from "../harness";

/** A chain that runs east along row 8 and turns south down column 8. */
const CHAIN: readonly Cell[] = [
  { col: 10, row: 8 },
  { col: 9, row: 8 },
  { col: 8, row: 8 },
  { col: 8, row: 9 },
  { col: 8, row: 10 },
];

let harnesses: Harness[] = [];

afterEach(async () => {
  for (const h of harnesses) await h.dispose();
  harnesses = [];
});

async function open(options?: {
  cssWidth: number;
  cssHeight: number;
}): Promise<Harness> {
  const h = await createHarness(options);
  harnesses.push(h);
  return h;
}

/** Every blit that painted a cell of the posed chain, in the order they landed. */
async function snakeBlits(h: Harness): Promise<Blit[]> {
  await poseScene(h, {
    snake: CHAIN,
    dir: "right",
    pellet: null,
    travel: false,
  });
  const blits = await h.frameBlits();
  return CHAIN.flatMap((cell) => blitsOnCell(h, blits, cell.col, cell.row));
}

it("blits every snake cell with image smoothing off, at the stage's size and above it", async () => {
  const atStage = await open();
  const scaled = await open({ cssWidth: 1920, cssHeight: 1080 });

  const painted = [
    { name: "the stage's own size", blits: await snakeBlits(atStage) },
    { name: "a window half again as large", blits: await snakeBlits(scaled) },
  ];
  // The scaled surface is where smoothing is visible, so that is the picture.
  await captureStill(scaled, "crisp");

  for (const { name, blits } of painted) {
    assertGreaterThan(
      blits.length,
      0,
      `image draws landing on the posed chain at ${name}`,
    );
    const smoothed = blits.filter((blit) => blit.smoothing);
    if (smoothed.length > 0) {
      fail(
        `every image draw on a snake cell made with image smoothing off, at ${name}`,
        `${smoothed.length} of ${blits.length} were made with it on`,
      );
    }
  }
});
