// modes/hundred-has-no-build-phases — clearing the onslaught ends the run instead
// of opening a build phase.
//
// THE RULE. `specs/modes.md`: The Hundred has "one untimed opening phase and no
// build phase between waves, because there is one wave", and its table gives the
// mode `1` under Waves and `no` under Build phases. `specs/waves.md` says the
// other half: "Clearing Wave `N` ends the run rather than advancing, so the number
// never passes `N`" — and on this mode `N` is the onslaught.
//
// HOW THE END OF THE ONSLAUGHT IS REACHED. Posed, not released. A wave clears "on
// the frame in which its last live unit dies or leaks with none of it left to
// release" (`specs/waves.md`), so the end-of-wave shape is `wavePending` at `0`
// with one live unit — and that shape is posed directly, with one Mote two tiles
// short of its exhaust, walking. Releasing a hundred units to watch what happens
// after the hundredth would make this verdict depend on the spawner, the cadence
// and the composition, all of which `modes.hundred-releases-one-hundred` decides.
// The clear itself is reached through the game's own transition rather than posed,
// because the transition IS the requirement.
//
// WHAT IS READ, AND IN WHICH DIRECTION. That no build phase opened: the phase is
// not `building`, the build timer is still `0`, and the wave number did not rise.
// A build that gave The Hundred a twenty-wave progression, or that opened a build
// phase after every wave regardless of the mode, lands on wave `2` in phase
// `building` with `BUILD_PHASE_TIME` on the clock — three different numbers, so a
// failure names which wrong model was built. That the run ends in VICTORY is
// `modes.hundred-victory`'s reading, and the interest such a phase would pay is
// `modes.hundred-figures`'s.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotEqual } from "../assert";
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
 * on the floor and walking when the drive begins, and near enough that the leak
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

it("opens no build phase when the onslaught clears", async () => {
  const { debug } = h;
  await startRun(h, "hundred");
  // The onslaught, at its last unit: the phase is `wave`, nothing is left to
  // release, and one Mote is on the floor about to reach its exhaust.
  await debug.setPhase("wave");
  await debug.setBuildTimer(0);
  await debug.setWavePending(0);
  const mote = await poseWalker(h, "mote", "left");
  await debug.setUnitPosition(
    mote,
    tileCX(LEAK_TILE.col),
    tileCY(LEAK_TILE.row),
  );

  const cleared = await h.until((snapshot) => snapshot.surge.length === 0, {
    maxFrames: framesFor(LEAK_WINDOW),
  });
  await captureStill(h, "nobuild");

  assertEqual(
    cleared.hit,
    true,
    "the last unit of the onslaught left the floor",
  );
  assertNotEqual(
    cleared.snapshot.phase,
    "building",
    "the phase the cleared onslaught left the run in",
  );
  assertEqual(
    cleared.snapshot.buildTimer,
    0,
    "the build timer after the clear",
  );
  assertEqual(
    cleared.snapshot.wave,
    1,
    "the wave number after the onslaught cleared",
  );
});
