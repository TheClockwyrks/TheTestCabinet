// resonance/discharge-kills-prism-outright — a diving Prism with its shell intact
// is removed entirely by the wave rather than losing only its shell.
//
// THE RULE. `specs/resonance.md` gives the Prism its own row of the wave table:
// "A Prism in one of those phases | It is destroyed whole, shell and core
// together, in one step." The row exists because everywhere ELSE a Prism takes
// two hits — `specs/drones.md`: "Breaking the shell leaves the Prism alive with
// its core exposed" — so a build that routes the wave through its ordinary
// shot-resolution path breaks the shell and leaves the Prism flying, which is
// exactly the wrong model this point names.
//
// TWO READINGS, ONE REQUIREMENT, AND THE SECOND IS THE ONE THAT BITES. "Removed
// entirely" is read at the end of the wave: a build whose wave takes nothing, or
// which breaks the shell and never comes back for the core, leaves the Prism on
// the roster and fails there. But a build that takes the shell on one step and
// the core on the next ALSO ends with an empty roster, and the whole of what
// distinguishes it is the state it passed through — a Prism still flying with its
// shell gone. So the wave is sampled one frame at a time and that state is
// required never to appear. `shellAlive` is what `specs/instrumentation.md`
// reports it as.
//
// ONE FRAME IS ONE SUB-STEP, which is what makes that intermediate state visible
// at all. `specs/simulation.md` divides an update covering `dt` into
// `max(1, ceil(dt / SUBSTEP_MAX))` sub-steps, and the suite's clock is `TICK_HZ`
// (`120`), exactly `1 / SUBSTEP_MAX` — so every conforming build runs exactly one
// sub-step per frame here and no resolution is hidden between two samples. The
// arithmetic is asserted below rather than assumed.
//
// THE PRISM IS POSED IN PHASE `diving` WITH ITS SHELL INTACT, which is the only
// state in which the two models differ: a Prism whose shell is already gone would
// be destroyed by both. Every faculty is off, so it holds the place it was put
// and takes none of the two shots a diving Prism otherwise fires
// (`specs/drones.md`), and it stands well above `PRISM_INVERT_Y` (`640`), so
// nothing in this scenario can trigger the spectral inversion a dive to the
// bottom would.
//
// WHAT THIS DOES NOT DECIDE. What a shell break and a core kill SCORE, together
// or apart, is `scoring`'s; how many bursts a destroyed drone pops is `bursts`';
// that the wave takes Shards is `resonance/discharge-clears-divers`.

import { afterEach, beforeEach, it } from "vitest";
import {
  DISCHARGE_MAX_R,
  DISCHARGE_TIME,
  PRISM_INVERT_Y,
  RESONANCE_MAX,
  SUBSTEP_MAX,
} from "../constants";
import { assertEqual, assertNull } from "../assert";
import {
  captureStill,
  createHarness,
  droneOf,
  findDrone,
  poseDrone,
  seconds,
  startPosed,
  ticksFor,
  type Harness,
} from "../harness";
import { poseBystander, release, sweep } from "./wave";

/**
 * Where the diving Prism stands.
 *
 * Mid-field on the ship's own lane, `300` units from the ship at `(640, 600)` — a
 * fifth of `DISCHARGE_MAX_R` (`1500`), so the wave reaches it early in its life.
 * Clear of both HUD strips (`FIELD_TOP` `64`, `FIELD_BOTTOM` `656`), clear of the
 * corner the bystander holds, and `340` units above `PRISM_INVERT_Y` (`640`), the
 * line a diving Prism inverts the field by crossing.
 */
const PRISM_AT = { x: 640, y: 300 } as const;

/**
 * Frames the wave is given: its whole life, sampled one at a time.
 *
 * `DISCHARGE_TIME` (`0.5` s) at the suite's clock, over which the wave grows from
 * `0` to `DISCHARGE_MAX_R` (`1500`), so a Prism `300` units out is reached a
 * fifth of the way through — and a build that broke the shell in one step and
 * would take the core in a later one has the rest of the wave's life to do it in,
 * which is why the intermediate state and not the ending roster is what tells the
 * two apart.
 */
const WAVE_TICKS = ticksFor(DISCHARGE_TIME);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("removes a shell-intact diving Prism whole", async () => {
  // A precondition on the SCENARIO rather than on the build: one frame of the
  // suite's clock is one whole sub-step (specs/simulation.md), so a build cannot
  // break a shell and take the core between two samples. If the suite's clock
  // ever moves, this says so instead of quietly grading a build on a coarser
  // reading than the requirement needs.
  assertEqual(
    seconds(1) <= SUBSTEP_MAX,
    true,
    `precondition: one frame of the suite's clock (${seconds(1)} s) is at most ` +
      `SUBSTEP_MAX (${SUBSTEP_MAX}), so every sub-step lands on a sample ` +
      `(specs/simulation.md)`,
  );

  startPosed(h);
  // In the formation, which specs/resonance.md's own table spares, so the wave
  // still leaves a drone standing (specs/stages.md clears a stage in the moment
  // the last drone of its wave is destroyed).
  poseBystander(h);
  const prism = poseDrone(h, "prism", PRISM_AT.x, PRISM_AT.y, {
    band: "cyan",
    phase: "diving",
    shell: true,
  });

  const before = droneOf(h.snapshot(), prism);
  assertEqual(
    before.phase,
    "diving",
    "precondition: the Prism stands in phase diving",
  );
  assertEqual(
    before.shellAlive,
    true,
    "precondition: the Prism's shell stands before the wave",
  );
  assertEqual(
    before.y < PRISM_INVERT_Y,
    true,
    `precondition: the Prism stands above PRISM_INVERT_Y (${PRISM_INVERT_Y}), ` +
      `so nothing here triggers the inversion a dive to the bottom would ` +
      `(specs/drones.md)`,
  );

  await release(h, RESONANCE_MAX);
  const samples = await sweep(h, WAVE_TICKS);
  captureStill(h, "whole");

  // The whole of the wrong model, in one reading: a Prism still on the roster
  // with its shell gone is one the wave took a layer at a time.
  const half = samples.findIndex((sample) => {
    const found = findDrone(sample, prism);
    return found !== null && !found.shellAlive;
  });
  assertEqual(
    half,
    -1,
    `the frame of the wave's ${WAVE_TICKS}-frame life on which the diving ` +
      `Prism was still on the roster with shellAlive false, which is the wave ` +
      `having broken its shell and left its core flying: the wave destroys a ` +
      `Prism whole, shell and core together, in one step (specs/resonance.md), ` +
      `so there must be no such frame`,
  );

  assertNull(
    findDrone(h.snapshot(), prism),
    `the diving Prism after a discharge wave reached it, 300 units from the ` +
      `ship and far inside DISCHARGE_MAX_R (${DISCHARGE_MAX_R}): off the ` +
      `roster, since the wave destroys it whole rather than leaving it flying ` +
      `(specs/resonance.md)`,
  );
});
