// presentation/enemy-walk-frames — an enemy draws its sheet off its own age,
// one frame every WALK_FRAME_TIME, wrapping.
//
// WHERE THE THRESHOLD COMES FROM. specs/assets.md ("Animation"): "An enemy
// draws frame floor(age / WALK_FRAME_TIME) mod 4 of its sheet for as long as it
// lives", with WALK_FRAME_TIME 0.1 seconds, which specs/world.md's timer rule
// makes round(0.1 × TICK_HZ) = 6 ticks. Its sprite table fixes the files:
// "Each common enemy, a walk cycle | assets/sprites/enemies/<id>/0.png to
// 3.png". specs/world.md ("One tick") fixes how the age rises: "Every enemy
// ages by TICK_DT", in phase 4, which is not gated by any driver switch.
//
// THE WORLD. An isolated playing run (`isolate`): nothing else on the field, no
// weapon held, every driver switch off, so the moth neither moves, hits, nor
// takes a hit for the whole sweep, and the only thing that changes about it is
// its age. It is spawned clear of the lamplighter and its age is posed to
// POSED_AGE (0.25) seconds, which is 15 ticks, three ticks into frame 2's
// six-tick span.
//
// WHAT IS READ. On each of the SWEEP_TICKS ticks after the pose, the frame
// number carried by the file the moth's blit painted, against the moth's age in
// whole ticks on that tick. Every frame on `playing` runs a tick, so the first
// frame the pose can be read on is already one tick past it, at 16 ticks of
// age, still inside frame 2's span. The sweep covers frames 2, 3, 0, 1 and back
// to 2, which is the advance and the wrap from 3 to 0 together.
//
// TOLERANCE. Each tick's frame is asserted exactly, except a tick whose age
// falls exactly on a frame boundary, where the frame before it is also
// accepted: `assertFrameAt` states why.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertWithin } from "../assert";
import {
  ENEMY_FRAMES,
  FIGURE_TOLERANCE,
  WALK_FRAME_TIME,
  ticksFor,
} from "../constants";
import {
  blitsOf,
  captureReplay,
  createHarness,
  enemyById,
  isolate,
  present,
  spawnEnemyAt,
  type Harness,
} from "../harness";
import { assertFrameAt, drawnUnder, enemyDir, frameNumber } from "./drawn";

/** Where the moth stands: clear of the lamplighter and inside the view. */
const MOTH_AT = { x: 300, y: -60 };

/** The age posed, in seconds, and the same age in whole ticks. */
const POSED_AGE = 0.25;
const POSED_TICKS = ticksFor(POSED_AGE);

/** Ticks each frame of the sheet is shown: round(WALK_FRAME_TIME × TICK_HZ). */
const FRAME_TICKS = ticksFor(WALK_FRAME_TIME);

/** Ticks driven after the pose: four more frames of the sheet. */
const SWEEP_TICKS = 4 * FRAME_TICKS + 3;

/** The frame the sheet shows at an age of `ticks` whole ticks. */
function expected(ticks: number): number {
  return Math.floor(ticks / FRAME_TICKS) % ENEMY_FRAMES;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("advances a moth's sheet one frame every six ticks of age and wraps", async () => {
  const posed = isolate(h);
  assertEqual(posed.screen, "playing", "the screen the frames are drawn on");
  const mothId = spawnEnemyAt(h, "moth", MOTH_AT.x, MOTH_AT.y);
  h.debug.setEnemyAge(mothId, POSED_AGE);
  const placed = present(
    enemyById(h.snapshot(), mothId),
    "the moth spawned through the surface",
  );
  assertWithin(
    placed.age,
    POSED_AGE,
    FIGURE_TOLERANCE,
    "the moth's age as posed",
  );

  const drawn = await captureReplay(h, "frames", async () => {
    const frames: number[] = [];
    const read = (tick: number): void => {
      const blit = drawnUnder(
        blitsOf(h.lastCalls()),
        enemyDir("moth"),
        `moth at age tick ${tick}`,
      );
      frames.push(frameNumber(blit.id, "moth"));
    };
    for (let tick = 1; tick <= SWEEP_TICKS; tick += 1) {
      await h.tick(1);
      read(POSED_TICKS + tick);
    }
    return frames;
  });

  for (let tick = 1; tick <= SWEEP_TICKS; tick += 1) {
    const age = POSED_TICKS + tick;
    assertFrameAt(
      drawn[tick - 1],
      age,
      FRAME_TICKS,
      expected,
      `the moth's drawn frame at an age of ${age} ticks`,
    );
  }
});
