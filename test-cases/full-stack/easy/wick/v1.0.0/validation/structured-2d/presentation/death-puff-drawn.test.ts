// presentation/death-puff-drawn — a death puff plays through where an enemy
// died, its four frames in order over the twenty-four ticks after the death.
//
// WHERE THE FIGURES COME FROM. `specs/assets.md`, Animation: "The death puff is
// drawn centered on the position an enemy died at, frame
// `floor(t / (PUFF_TIME / 4))` for `t` the seconds of ticks since the tick it
// died, in `[0, PUFF_TIME)`, and is gone after. It is a picture, and it damages
// nothing." `PUFF_TIME` is `0.4` seconds, which `specs/world.md`'s timer rule
// ("An interval of `s` seconds anywhere in this specification is likewise
// `round(s x TICK_HZ)` ticks") makes 24 ticks, six a frame. The sheet is the
// produced `assets/sprites/puff/0.png` to `3.png`, "shared by every enemy"
// (`specs/assets.md`, "The sprites"), so a blit's file name is which frame is
// up, and the puff has no place in the state at all: it is read off the frame
// alone.
//
// WHERE THE SAMPLES SIT, AND WHY MID-RUN. One reading in the MIDDLE of each
// six-tick run, at 2, 8, 14, and 20 ticks after the tick the moth died, which
// the formula puts a third of the way into frames 0, 1, 2, and 3. Reading
// mid-run rather than on a boundary is deliberate: `PUFF_TIME / 4` is `0.1`,
// which is not exactly representable, so a build that accumulates `t` a tick at
// a time and one that multiplies its tick count by `TICK_DT` can land on
// opposite sides of a boundary, and neither is wrong.
//
// THE BOUND. Four exact frame numbers, in order, off the four produced file
// names, each drawn within `SPRITE_TOL` (2 device pixels) of the point the moth
// died at. That the puff is GONE after the twenty-four ticks is its own item.
//
// THE WORLD, AND WHY. The arrangement `puff.ts` describes: an isolated world
// holding one moth with a puddle over it and just enough health to die to its
// first pulse. The gem the death drops lands on the same point and is drawn
// there too, which is why the reading names the puff's own four files rather
// than whatever was drawn at the spot.

import { afterEach, beforeEach, it } from "vitest";
import { assertContains, assertNotNull, assertUndefined } from "../assert";
import {
  captureReplay,
  createHarness,
  enemyById,
  type Harness,
} from "../harness";
import { DEATH_AT, poseDoomedMoth } from "./puff";
import { framesAt, puffFiles } from "./sprites";

/** Ticks after the death, and the puff frame owed at each. */
const SAMPLES: readonly { at: number; frame: number }[] = [
  { at: 2, frame: 0 },
  { at: 8, frame: 1 },
  { at: 14, frame: 2 },
  { at: 20, frame: 3 },
];

/** How far the drive runs: past the last sample, inside the 24-tick life. */
const DRIVE_TICKS = 21;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("plays puff frames 0 to 3 in order where the moth died", async () => {
  const id = poseDoomedMoth(h);

  const files = puffFiles();
  const drawn: (number[] | null)[] = [];
  await captureReplay(h, "puff", async () => {
    // The first frame runs the tick the moth dies on, which is `t = 0`.
    const first = await h.frameBlits();
    assertUndefined(
      enemyById(h.snapshot(), id),
      "the moth gone from the field on the tick the puddle's pulse killed it",
    );
    drawn.push(framesAt(h, first, files, DEATH_AT.x, DEATH_AT.y));
    for (let tick = 1; tick <= DRIVE_TICKS; tick += 1) {
      const blits = await h.frameBlits();
      drawn.push(framesAt(h, blits, files, DEATH_AT.x, DEATH_AT.y));
    }
  });

  for (const sample of SAMPLES) {
    const frames = drawn[sample.at];
    assertNotNull(
      frames,
      `a produced puff frame drawn where the moth died, ${sample.at} ticks after`,
    );
    assertContains(
      frames as number[],
      sample.frame,
      `the puff frame drawn ${sample.at} ticks after the moth died`,
    );
  }
});
