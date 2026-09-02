// Meltdown — surge/milestone-wave-carries-a-core: the two milestones are Cores.
//
// THE RULE. `specs/waves.md` puts the milestone branch FIRST in `waveType(w, n)`:
// `"core" if w = n or w = round(n / 2)`, and spells out what that means — "The two
// milestone waves, `round(n / 2)` and `n`, are Core waves whatever the opening list
// or the cycle would otherwise give." `round` rounds a half upward, so
// `milestoneWaves(n)` is `[8, 15]` at 15 waves, `[10, 20]` at 20, and `[13, 26]` at
// 26.
//
// WHY ALL THREE DIFFICULTIES. The milestone is a function of the run's wave count,
// and the wave count is what a difficulty changes (`specs/modes.md`: Easy 15,
// Medium 20, Hard 26). A build that hard-coded Wave 10 and Wave 20 passes on Medium
// and fails on both the others, which is precisely the defect a single-difficulty
// reading would miss. The three halfway waves are `8`, `10` and `13`, so the
// rounding rule is exercised too: `15 / 2` is `7.5` and must round UP to `8`.
//
// WHY EACH MILESTONE OVERRIDES SOMETHING DIFFERENT. Wave 8 of a 15-wave run is the
// last entry of the opening list, which would give a Hulk; Wave 10 and Wave 13 fall
// in the cycle, which would give a Sprint and a Hulk; and Waves 15, 20 and 26 are
// final waves whose cycle entries are a Sprint, a Hulk and a Hulk. So every one of
// the six readings is a wave the override actually changed, and a build that simply
// forgot the override reads the list's or the cycle's answer at each.
//
// WHY THE TYPE IS READ OFF A UNIT THE RUN RELEASED. The world gate goes back on and
// the spawner is handed one unit to release (`specs/instrumentation.md`), so the
// type comes off the unit the run chose rather than off a preview. The phase is
// posed, so nothing here rests on the build timer's automatic start.
//
// WHAT EVERY WRONG MODEL READS. A build that forgot the override reads `hulk` or
// `sprint`; one that rounded `n / 2` downward reads a Core on wave 7 of a 15-wave
// run and something else on wave 8; one that made only the final wave a milestone
// reads the cycle's answer at 8, 10 and 13; one that made every fifth wave a Core
// reads `core` where this point expects the cycle, which `surge/wave-type-cycle`
// catches. Each failure names the difficulty and the wave.

import { afterEach, beforeEach, it } from "vitest";
import { DIFFICULTY_TABLE, milestoneWaves } from "../constants";
import { assertEqual, assertGreaterThanOrEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  ticksFor,
  type DifficultyName,
  type Harness,
} from "../harness";
import { poseWavePhase, watchReleases } from "./scenario";

/** The three difficulties Containment offers (`specs/modes.md`). */
const DIFFICULTIES = ["easy", "medium", "hard"] as const;

/** The type a milestone wave carries (`specs/waves.md`). */
const MILESTONE_TYPE = "core";

/** Units the spawner is given to release: one, which is all a type needs. */
const PENDING = 1;

/** Seconds of game time each milestone is watched for: two, over three intervals. */
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

it("fields a Core on round(N / 2) and on N at every difficulty", async () => {
  await captureReplay(h, "core", async () => {
    for (const difficulty of DIFFICULTIES as readonly DifficultyName[]) {
      const waves = DIFFICULTY_TABLE[difficulty].waves;
      for (const wave of milestoneWaves(waves)) {
        poseWavePhase(h, wave, PENDING, "containment", difficulty);
        assertEqual(
          h.snapshot().waveCount,
          waves,
          `precondition: Containment on ${difficulty} runs ${waves} waves ` +
            `(specs/modes.md)`,
        );

        const watch = await watchReleases(h, WATCH_TICKS, {
          poll: POLL_FRAMES,
        });

        assertGreaterThanOrEqual(
          watch.releases.length,
          1,
          `precondition: wave ${wave} on ${difficulty} released a unit for ` +
            `its type to be read off`,
        );
        assertEqual(
          watch.releases[0].type,
          MILESTONE_TYPE,
          `the type wave ${wave} of a ${waves}-wave run released; it is a ` +
            `milestone of milestoneWaves(${waves}) and specs/waves.md makes ` +
            `it a Core whatever the list or the cycle would give`,
        );
      }
    }
  });
});
