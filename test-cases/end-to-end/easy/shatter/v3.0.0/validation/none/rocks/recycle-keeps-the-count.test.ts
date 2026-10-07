// rocks/recycle-keeps-the-count — recycling is not a way to empty the field.
//
// `specs/rocks.md`, Star recycling: "A rock the star swallows is the same rock
// relocated, not a fresh one", and "Recycling scores nothing and leaves the field's
// rock count unchanged." `specs/progression.md` says why that matters: "Destroying
// rocks is the only way a wave clears, since the star recycles rather than
// removes." A build that removes the rock at the core hands the player a wave that
// clears itself, which is why this item is capped `broken`.
//
// ONE ROCK DECIDES IT, AND NOTHING ELSE ON THE FIELD CAN CONFUSE THE COUNT.
// `startPlaying` empties every roster and shuts both world gates — without the wave
// gate a build is entitled to notice an emptied field and put a whole wave into the
// reading — so the roster holds exactly the one rock this check placed. A build that
// removes it reads `0` where it must read `1`, and a build that leaves the old rock
// standing while spawning a replacement reads `2`.
//
// THE TWO TICKS ARE THE ONES EITHER SIDE OF THE RE-PLACEMENT, which is what the
// review item asks for: `slingIntoTheStar` sweeps a tick at a time and reports the
// last tick before the rock moved and the tick it moved on, so the comparison spans
// exactly the recycle and nothing else.
//
// THE RECYCLE IS FOUND AS A JUMP OF MORE THAN `200` UNITS INSIDE ONE TICK, measured
// across the seams. Nothing drifting can produce that even after a fall through the
// well, and a build that never recycles at all is therefore reported as one that
// never recycled rather than being read as one that did.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";
import { FALL_FROM, FALL_SPEED, poseRockAt, slingIntoTheStar } from "./scene";

/** How many rocks the field holds throughout: the one the check placed. */
const POSED_ROCKS = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("holds the same number of rocks the tick after a recycle as the tick before", async () => {
  await startPlaying(h);
  await poseRockAt(h, "large", FALL_FROM, { x: 0, y: FALL_SPEED });

  const recycle = await slingIntoTheStar(h);
  await captureStill(h, "recycle");

  assertEqual(
    recycle.before.rocks.length,
    POSED_ROCKS,
    "rocks on the field on the tick before the star took the one that reached it (specs/instrumentation.md)",
  );
  assertEqual(
    recycle.at.rocks.length,
    recycle.before.rocks.length,
    "rocks on the field on the tick the star recycled the one that reached it (specs/rocks.md)",
  );
});
