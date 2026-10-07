// Meltdown — surge/single-type-waves: one wave, one type.
//
// THE RULE. `specs/waves.md`, What a wave carries: "Each wave fields a single
// type, given by the wave number `w` and the run's wave count `n`." The Hundred is
// the one stated exception — "It is the one wave in the game that fields more than
// one type" (`specs/modes.md`) — and it is not in scope here: every wave read below
// is a Containment wave.
//
// WHAT THIS DECIDES AND WHAT IT LEAVES ALONE. The requirement is SAMENESS, not
// identity: this point asserts that every unit a wave released carried the same
// type as the first, and says nothing about which type that was. Which type a wave
// carries is `surge/wave-type-opening`, `surge/wave-type-cycle` and
// `surge/milestone-wave-carries-a-core`, and a build that fields one consistent but
// wrong type must fail those and pass this — otherwise a single failure could not
// say whether the build got the table wrong or the wave mixed.
//
// TWO WAVES, ONE FROM EACH BRANCH OF THE FORM. Wave 4 comes from the opening list
// and Wave 12 from the cycle (`specs/waves.md`), so a build that fields one type
// early and then cycles types within a later wave — the shape The Hundred's rule
// takes, applied where it does not belong — is caught. Each wave releases eight
// units, comfortably more than the five types the cycle holds, so a per-unit cycle
// would show up several times over inside one wave.
//
// WHY EACH ARRIVAL IS HELD WHERE IT ARRIVED. `setUnitMotion(id, false)` stops the
// unit walking while leaving everything else about it alone
// (`specs/instrumentation.md`), so nothing this point released can reach an exhaust
// and take lives with it partway through the reading. This point is about what the
// spawner released, not about what happened to it afterwards.
//
// WHY THE PHASE IS POSED AND THE COUNT IS THE SUITE'S. `wavePending` is set to
// eight rather than left to the progression, so how many units a wave owes —
// `surge/wave-size` — is not folded into this reading, and the phase is posed
// rather than entered off a build timer, so the timer's automatic start is not
// either. The world gate is what does the work: with `setWaveSpawning(true)` the
// units that appear are the run's own releases (`specs/instrumentation.md`).
//
// WHAT EVERY WRONG MODEL READS. A build that applied The Hundred's per-unit cycle
// to every wave reads five different types inside one wave; one that drew a type at
// random per unit reads a mixture; one that changed type when the vent changed
// reads two types; one that released nothing fails the precondition rather than
// passing on an empty roster.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThanOrEqual } from "../assert";
import {
  captureStill,
  createDriveHarness,
  driveFrames,
  type Harness,
} from "../harness";
import { poseWavePhase, watchReleases } from "./scenario";

/** One wave from the opening list and one from the cycle (`specs/waves.md`). */
const WAVES = [4, 12] as const;

/** Units the spawner is handed: eight, over the five types the cycle holds. */
const PENDING = 8;

/**
 * Seconds of game time each wave is watched for: eight.
 *
 * Geometry rather than a tolerance. `specs/waves.md` releases a unit every `0.6`
 * seconds, so eight units take `4.8` seconds at the stated cadence; eight seconds
 * leaves room for a build whose clock runs slower than the specification's without
 * the reading depending on the cadence at all, which `surge/spawn-cadence` decides.
 */
const WATCH_TICKS = driveFrames(8);

/**
 * Frames between two samples: two of the long-drive clock's, a fifteenth of a
 * second, which falls inside one `WAVE_SPAWN_INTERVAL` (`0.6` s) nine times over.
 */
const POLL_FRAMES = 2;

/** The fewest arrivals the reading is taken on, so a short wave cannot pass it. */
const MIN_RELEASES = 6;

let h: Harness;

beforeEach(async () => {
  h = await createDriveHarness();
});

afterEach(() => {
  h?.dispose();
});

it("releases one and the same type through a whole Containment wave", async () => {
  for (const wave of WAVES) {
    poseWavePhase(h, wave, PENDING, "containment", "medium");

    const watch = await watchReleases(h, WATCH_TICKS, {
      poll: POLL_FRAMES,
      // Held where it arrived: this point is about what was released, and a unit
      // that walked off the floor would take lives with it mid-reading.
      onRelease: (release) => h.debug.setUnitMotion(release.id, false),
    });
    captureStill(h, "single");

    assertGreaterThanOrEqual(
      watch.releases.length,
      MIN_RELEASES,
      `precondition: wave ${wave} released enough units for the reading`,
    );
    const first = watch.releases[0].type;
    for (const [index, release] of watch.releases.entries()) {
      assertEqual(
        release.type,
        first,
        `wave ${wave}, unit ${index + 1} of ${watch.releases.length}: its ` +
          `type, against the ${first} the wave opened with; a wave fields a ` +
          `single type (specs/waves.md)`,
      );
    }
  }
});
