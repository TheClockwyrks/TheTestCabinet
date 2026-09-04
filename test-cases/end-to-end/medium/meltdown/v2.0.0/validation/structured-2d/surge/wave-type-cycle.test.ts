// Meltdown — surge/wave-type-cycle: from wave 9 the five types repeat.
//
// THE RULE. `specs/waves.md` gives the last branch of `waveType(w, n)` as
// `WAVE_CYCLE[(w - 9) mod 5]` for every wave past the eighth, with
// `WAVE_CYCLE = [mote, sprint, swarm, drift, hulk]`. In a 20-wave Containment run
// the specification spells the answer out: "Waves 11 through 19 read Swarm, Drift,
// Hulk, Mote, Sprint, Swarm, Drift, Hulk, Mote."
//
// WHICH WAVES ARE READ, AND WHY WAVE 10 IS NOT AMONG THEM. Waves 9 and 11 through
// 19 — eleven waves, two whole turns of the five-type cycle and one over, so a
// build whose cycle is the right five types in the wrong order, or the right order
// with the wrong period, breaks on at least one of them. Wave 10 is `round(20 / 2)`
// and Wave 20 is the last, so both are milestone Core waves whatever the cycle
// would give; they belong to `surge/milestone-wave-carries-a-core` and are left out
// of the cycle this point reads, because a point that folded the override in could
// not say which of the two rules a build had broken.
//
// WHY THE TYPE IS READ OFF A UNIT THE RUN RELEASED, AND WHY ONE PER WAVE. The world
// gate goes back on and the spawner is handed exactly one unit to release
// (`specs/instrumentation.md`), so the type comes off the unit the run chose while
// nothing about a wave's size or its cadence is exercised. The phase is posed rather
// than entered off a build timer, so this point does not also rest on the timer's
// automatic start.
//
// WHAT EVERY WRONG MODEL READS. A build that carried on with the opening list reads
// `hulk` on wave 9 rather than `mote`; one that cycled from wave 1 rather than wave
// 9 reads the cycle offset by four and differs on every wave here; one that indexed
// `(w - 8)` reads it offset by one and differs on every wave; one whose cycle is the
// four ground types reads a period of four and differs from wave 13 onward; one
// that fields Motes throughout differs on eight of the eleven. Each failure names
// the wave it happened on.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThanOrEqual } from "../assert";
import { WAVE_CYCLE } from "../constants";
import {
  captureStill,
  createDriveHarness,
  driveFrames,
  type Harness,
} from "../harness";
import { poseWavePhase, watchReleases } from "./scenario";

/** The run this point is stated against: Containment on Medium, 20 waves. */
const WAVE_COUNT = 20;

/** The wave the cycle begins on (`specs/waves.md`). */
const CYCLE_FROM = 9;

/**
 * The waves read: 9, and 11 through 19.
 *
 * Wave 10 is `round(20 / 2)` and Wave 20 is the last, so both carry a Core
 * whatever the cycle gives and are the milestone item's, not this one's.
 */
const WAVES = [9, 11, 12, 13, 14, 15, 16, 17, 18, 19] as const;

/** Units the spawner is given to release: one, which is all a type needs. */
const PENDING = 1;

/** Seconds of game time each wave is watched for: two, over three release intervals. */
/*
 * The window is counted in frames of the long-drive clock (`harness.ts`, The
 * long-drive clock): the seconds of game time it names are the requirement, how
 * finely they are diced is this check's to choose, and a thirtieth of a second is
 * eighteen frames inside one release interval.
 */
const WATCH_TICKS = driveFrames(2);

/**
 * Frames between two samples: two of the long-drive clock's, a fifteenth of a
 * second, which falls inside one `WAVE_SPAWN_INTERVAL` (`0.6` s) nine times over.
 */
const POLL_FRAMES = 2;

let h: Harness;

beforeEach(async () => {
  h = await createDriveHarness();
});

afterEach(() => {
  h?.dispose();
});

it("carries the five-type cycle on waves 9 and 11 to 19", async () => {
  for (const wave of WAVES) {
    poseWavePhase(h, wave, PENDING, "containment", "medium");
    assertEqual(
      h.snapshot().waveCount,
      WAVE_COUNT,
      `precondition: Containment on Medium runs ${WAVE_COUNT} waves ` +
        `(specs/modes.md), so wave ${wave} is not a milestone`,
    );

    const watch = await watchReleases(h, WATCH_TICKS, { poll: POLL_FRAMES });
    captureStill(h, "cycle");

    const index = (wave - CYCLE_FROM) % WAVE_CYCLE.length;
    assertGreaterThanOrEqual(
      watch.releases.length,
      1,
      `precondition: wave ${wave} released a unit for its type to be read off`,
    );
    assertEqual(
      watch.releases[0].type,
      WAVE_CYCLE[index],
      `the type wave ${wave} of a ${WAVE_COUNT}-wave run released, against ` +
        `the WAVE_CYCLE[(${wave} - 9) mod 5] = WAVE_CYCLE[${index}] ` +
        `specs/waves.md states`,
    );
  }
});
