// presentation/walk-frame-counts-moved-ticks — the walk cycle counts the ticks
// the lamplighter MOVED, not the ticks that passed.
//
// WHERE THE THRESHOLD COMES FROM. specs/assets.md ("Animation"): "The walk
// frame is floor(m × TICK_DT / WALK_FRAME_TIME) mod 6, with m the number of
// ticks of this run on which the lamplighter moved, so the cycle advances one
// frame per WALK_FRAME_TIME seconds of movement and wraps." WALK_FRAME_TIME is
// 0.1 seconds, which specs/world.md's timer rule makes round(0.1 × TICK_HZ) = 6
// ticks. specs/world.md ("Movement") fixes when a tick moves: the movement
// direction is the sum of the held actions' unit vectors, so a tick with no
// action held has none.
//
// THE WORLD. An isolated playing run (`isolate`): nothing on the field, no
// weapon held, every driver switch off. ArrowRight is held for WALKED_FIRST
// ticks, released for STILL_TICKS, and held again for WALKED_AGAIN, so
// WALKED_FIRST + WALKED_AGAIN = 15 ticks moved out of 45 passed. The three
// stretches are what separates the two counters: at 15 moved ticks the cycle
// stands on frame 2, and a build counting all 45 ticks stands on frame 1.
//
// WHAT IS READ. The frame number the file drawn on the last held tick carries.
// Fifteen ticks sits in the middle of frame 2's six-tick span rather than on
// either boundary, so no arithmetic a build spells the formula with can land it
// elsewhere.
//
// TOLERANCE. None: the frame is a whole number read off a file name, and the
// tick it is read on is three ticks clear of the nearest boundary.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  BINDINGS,
  LAMPLIGHTER_WALK_DIR,
  LAMPLIGHTER_WALK_FRAMES,
  WALK_FRAME_TIME,
  ticksFor,
} from "../constants";
import {
  blitsOf,
  captureStill,
  createHarness,
  hold,
  isolate,
  type Harness,
} from "../harness";
import { LAMPLIGHTER_DIR, drawnUnder, frameNumber } from "./drawn";

/** The first key specs/controls.md binds to `right`: ArrowRight. */
const KEY = BINDINGS.right[0];

/** Ticks each frame of the cycle is shown: round(WALK_FRAME_TIME × TICK_HZ). */
const FRAME_TICKS = ticksFor(WALK_FRAME_TIME);

/** The three stretches: moved, still, moved. */
const WALKED_FIRST = 9;
const STILL_TICKS = 30;
const WALKED_AGAIN = 6;

/** The ticks moved, and the frame the cycle stands on after them. */
const MOVED = WALKED_FIRST + WALKED_AGAIN;
const EXPECTED = Math.floor(MOVED / FRAME_TICKS) % LAMPLIGHTER_WALK_FRAMES;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("stands on the frame the moved ticks alone give, across a pause in movement", async () => {
  const posed = isolate(h);
  assertEqual(posed.screen, "playing", "the screen the frames are drawn on");

  await hold(h, KEY, WALKED_FIRST);
  // The release lands on the first of these, so every one of them is still.
  await h.tick(STILL_TICKS);
  await hold(h, KEY, WALKED_AGAIN);
  captureStill(h, "counted");

  const blit = drawnUnder(
    blitsOf(h.lastCalls()),
    LAMPLIGHTER_DIR,
    "lamplighter on the last moved tick",
  );
  assertEqual(
    blit.id.startsWith(`assets/${LAMPLIGHTER_WALK_DIR}/`),
    true,
    "a walk frame on the last moved tick, the file drawn",
  );
  assertEqual(
    frameNumber(blit.id, "walk"),
    EXPECTED,
    `the walk frame after ${WALKED_FIRST} moved, ${STILL_TICKS} still, and ${WALKED_AGAIN} moved ticks`,
  );
});
