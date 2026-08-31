// Meltdown — surge/wave-type-opening: the first eight waves follow their list.
//
// THE RULE. `specs/waves.md` fixes what a wave carries as a closed form, whose
// first branch after the milestone override is `WAVE_OPENING[w - 1] if w <= 8`,
// with `WAVE_OPENING = [mote, mote, sprint, swarm, mote, drift, mote, hulk]`. In a
// 20-wave Containment run the milestones are Wave 10 and Wave 20
// (`round(20 / 2)` and `20`), so none of the first eight is overridden and the
// list is what each of them carries, in order.
//
// WHY THE TYPE IS READ OFF A UNIT THE RUN RELEASED. The item is about what the
// wave CARRIES, and the only thing that carries a type is a unit on the floor. So
// the world gate goes back on — `setWaveSpawning(true)` restores "the spawner's
// release of the units counted by `wavePending`" (`specs/instrumentation.md`) —
// and the type is read off the unit the spawner chose. Reading the panel's coming-
// wave preview instead would decide whether the PREVIEW agrees with the list,
// which is `hud/next-wave-preview`, and would pass a build that previewed one type
// and released another.
//
// WHY ONE UNIT PER WAVE, AND WHY THE PHASE IS POSED. `wavePending` is set to `1`,
// so the spawner has exactly one unit to release and the floor never fills:
// nothing about how many units a wave owes is exercised here, which is
// `surge/wave-size`, and nothing about how they are spaced, which is
// `surge/spawn-cadence`. The phase is posed rather than entered off a build timer
// for the same reason — `setPhase` "runs no entry effect"
// (`specs/instrumentation.md`), so this point does not also depend on the timer's
// automatic start, which `waves/build-timer-auto-starts` decides.
//
// EACH WAVE OPENS ITS OWN RUN. `poseWavePhase` opens with `startRun`, which empties
// both rosters, so the unit read for wave `w` is a unit released for wave `w` and
// not a survivor of the wave before it.
//
// WHAT EVERY WRONG MODEL READS. A build that fields Motes throughout reads `mote`
// on waves 3, 4, 6 and 8; one that starts the cycle at wave 1 reads
// `mote, sprint, swarm, drift, hulk, mote, ...`, which differs from the list at
// waves 2, 3, 4, 5, 6 and 7; one that indexed the list from the wave number rather
// than from `w - 1` reads the list shifted by one and differs at waves 2, 3, 4, 5,
// 6 and 8; one that ordered the list by hp reads `swarm` first. Each failure names
// the wave it happened on.

import { afterEach, beforeEach, it } from "vitest";
import { WAVE_OPENING } from "../../src/constants";
import { assertEqual, assertGreaterThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  ticksFor,
  type Harness,
} from "../harness";
import { poseWavePhase, watchReleases } from "./scenario";

/** The run this point is stated against: Containment on Medium, 20 waves. */
const WAVE_COUNT = 20;

/** Units the spawner is given to release: one, which is all a type needs. */
const PENDING = 1;

/**
 * Seconds of game time each wave is watched for: two.
 *
 * Geometry rather than a tolerance. `specs/waves.md` releases a unit every `0.6`
 * seconds, so two seconds is more than three intervals: a build whose release
 * clock is off by a factor of three still puts its unit on the floor inside the
 * window, and the type this point reads therefore rests on a unit arriving at all
 * rather than on when it arrived.
 */
const WATCH_TICKS = ticksFor(2);

/** Frames between two samples: a twentieth of a second, which is fine enough here. */
const POLL_FRAMES = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("carries mote, mote, sprint, swarm, mote, drift, mote, hulk on waves 1 to 8", async () => {
  for (const [index, expected] of WAVE_OPENING.entries()) {
    const wave = index + 1;
    poseWavePhase(h, wave, PENDING, "containment", "medium");
    assertEqual(
      h.snapshot().waveCount,
      WAVE_COUNT,
      `precondition: Containment on Medium runs ${WAVE_COUNT} waves ` +
        `(specs/modes.md), so wave ${wave} is not a milestone`,
    );

    const watch = await watchReleases(h, WATCH_TICKS, { poll: POLL_FRAMES });
    captureStill(h, "opening");

    assertGreaterThanOrEqual(
      watch.releases.length,
      1,
      `precondition: wave ${wave} released a unit for its type to be read off`,
    );
    assertEqual(
      watch.releases[0].type,
      expected,
      `the type wave ${wave} of a ${WAVE_COUNT}-wave run released, against ` +
        `the WAVE_OPENING[${index}] specs/waves.md states`,
    );
  }
});
