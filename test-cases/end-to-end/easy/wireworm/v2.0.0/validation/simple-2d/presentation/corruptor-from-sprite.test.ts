// presentation/corruptor-from-sprite — the corruptor is drawn from its seeded art.
//
// specs/assets.md seeds `assets/corruptor/` and states what it covers: "Four frames, played as a loop at `CORRUPTOR_FPS` (`8`) frames per second while the corruptor crawls", so any of the four is the art of a corruptor. A build that
// draws a convincing shape in code satisfies presentation/foes-distinct and
// misses this point, which is the whole reason the point exists.
//
// THE READING IS THE IMAGE SOURCE ITSELF, NOT THE PIXELS ON THE STAGE. The bitmap
// the build handed the context is held against the seeded PNGs read off the
// workspace's own `assets/` tree — the same tree the build was seeded with — so a
// source that IS a seeded frame matches it and art of the build's own does not.
//
// THE DRAW IS NAMED BY THE FOE IT WAS DRAWN FOR, by the foe's own reported
// centre, so the point says "the corruptor was drawn from `assets/corruptor/`" rather than
// "some frame was drawn somewhere". A build may layer whatever else it likes over
// a foe, so what is required is that a frame of the folder is among what was
// drawn there.
//
// THE FOE IS POSED WITH BOTH FACULTIES HELD. Which art a foe is drawn from is not
// a faculty: `setFoeTravel` off holds it on the tile it was posed on, so the draw
// is attributed to a known point, and `setFoeMind` off keeps it from acting on
// the field beneath it, so nothing else appears on that tile to be drawn. The
// board is otherwise the empty, quiet one `startPlaying` opens.

import { afterEach, beforeEach, it } from "vitest";
import { TILE } from "../../src/constants";
import { assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  drawFrame,
  drawnImages,
  foeOf,
  poseFoe,
  startPlaying,
  type Harness,
} from "../harness";
import { framesDrawnAt, frameName, spriteReader } from "./reading";

/**
 * How far a draw's destination centre may sit from the foe it is attributed to,
 * in logical units.
 *
 * specs/assets.md draws a foe's frame "centered on its position", and a frame is
 * `SPRITE_SIZE` (`32`) on a side, so half a tile (`TILE / 2`, `16`) is the whole
 * of the slack. It is an ATTRIBUTION radius rather than a placement bound, and
 * this board holds one body, so nothing can be attributed to anything else.
 */
const ATTRIBUTION_MAX = TILE / 2;

/** The tile the foe is posed on: mid-board, far from the band and the entry row. */
const FOE_C = 20;
const FOE_ROW = 8;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the corruptor from a frame of assets/corruptor/", async () => {
  startPlaying(h);
  const id = poseFoe(h, "corruptor", FOE_C, FOE_ROW);
  h.debug.setFoeTravel(id, false);
  h.debug.setFoeMind(id, false);

  const drawn = drawnImages(h, await drawFrame(h));
  captureStill(h, "corruptor");

  const foe = foeOf(h.snapshot(), id);
  const matches = await framesDrawnAt(
    spriteReader(),
    drawn,
    foe.x,
    foe.y,
    ATTRIBUTION_MAX,
  );
  assertTrue(
    matches.some((match) => match.folder === "corruptor"),
    `the corruptor, reported at (${foe.x}, ${foe.y}), drawn from ` +
      "a frame of assets/corruptor/ (specs/assets.md) — the seeded art drawn there " +
      `was ${matches.map(frameName).join(", ") || "none"}`,
  );
});
