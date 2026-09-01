// presentation/lamplighter-idle-when-still — a tick with no movement direction
// draws the produced idle sprite and no walk frame.
//
// WHERE THE FIGURE COMES FROM. `specs/assets.md`, Animation: "The lamplighter
// draws the walk sheet on a tick with a non-zero movement direction and the
// idle sprite on every other tick." The idle sprite is the produced
// `assets/sprites/lamplighter/idle.png` and the walk sheet is
// `assets/sprites/lamplighter/walk/0.png` to `5.png` (`specs/assets.md`, "The
// sprites"), so which file the frame blitted at the stage centre IS which of
// the two it drew. `specs/ui.md` puts that sprite at the stage centre
// `(STAGE_CX, STAGE_CY)`.
//
// THE BOUND. None on the verdict: one produced file name at the stage centre,
// within `SPRITE_TOL` (2 device pixels) of it, which is the rounding a build
// that lands its destination rectangle on whole device pixels picks up. The
// check is in ONE direction: no walk frame anywhere in the frame, and the idle
// sprite on the lamplighter. Whether a MOVING tick draws the sheet is the walk
// item's question.
//
// THE WORLD, AND WHY. An isolated world holding nothing at all, with no key
// held, so `specs/world.md`'s "movement direction is the sum of the unit
// vectors of the held actions" is the zero vector on every tick driven and
// nothing else is on the field to be confused with the lamplighter. Ten ticks
// rather than one, so a build that draws the sheet's first frame while still
// cannot pass on the one tick before its animation starts.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import {
  LAMPLIGHTER_IDLE_PATH,
  STAGE_CX,
  STAGE_CY,
  assetFile,
} from "../constants";
import {
  blitsNearStage,
  captureStill,
  createHarness,
  isolate,
  type Harness,
} from "../harness";
import { SPRITE_TOL, walkFiles } from "./sprites";

/** How many still ticks are read. */
const STILL_TICKS = 10;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("draws the idle sprite and no walk frame on a still tick", async () => {
  isolate(h);
  const idle = assetFile(LAMPLIGHTER_IDLE_PATH);
  const walk = walkFiles();

  for (let tick = 1; tick <= STILL_TICKS; tick += 1) {
    const blits = await h.frameBlits();
    const centre = blitsNearStage(h, blits, STAGE_CX, STAGE_CY, SPRITE_TOL);
    assertTrue(
      centre.some((blit) => blit.id === idle),
      `${idle} drawn on the lamplighter on still tick ${tick}`,
    );
    assertEqual(
      blits.filter((blit) => walk.includes(blit.id)).length,
      0,
      `walk frames drawn anywhere on still tick ${tick}`,
    );
  }
  captureStill(h, "idle");
});
