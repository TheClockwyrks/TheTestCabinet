// hurt/flash-drawn — the frame drawn while the flash runs differs from the frame
// drawn without it, by more than the build's own frame-to-frame noise.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("`playing`", the HUD table):
// "Hurt | While `hurtFlash` is above `0`, a hurt cast over the view, so the
// stage drawn on a tick with `hurtFlash` above `0` differs from the stage drawn
// on the same state with `hurtFlash` at `0`. Its color, its shape, and its fade
// are yours." The sentence fixes the reading exactly, and this point is it:
// nothing here looks for a color, a shape, or a place, because the specification
// fixes none of them. specs/ui.md ("Presentation") is why: "Wick fixes no
// palette, no font, no layout, and no styling for any screen".
//
// WHAT "THE SAME STATE" IS MADE OF. Three frames of one night, all drawn at the
// same posed tick. The category's isolated night is drawn once with the flash at
// `0`; a rat is posed out of reach for one tick and taken away, and the night is
// drawn a second time, still with the flash at `0`; a rat is then posed
// overlapping the lamplighter for the one tick that arms the flash, the rat
// removed and the health it took restored, and the night drawn a third time. So
// the clock, the health, the level, the kills, the loadout, and the world are
// every frame's, and `hurtFlash` is the only thing that moved between the second
// frame and the third. The tick is posed on all three, because the run clock is
// drawn and would otherwise part the frames on its own: specs/instrumentation.md
// has `setTick` change "nothing else", and specs/world.md raises `tick` in phase
// 1 before the phases that read it, so a clock posed one short of the tick and
// stepped once draws that tick.
//
// WHY THE SECOND FRAME STILL CARRIES A FLASH. specs/world.md ("Timers") counts
// the timer down by `TICK_DT` a tick and holds it at 0 only once a count-down
// would take it below `TICK_DT / 2`, so the single tick between the arming and
// the drawing leaves `0.3 - 1/60`, well above 0 — which the reading taken off
// each frame's own snapshot states rather than assumes.
//
// THE TOLERANCE. Neither figure is the specification's, and both are what a
// reading of an unfixed appearance needs. A channel differs at all (`CHANNEL_TOL`
// `0`), so anything a build redraws is counted. What the reading rests on is not
// that two frames of one state are identical, which is nothing the specification
// promises: specs/ui.md has `simTime` accumulate "on every frame, whatever the
// screen", so a build is free to drift a glow or a flicker off it while the
// night stands still. So the first two frames MEASURE that drift, over the same
// tick and the same driving the arming imposes, and `CAST_MIN` is what the cast
// must part the pair by ON TOP OF it: 64 pixels, an eight-by-eight patch, far
// below any cast drawn over a `1280 x 720` view and far above a pair that drew
// no cast at all.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertGreaterThan,
  assertGreaterThanOrEqual,
  assertNear,
} from "../assert";
import { TIMER_TOL } from "../constants";
import {
  captureReplay,
  createHarness,
  pixelsDiffering,
  type Harness,
} from "../harness";
import {
  armAlone,
  drawFrame,
  flashOf,
  missAlone,
  poseNight,
  stageFrame,
} from "./flash";

/** How far a channel may drift before two pixels of one scene count as different. */
const CHANNEL_TOL = 0;

/**
 * How many pixels the cast must part its pair by BEYOND the pixels the same
 * night parts a pair of its own by, which is what says a player sees a cast.
 */
const CAST_MIN = 64;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the stage differently on a tick whose hurtFlash is above 0", async () => {
  await poseNight(h);

  const read = await captureReplay(h, "flash", async () => {
    const clear = await drawFrame(h);
    const first = await stageFrame(h);
    await missAlone(h);
    const quiet = await drawFrame(h);
    const second = await stageFrame(h);
    await armAlone(h);
    const flashing = await drawFrame(h);
    const cast = await stageFrame(h);
    return { clear, first, quiet, second, flashing, cast };
  });

  assertNear(
    flashOf(read.clear),
    0,
    TIMER_TOL,
    "run.hurtFlash on the first frame drawn without a flash",
  );
  assertNear(
    flashOf(read.quiet),
    0,
    TIMER_TOL,
    "run.hurtFlash on the second frame drawn without a flash",
  );
  assertGreaterThan(
    flashOf(read.flashing),
    0,
    "run.hurtFlash on the frame drawn while the flash runs",
  );

  // What the night parts a pair of its own by, over the same tick and the same
  // driving: the floor everything the cast is credited with stands above.
  const floor = pixelsDiffering(read.first, read.second, CHANNEL_TOL);
  assertGreaterThanOrEqual(
    pixelsDiffering(read.second, read.cast, CHANNEL_TOL),
    floor + CAST_MIN,
    `the pixels of the stage that part between hurtFlash 0 and hurtFlash above 0, over the ${floor} the same night parts on its own`,
  );
});
