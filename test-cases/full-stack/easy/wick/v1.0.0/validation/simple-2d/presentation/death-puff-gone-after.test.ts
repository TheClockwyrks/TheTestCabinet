// presentation/death-puff-gone-after — the death puff is gone once its four
// frames have played.
//
// WHERE THE THRESHOLD COMES FROM. specs/assets.md ("Animation"): the puff is
// drawn "frame floor(t / (PUFF_TIME / 4)) for t the seconds of ticks since the
// tick it died, in [0, PUFF_TIME), and is gone after". PUFF_TIME is 0.4
// seconds, which specs/world.md's timer rule makes round(0.4 × TICK_HZ) = 24
// ticks, so the last tick a puff is drawn on is the 23rd after the death and
// the 24th draws none. The same section makes the puff a picture and nothing
// more: "It is a picture, and it damages nothing."
//
// THE WORLD. The one death `puff.ts` stages: an isolated playing run with every
// driver switch off, one moth clear of the lamplighter, and a Pin dart posed on
// top of it, so the tick after the pose kills it through the game's own hit
// resolution. Nothing else on the field draws, so a blit under `sprites/puff/`
// anywhere on a frame belongs to this death.
//
// WHAT IS READ. The blits under `sprites/puff/` on the 24th tick after the
// death and on each of the WATCHED_AFTER ticks after that. There are none, on
// any of them.
//
// TOLERANCE. None: the puff is drawn or it is not, and the tick it is read on
// is the one the timer rule names.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength } from "../assert";
import { PUFF_DIR, PUFF_TIME, ticksFor } from "../constants";
import {
  blitsOf,
  blitsUnderDir,
  captureStill,
  createHarness,
  type Harness,
} from "../harness";
import { killOneMoth } from "./puff";

/** Ticks the whole puff runs: round(PUFF_TIME × TICK_HZ). */
const PUFF_TICKS = ticksFor(PUFF_TIME);

/** Ticks watched past the puff's last, so "every tick after" has a witness. */
const WATCHED_AFTER = 12;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws no puff from the twenty-fourth tick after the death on", async () => {
  await killOneMoth(h);

  // The death tick has already been run, so PUFF_TICKS − 1 more ticks reach the
  // last tick the puff is drawn on and one more reaches the first that is not.
  await h.tick(PUFF_TICKS - 1);
  for (let tick = PUFF_TICKS; tick <= PUFF_TICKS + WATCHED_AFTER; tick += 1) {
    await h.frameDraw();
    if (tick === PUFF_TICKS) captureStill(h, "gone");
    assertLength(
      blitsUnderDir(blitsOf(h.lastCalls()), PUFF_DIR),
      0,
      `puff frames drawn ${tick} ticks after the death`,
    );
  }
});
