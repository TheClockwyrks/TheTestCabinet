// presentation/walk-frame-counts-moved-ticks — the walk cycle counts the ticks
// the lamplighter MOVED on, and a pause in movement advances it not at all.
//
// WHERE THE FIGURE COMES FROM. `specs/assets.md`, Animation: "The walk frame is
// `floor(m x TICK_DT / WALK_FRAME_TIME) mod 6`, with `m` the number of ticks of
// this run on which the lamplighter moved, so the cycle advances one frame per
// `WALK_FRAME_TIME` seconds of movement and wraps." `WALK_FRAME_TIME` is `0.1`
// seconds, which `specs/world.md`'s timer rule ("An interval of `s` seconds
// anywhere in this specification is likewise `round(s x TICK_HZ)` ticks") makes
// exactly six ticks, so the frame is `floor(m / 6) mod 6` in whole ticks with
// no rounding to argue about.
//
// THE DRIVE. Six moved ticks, thirty still ticks, six more moved ticks. `m` is
// `12`, never `42`: the thirty still ticks have a zero movement direction
// (`specs/world.md`, Movement), so they are not moved ticks and the still
// sprite is what they draw. `floor(12 / 6) mod 6` is frame `2`, and a build
// that counted every tick of the run instead would be at `floor(42 / 6) mod 6`,
// frame `1`; one that restarted the cycle at each new hold would be at frame
// `1` too, from `m = 6`. So the one frame number read here separates counting
// moved ticks from both of the wrong readings.
//
// THE BOUND. None: one exact frame number off the six produced file names,
// within `SPRITE_TOL` (2 device pixels) of the stage centre `specs/ui.md` puts
// the lamplighter at.
//
// THE WORLD, AND WHY. An isolated world holding nothing, so nothing else is on
// the field and the run is fresh, with `m` at `0`. `ArrowRight` alone is held
// for each moving span, which `specs/world.md` makes a movement direction of
// `(1, 0)`, and no key at all is held through the pause.

import { afterEach, beforeEach, it } from "vitest";
import { assertContains, assertNotNull } from "../assert";
import { STAGE_CX, STAGE_CY } from "../constants";
import {
  advanceTicks,
  blitsNearStage,
  blitsOf,
  captureStill,
  createHarness,
  hold,
  isolate,
  type Blit,
  type Harness,
} from "../harness";
import { framesOf, SPRITE_TOL, walkFiles } from "./sprites";

/** The three spans of the drive, in ticks. */
const FIRST_MOVE = 6;
const PAUSE = 30;
const SECOND_MOVE = 6;

/** `floor(12 / 6) mod 6`, the frame owed once twelve ticks have moved. */
const OWED_FRAME = 2;

/** The walk frames the lamplighter's own sprite could be showing this frame. */
function framesAtStageCentre(
  blits: readonly Blit[],
  walk: readonly string[],
): number[] | null {
  const drawn = blitsNearStage(h, blits, STAGE_CX, STAGE_CY, SPRITE_TOL).filter(
    (blit) => walk.includes(blit.id),
  );
  return drawn.length === 0 ? null : framesOf(walk, drawn[drawn.length - 1].id);
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("draws walk frame 2 after 6 moved, 30 still, and 6 more moved ticks", async () => {
  isolate(h);
  const walk = walkFiles();

  await hold(h, "ArrowRight", FIRST_MOVE);
  await advanceTicks(h, PAUSE);

  // The frame read is the last one the hold ran, which is the twelfth moved
  // tick: the harness keeps the operations of the frame that ran most recently.
  await hold(h, "ArrowRight", SECOND_MOVE);
  const blits = blitsOf(h.lastCalls());
  captureStill(h, "counted");

  const frames = framesAtStageCentre(blits, walk);
  assertNotNull(
    frames,
    "a produced walk frame drawn on the lamplighter's twelfth moved tick",
  );
  assertContains(
    frames as number[],
    OWED_FRAME,
    "the walk frame drawn on the twelfth moved tick, after a thirty-tick pause",
  );
});
