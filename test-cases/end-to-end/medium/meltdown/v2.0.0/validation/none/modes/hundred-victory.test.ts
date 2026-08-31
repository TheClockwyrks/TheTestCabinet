// modes/hundred-victory — clearing the onslaught with a life left wins the run.
//
// THE RULE. `specs/modes.md`: on The Hundred "the run is won when the onslaught
// is cleared with at least one life left". `specs/waves.md` gives the general
// form — "If the wave cleared was Wave `N`, the run ends in victory, and the
// victory screen opens" — and The Hundred's `N` is its one onslaught.
//
// HOW THE END OF THE ONSLAUGHT IS REACHED. Posed, not released. A wave clears "on
// the frame in which its last live unit dies or leaks with none of it left to
// release" (`specs/waves.md`), so the end-of-wave shape is `wavePending` at `0`
// with one live unit — and that shape is posed directly, with one Mote two tiles
// short of its exhaust, walking. Releasing a hundred units to watch what happens
// after the hundredth would make this verdict depend on the spawner, the cadence
// and the composition, all of which `modes.hundred-releases-one-hundred` decides.
// The clear itself is reached through the game's own transition rather than posed,
// because reaching victory IS the requirement.
//
// THE LIVES ARE LEFT WHERE THE ROW PUTS THEM, at The Hundred's `20`. One Mote
// leaking costs one life (`specs/surge.md`), so nineteen remain and the "at least
// one life left" condition is met with room to spare — which is the point: the
// condition must not be what decides this, since a leak that took the lives to
// `0` on the final wave ends the run in LOSS, and that is
// `modes.sudden-death-ends-on-one-leak`'s territory rather than this one's.
//
// WHAT IS READ. The victory screen, and nothing else. A build that ended the run
// in loss reads `gameover`, one that carried on reads `playing`, and one that
// opened a build phase instead is caught by
// `modes.hundred-has-no-build-phases`. What the victory screen DRAWS is
// `screens.victory-reports-the-run`'s, and the score it pays for the lives left
// is `economy.victory-score-bonus`'s.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThanOrEqual } from "../assert";
import { COLS, tileCX, tileCY } from "../constants";
import { LEFT_LANE_ROW } from "../fixtures";
import {
  captureStill,
  createHarness,
  framesFor,
  poseWalker,
  startRun,
  type Harness,
} from "../harness";

/**
 * Where the last unit of the onslaught is posed: two tiles short of the right
 * exhaust, on the left corridor's own row.
 *
 * Geometry, not a tolerance. Two tiles is far enough that the unit is genuinely
 * on the floor and walking when the drive begins, and near enough that the clear
 * costs a fraction of a second of game time.
 */
const LEAK_TILE = { col: COLS - 3, row: LEFT_LANE_ROW };

/**
 * How long the unit is given to cover those two tiles.
 *
 * A Mote covers `60` logical units a second (`specs/surge.md`) and two tiles is
 * `38`, so it arrives in under two thirds of a second. This is a ceiling on a
 * hung build rather than a bound on anything asserted, which is why it is loose.
 */
const LEAK_WINDOW = 2.0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("opens the victory screen when the onslaught clears with lives left", async () => {
  const { debug } = h;
  await startRun(h, "hundred");
  // The onslaught, at its last unit: the phase is `wave`, nothing is left to
  // release, and one Mote is on the floor about to reach its exhaust.
  await debug.setPhase("wave");
  await debug.setBuildTimer(0);
  await debug.setWavePending(0);
  const mote = await poseWalker(h, "mote", "left");
  await debug.setUnitPosition(mote, tileCX(LEAK_TILE.col), tileCY(LEAK_TILE.row));

  // The condition the rule attaches to victory, read before the clear rather
  // than after it: the run must be carrying at least one life into the last unit
  // going, and on this mode's row it carries twenty.
  const posed = await h.snapshot();
  assertGreaterThanOrEqual(
    posed.lives,
    1,
    "the lives the run carried into the last unit of the onslaught",
  );

  const cleared = await h.until((snapshot) => snapshot.surge.length === 0, {
    maxFrames: framesFor(LEAK_WINDOW),
  });
  await captureStill(h, "victory");

  assertEqual(cleared.hit, true, "the last unit of the onslaught left the floor");
  assertEqual(
    cleared.snapshot.screen,
    "victory",
    "the screen the cleared onslaught opened",
  );
});
