// worm/length-per-level — the worm a level brings in carries the length the
// formula gives.
//
// specs/worm.md, "Length and entry": "A level brings in one worm, carrying
//
//   wormLength(level) = WORM_BASE_LENGTH + WORM_LENGTH_PER_LEVEL * (level - 1)
//
// segments, with `WORM_BASE_LENGTH` (`10`) and `WORM_LENGTH_PER_LEVEL` (`2`). That
// is `10` segments at level 1 and `32` at level 12." The formula is written out
// here from the two named figures rather than taken from a helper, so what the
// check holds the build to is the form the spec states.
//
// THREE LEVELS, THE ENDS AND A MIDDLE. Levels 1, 6 and 12: a build that ignored
// the level reads `10` at all three, one that used the wrong multiplier reads `10`,
// `15` and `21` at a step of one, and one that ran the formula off the wrong base
// misses all three. Each is posed and entered on its own, with `reset` between, so
// no level's worm can be counted at another's.
//
// THE ENTRY GATE IS TURNED BACK ON, AND IT IS THIS POINT'S REQUIREMENT.
// `startPlaying` shuts `wormEntry` so no other check is invaded by a worm it did
// not pose; the worm a LEVEL brings in is what this point is about, so it is one of
// the handful of checks that turn the gate back on. `foeSpawning` and the cursor's
// contact test stay shut, so nothing else arrives and no life is lost mid-scenario.
//
// HOW THE WORM IS BROUGHT IN. specs/progression.md: "When the `banner` phase's
// timer runs out, the phase becomes `active` and the level's worm enters ... at
// that moment and at no other." So the scenario poses the banner phase with its
// timer at zero and runs frames until a worm is on the board. The sweep is given
// twice `BANNER_TIME` so a build that re-arms its own banner timer when the phase
// is set still enters inside the window; how long a banner is shown is
// `progression.banner-shows`'s requirement, not this one's.

import { afterEach, beforeEach, it } from "vitest";
import {
  BANNER_TIME,
  WORM_BASE_LENGTH,
  WORM_LENGTH_PER_LEVEL,
} from "../../src/constants";
import { assertEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  startPlaying,
  ticksFor,
  type Harness,
  type UntilResult,
} from "../harness";

/** The levels posed: the two ends of the run and one in the middle. */
const LEVELS = [1, 6, 12];

/** The segments a level's worm carries, straight off the form specs/worm.md states. */
function dueLength(level: number): number {
  return WORM_BASE_LENGTH + WORM_LENGTH_PER_LEVEL * (level - 1);
}

/** How long the banner may take to give way before the sweep gives up, in frames. */
const ENTRY_TIMEOUT = ticksFor(BANNER_TIME * 2);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/** Pose a fresh run at `level` and run frames until its worm is on the board. */
async function enterAt(level: number): Promise<UntilResult> {
  h.debug.reset();
  startPlaying(h);
  h.debug.setLevel(level);
  h.debug.setWormEntry(true);
  h.debug.setPhase("banner");
  h.debug.setPhaseTimer(0);
  return h.until((s) => s.worms.length > 0, {
    maxFrames: ENTRY_TIMEOUT,
    poll: 1,
  });
}

it("enters a worm of the level's own length at levels 1, 6 and 12", async () => {
  const entries: UntilResult[] = [];
  for (const level of LEVELS) entries.push(await enterAt(level));
  captureStill(h, "entered");

  LEVELS.forEach((level, index) => {
    const swept = entries[index];
    assertEqual(
      swept.hit,
      true,
      `level ${level}: a worm on the board within ${ENTRY_TIMEOUT} frames of ` +
        "the banner's timer running out",
    );
    assertLength(
      swept.snapshot.worms,
      1,
      `level ${level}: worms the level brought in`,
    );
    assertLength(
      swept.snapshot.worms[0].segments,
      dueLength(level),
      `level ${level}: the segments the entering worm carries`,
    );
  });
});
