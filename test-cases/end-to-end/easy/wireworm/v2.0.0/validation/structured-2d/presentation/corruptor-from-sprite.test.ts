// Wireworm — presentation/corruptor-from-sprite: the corruptor is drawn from
// its own seeded art.
//
// specs/assets.md seeds `assets/corruptor/` with `CORRUPTOR_FRAMES` (`4`)
// frames and states what is done with them: they are "played as a loop at
// `CORRUPTOR_FPS` (`8`) frames per second while the corruptor crawls".
// specs/overview.md makes drawing from the seeded art a hard requirement of the
// finished build, and its legibility table asks that the three foes read apart
// from one another — which is what the seeded art already delivers, if the build
// reaches for it.
//
// SO THE READING IS THE IMAGE SOURCE ITSELF, NOT THE PIXELS ON THE STAGE. The
// bitmaps blitted on the corruptor's own centre are captured with the sources
// they were handed, and each source is held against the seeded PNGs read off the
// same `assets/` tree the build was seeded with. A source that IS a seeded frame
// matches it exactly; a canvas the build painted, a sheet of its own, or a
// recoloured copy does not. A build free to lay light of its own around a foe is
// not held to anything but this: SOMETHING blitted on the foe is one of the
// frames of its own folder.
//
// THE FOE IS POSED WITH BOTH FACULTIES OFF. This point is about what the
// corruptor looks like, not about what it does or where it goes, so `travel` is
// off — it holds the tile it was placed on, so the blit is read where the
// snapshot says the foe is — and `mind` is off, so it changes nothing about the
// board while the frame is read. Nothing else is posed; the cursor rests in its
// band, ten rows below the tile this reads.

import { afterEach, beforeEach, it } from "vitest";
import { TILE } from "../../src/constants";
import { assertEqual, fail } from "../assert";
import {
  captureStill,
  createHarness,
  drawnImages,
  foeById,
  nearestSeededFrame,
  poseFoe,
  resetTo,
  startPlaying,
  type Harness,
} from "../harness";

/**
 * How far a blitted source may sit from a seeded frame and still BE it: the
 * mean absolute difference over premultiplied RGBA channels, out of `255`.
 *
 * The requirement is identity, so this is not a likeness tolerance. It is room
 * for the one lossy step in reading a bitmap back out of a canvas — a partially
 * transparent pixel is premultiplied on the way in and un-premultiplied on the
 * way out, so it can shift by a unit. A frame of any OTHER seeded folder
 * measures far more than this against one of this folder's.
 */
const MATCH_MAX = 1;

/** How far the blit's centre may sit from the foe's own: half a tile. */
const PLACED_MAX = TILE / 2;

/** The tile the foe is posed on: mid-board, clear of the player band. */
const FOE_COLUMN = 18;
const FOE_ROW = 9;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("blits a frame of the seeded corruptor art on the corruptor", async () => {
  resetTo(h);
  startPlaying(h);
  const foe = poseFoe(h, "corruptor", FOE_COLUMN, FOE_ROW);
  h.debug.setFoeTravel(foe, false);
  h.debug.setFoeMind(foe, false);

  h.calls.length = 0;
  await h.advance(1);
  const blits = drawnImages(h);
  // The corruptor as the build drew it.
  captureStill(h, "corruptor");

  const posed = foeById(h.snapshot(), foe);
  assertEqual(posed?.kind, "corruptor", "the posed corruptor is on the board");
  assertEqual(h.assetFailures.length, 0, "every seeded frame loaded");
  if (posed === undefined) fail("a corruptor on the board", "none");

  const near = blits.filter(
    (blit) => Math.hypot(blit.x - posed.x, blit.y - posed.y) <= PLACED_MAX,
  );
  const matches = await Promise.all(
    near.map((blit) => nearestSeededFrame(blit.source)),
  );
  const drawn = matches.find(
    (match) => match.folder === "corruptor" && match.distance <= MATCH_MAX,
  );
  if (drawn !== undefined) return;
  fail(
    `the corruptor, at (${posed.x}, ${posed.y}), to be drawn from a frame of ` +
      `assets/corruptor/, blitted within ${PLACED_MAX} units of its centre ` +
      `(specs/assets.md)`,
    near.length === 0
      ? "no bitmap was blitted on the corruptor"
      : matches
          .map(
            (match) =>
              `${match.folder}/${match.index} at ${match.distance.toFixed(2)}`,
          )
          .join(", "),
  );
});
