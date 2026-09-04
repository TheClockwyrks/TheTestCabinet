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
// bitmaps blitted on the foe's own centre are captured with the sources they
// were handed, and each source is held against the seeded PNGs read off the same
// `assets/` tree the build was seeded with. A source that IS a seeded frame
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
// band, rows below the tile this reads.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, fail } from "../assert";
import { TILE } from "../constants";
import {
  blitsOfFrame,
  captureStill,
  createHarness,
  drawnFrom,
  foeById,
  poseFoe,
  startPlaying,
  type Harness,
} from "../harness";
import { blitsNear, describeBlits } from "./reading";

/**
 * How far a blit's centre may sit from the foe's own centre, in logical units.
 *
 * Half a tile. specs/assets.md draws the frame "centered on" the foe's position,
 * and how a build inks it inside that box is its own; a blit whose centre left
 * the foe's tile altogether is drawn on something else.
 */
const PLACED_MAX = TILE / 2;

/** The tile the foe is posed on: mid-board, clear of the player band. */
const FOE_COLUMN = 12;
const FOE_ROW = 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("blits a frame of the seeded corruptor art on the corruptor", async () => {
  await startPlaying(h);
  const id = await poseFoe(h, "corruptor", FOE_COLUMN, FOE_ROW, {
    travel: false,
    mind: false,
  });

  const blits = await blitsOfFrame(h);
  // The corruptor as the build drew it.
  await captureStill(h, "corruptor");

  const posed = foeById(await h.snapshot(), id);
  assertEqual(posed?.kind, "corruptor", "the posed corruptor is on the board");
  if (posed === undefined) fail("a corruptor on the board", "none");

  const at = { x: posed.x, y: posed.y };
  if (drawnFrom(blits, "corruptor", at, PLACED_MAX).length > 0) return;
  fail(
    `the corruptor, at (${posed.x}, ${posed.y}), to be drawn from a frame of assets/corruptor/, ` +
      `blitted within ${PLACED_MAX} units of its centre (specs/assets.md)`,
    describeBlits(blitsNear(blits, at, PLACED_MAX)),
  );
});
