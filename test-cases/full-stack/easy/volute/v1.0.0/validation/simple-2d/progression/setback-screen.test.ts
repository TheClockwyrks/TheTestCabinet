// progression/setback-screen — a cell spent with cells left moves the game to
// `setback`.
//
// THE SPEC LINE. `specs/progression.md` — "Interludes and endings" — gives the
// row exactly:
//
//   | A cell spent with cells remaining | `setback` | the same level, after the
//     interlude |
//
// and the same file fixes what that interlude is worth: "An interlude lasts 2 s."
//
// WHY IT IS A POINT OF ITS OWN. The other rows of that table are graded already —
// `cleared` by `progression/level-cleared`, `victory` by `progression/victory`,
// `gameover` by `progression/game-over` — and `setback` is the fourth. It is the
// one screen of the four a build reaches by a cell spend that does NOT end the
// run, so a build that sends every spend to `gameover`, or that restarts the
// level with no screen between, is caught here and nowhere else.
//
// THE DRIVE. Level 1, three cells standing (what a reset leaves), one core posed
// 20 units short of the intake, and the hall run until the cell count moves. The
// quota is left part-spent and the inlet held by `poseHall`, so the channel the
// spend empties does not then clear the level — which would put `cleared` on the
// screen a tick later and make the reading ambiguous.
//
// WHAT IS READ. The screen on the tick the cell was spent, and the seconds left
// of the interlude that screen holds. The interlude is read because the row's
// third column is "the same level, after the interlude": a build that shows
// `setback` for one frame and restarts at once has no interlude standing, and a
// build that holds it forever is caught by `progression/cell-lost-at-intake`'s
// sibling reading of the restart.
//
// TOLERANCES. The screen name and the cell count are exact. The interlude is read
// on the tick it opened, so an ideal build reports exactly 2.0 s and the tolerance
// is the case's standing +/- 2 ticks on a duration, which is slack for a build
// that has already taken this tick's decrement off it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear, assertTrue } from "../assert";
import { CELLS, INTAKE_S, INTERLUDE, TICK_DT, TICK_TOL } from "../constants";
import {
  captureReplay,
  createHarness,
  poseHall,
  type Harness,
} from "../harness";

/** Where the arriving core is posed: 20 units short of the intake. */
const POSED_S = INTAKE_S - 20;

/** Comfortably past the 55 ticks the ride takes at level 1's feed speed. */
const MAX_TICKS = 90;

/** Ticks kept after the spend, so the replay shows the screen it settled on. */
const SETTLE_TICKS = 30;

/** The +/- 2 ticks the case's standing tolerances put on a duration, in seconds. */
const DURATION_TOL = TICK_TOL * TICK_DT;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("moves to the setback screen when a cell is spent with cells remaining", async () => {
  await poseHall(h, {
    level: 1,
    pressure: 0,
    cores: [[POSED_S, "halide", null]],
  });

  const posed = await h.snapshot();
  assertEqual(
    posed.cells,
    CELLS,
    "the cells standing before the spend, so the run has cells remaining",
  );

  const swept = await captureReplay(h, "setback", async () => {
    const found = await h.stepUntil((snapshot) => snapshot.cells !== CELLS, {
      maxTicks: MAX_TICKS,
      poll: 1,
    });
    await h.step(SETTLE_TICKS);
    return found;
  });

  assertTrue(
    swept.hit,
    `a cell spent within ${MAX_TICKS} ticks of a core posed ` +
      `${INTAKE_S - POSED_S} units short of the intake`,
  );
  assertEqual(
    swept.snapshot.cells,
    CELLS - 1,
    "the cells left, so this is a spend WITH cells remaining",
  );
  assertEqual(
    swept.snapshot.screen,
    "setback",
    "the screen on the tick a cell was spent with cells remaining",
  );
  assertNear(
    swept.snapshot.interlude,
    INTERLUDE,
    DURATION_TOL,
    "the seconds left of the interlude the setback screen opened",
  );
});
