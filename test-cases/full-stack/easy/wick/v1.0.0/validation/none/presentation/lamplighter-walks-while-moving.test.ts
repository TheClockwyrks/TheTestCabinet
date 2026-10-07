// presentation/lamplighter-walks-while-moving — the walk cycle advances one frame
// per six moved ticks and wraps.
//
// THE REQUIREMENT, AND WHERE EVERY FIGURE COMES FROM. `specs/assets.md` —
// "Animation": "The lamplighter draws the walk sheet on a tick with a non-zero
// movement direction and the idle sprite on every other tick. The walk frame is
// `floor(m x TICK_DT / WALK_FRAME_TIME) mod 6`, with `m` the number of ticks of
// this run on which the lamplighter moved, so the cycle advances one frame per
// `WALK_FRAME_TIME` seconds of movement and wraps." `WALK_FRAME_TIME` is `0.1`
// and `TICK_DT` is `1/60`, so the frame after `m` moved ticks is
// `floor(m / 6) mod 6`: one frame per six moved ticks, wrapping after
// thirty-six.
//
// WHY SIXTY TICKS. Sixty carries the cycle past its own end: `m` reaches `36` on
// the thirty-sixth tick, where `floor(36 / 6) mod 6` wraps from `5` back to `0`,
// and the last twenty-four ticks read the second pass. A run of thirty-five would
// see six frames in order and never see them wrap.
//
// WHY THE WORLD IS POSED AS IT IS. An emptied night with every faculty held, and
// one key held down for the whole run: `specs/world.md` gives `right` the unit
// vector `(1, 0)`, so every one of the sixty ticks has a non-zero movement
// direction and `m` counts every one of them. Nothing else is on the field, so
// the only `24 x 32` sprite a frame can draw is the lamplighter's.
//
// WHAT IS READ. Which of the six produced walk files each frame drew, decided by
// the file's own pixels: `specs/assets.md` numbers them `0.png` to `5.png` and
// states the animation as an index into that numbering, so the index is the
// reading. There is no tolerance: the frame index is a whole number the
// specification computes exactly.
//
// THE ONE ALLOWANCE, AND WHY IT COSTS THE POINT NOTHING. `specs/assets.md` fixes
// six files and never requires six different pictures, and a build whose cycle
// repeats a frame — a gait whose second half redraws its first — has two indices
// that nothing looking at the canvas can tell apart. So the sequence is compared
// UP TO the sheet's own identical frames: each index is read as the lowest index
// drawing the same picture, on both sides of the comparison. The cadence, the
// order and the wrap are all still decided, because a build that advanced one
// frame every five ticks, or that played its distinct frames out of order, still
// reads differently.

import { afterEach, beforeEach, it } from "vitest";
import {
  LAMPLIGHTER_WALK_FRAMES,
  TICK_DT,
  WALK_FRAME_TIME,
} from "../constants";
import { assertEqual, assertTrue } from "../assert";
import {
  captureReplay,
  createHarness,
  isolate,
  type Harness,
} from "../harness";
import { primeSources } from "./sources";
import { LAMPLIGHTER_FILES, postureName, postureOf, walkClasses } from "./walk";

/** How many moved ticks are read: past the wrap and well into the second pass. */
const TICKS = 60;

/** "The walk frame is `floor(m x TICK_DT / WALK_FRAME_TIME) mod 6`". */
function walkFrame(moved: number): number {
  return (
    Math.floor((moved * TICK_DT) / WALK_FRAME_TIME) % LAMPLIGHTER_WALK_FRAMES
  );
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("plays the walk cycle in order, one frame per six moved ticks", async () => {
  await isolate(h);
  await primeSources(h, LAMPLIGHTER_FILES);

  const drawn: number[] = [];
  await captureReplay(h, "walk", async () => {
    await h.hold("ArrowRight");
    try {
      for (let tick = 1; tick <= TICKS; tick += 1) {
        await h.step(1);
        const posture = await postureOf(h, await h.lastCalls());
        assertTrue(
          !posture.idle,
          `a walk frame on moved tick ${tick}, rather than ` +
            `${postureName(posture)} (specs/assets.md)`,
        );
        drawn.push(posture.idle ? -1 : posture.frame);
      }
    } finally {
      await h.release("ArrowRight");
    }
  });

  const classes = await walkClasses(h);
  const expected = Array.from(
    { length: TICKS },
    (_unused, index) => classes[walkFrame(index + 1)]!,
  );
  assertEqual(
    drawn.map((frame) => classes[frame]!).join(","),
    expected.join(","),
    `the walk frame drawn on each of ${TICKS} ticks of held right, which is ` +
      "floor(m / 6) mod 6 for m the moved ticks so far (specs/assets.md)",
  );
});
