// presentation/walk-frame-counts-moved-ticks — the cycle counts MOVED ticks, not
// ticks.
//
// THE REQUIREMENT. `specs/assets.md` — "Animation": the walk frame is
// "`floor(m x TICK_DT / WALK_FRAME_TIME) mod 6`, with `m` the number of ticks of
// this run on which the lamplighter moved". The clause this point decides is what
// `m` counts: a build that drives the cycle off the run clock, or off a timer
// that keeps running while the lamplighter stands still, reads the same as a
// conformant one until the lamplighter stops.
//
// THE SCENARIO, AND THE FIGURE IT LANDS ON. Six ticks of held `right`, thirty
// ticks with no key down, then six more of held `right`. `m` is `12`, so the
// frame is `floor(12 x (1/60) / 0.1) mod 6`, which is `2`. Off the run clock
// `m` would be `42` and the frame `floor(0.7 / 0.1) mod 6`, which is `1`, so the
// two readings differ and the point separates them. The thirty still ticks are
// half a second, five frames' worth of the cycle, which is long enough that no
// rounding puts a clock-driven build back on frame `2`.
//
// WHY THE WORLD IS POSED AS IT IS. An emptied night with every faculty held:
// nothing else is on the field, so the only `24 x 32` sprite a frame can draw is
// the lamplighter's, and no enemy, drop, or level-up interrupts the twelve moved
// ticks. There is no tolerance: the frame index is a whole number the
// specification computes exactly. The one allowance is the sheet's own: a build
// whose walk cycle repeats a picture has two indices nothing looking at the
// canvas can tell apart, so both sides of the comparison are read as the lowest
// index drawing the same picture. It costs the point nothing here, because the
// reading it has to separate — frame `1`, which a clock-driven cycle would be on
// — is a different picture from frame `2` in any sheet whose frames are not all
// one picture.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import { captureStill, createHarness, isolate, type Harness } from "../harness";
import { primeSources } from "./sources";
import { LAMPLIGHTER_FILES, postureName, postureOf, walkClasses } from "./walk";

/** The scenario: six moved ticks, thirty still ones, six more moved. */
const FIRST_MOVED = 6;
const STILL = 30;
const SECOND_MOVED = 6;

/** `floor((6 + 6) x (1/60) / 0.1) mod 6`. */
const EXPECTED_FRAME = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("advances the walk frame on moved ticks alone", async () => {
  await isolate(h);
  await primeSources(h, LAMPLIGHTER_FILES);

  await h.hold("ArrowRight");
  await h.step(FIRST_MOVED);
  await h.release("ArrowRight");
  await h.step(STILL);
  await h.hold("ArrowRight");
  try {
    await h.step(SECOND_MOVED);
  } finally {
    await h.release("ArrowRight");
  }

  const posture = await postureOf(h, await h.lastCalls());
  await captureStill(h, "counted");
  assertTrue(
    !posture.idle,
    "a walk frame on the twelfth moved tick, rather than " +
      `${postureName(posture)} (specs/assets.md)`,
  );
  const classes = await walkClasses(h);
  assertEqual(
    posture.idle ? -1 : classes[posture.frame]!,
    classes[EXPECTED_FRAME]!,
    `the walk frame after ${FIRST_MOVED} moved ticks, ${STILL} still ones, ` +
      `and ${SECOND_MOVED} more moved ones, which is floor(12 / 6) mod 6 ` +
      "(specs/assets.md)",
  );
});
