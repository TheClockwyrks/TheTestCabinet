// presentation/death-puff-gone-after — the death puff is over on the
// twenty-fourth tick after the death, and on every tick after that.
//
// WHERE THE FIGURE COMES FROM. `specs/assets.md`, Animation: the puff is drawn
// "frame `floor(t / (PUFF_TIME / 4))` for `t` the seconds of ticks since the
// tick it died, in `[0, PUFF_TIME)`, and is gone after." `PUFF_TIME` is `0.4`
// seconds. `specs/world.md`, Timers, fixes what that is in ticks with no
// rounding to argue about: "An interval of `s` seconds anywhere in this
// specification is likewise `round(s × TICK_HZ)` ticks", so the half-open
// window `[0, PUFF_TIME)` is the 24 ticks numbered 0 to 23 and the puff is gone
// from tick 24 on.
//
// THE BOUND. None: on the 24th tick after the death and on the six after it,
// none of the four produced puff files is drawn ANYWHERE in the frame — not
// merely away from the spot, because a puff left running is a puff wherever a
// build put it. Six extra ticks rather than one, so a build whose puff comes
// back, or which restarts the sheet, fails here rather than passing on the one
// tick it happened to be clear.
//
// THE WORLD, AND WHY. The arrangement `puff.ts` describes: an isolated world
// holding one moth with a puddle over it and just enough health to die to its
// first pulse, the only death in the whole drive, so the only puff that can be
// drawn is this one's. No other enemy is on the field, so no second death can
// start a puff inside the window.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertUndefined } from "../assert";
import {
  captureStill,
  createHarness,
  enemyById,
  type Harness,
} from "../harness";
import { poseDoomedMoth } from "./puff";
import { puffFiles } from "./sprites";

/** The tick, counted from the death, on which the puff is owed to be gone. */
const PUFF_TICKS = 24;

/** How many ticks past that are read. */
const AFTER_TICKS = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("draws no puff frame from the twenty-fourth tick after the death on", async () => {
  const id = poseDoomedMoth(h);
  const files = puffFiles();

  // The first frame runs the tick the moth dies on, which is `t = 0`.
  await h.frameBlits();
  assertUndefined(
    enemyById(h.snapshot(), id),
    "the moth gone from the field on the tick the puddle's pulse killed it",
  );

  for (let tick = 1; tick < PUFF_TICKS; tick += 1) await h.frameBlits();

  for (let tick = PUFF_TICKS; tick <= PUFF_TICKS + AFTER_TICKS; tick += 1) {
    const blits = await h.frameBlits();
    if (tick === PUFF_TICKS) captureStill(h, "gone");
    assertEqual(
      blits.filter((blit) => files.includes(blit.id)).length,
      0,
      `puff frames drawn anywhere ${tick} ticks after the moth died`,
    );
  }
});
