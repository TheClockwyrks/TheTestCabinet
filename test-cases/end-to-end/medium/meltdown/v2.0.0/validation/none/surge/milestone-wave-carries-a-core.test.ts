// Meltdown — surge/milestone-wave-carries-a-core: the two milestone waves field
// the Core whatever the lists would give.
//
// THE RULE. `specs/waves.md`: `milestoneWaves(n) = [round(n / 2), n]`, and
// `waveType(w, n)` is `"core"` "if `w = n` or `w = round(n / 2)`" — checked BEFORE
// the opening list and before the cycle, so "The two milestone waves ... are Core
// waves whatever the opening list or the cycle would otherwise give." `round`
// rounds a half upward, "so `round(n / 2)` is `10` in a 20-wave run, `8` in a
// 15-wave run, and `13` in a 26-wave run."
//
// ALL THREE DIFFICULTIES, BECAUSE THE MILESTONE IS A FUNCTION OF `n`. Containment
// gives Easy `15` waves, Medium `20` and Hard `26` (`specs/modes.md`), so the six
// milestone waves are 8 and 15, 10 and 20, and 13 and 26. A build that hard-coded
// `10` and `20` passes Medium and fails the other two; one that used `n / 2`
// without rounding up puts Easy's mid-run milestone on Wave 7 and Hard's on 13;
// one that used `floor` puts Easy's on 7 as well. The three values of `n` are
// what separate those models, and `round(15 / 2) = 8` is the reading that carries
// the rounding rule on its own.
//
// AND EACH MILESTONE OVERRIDES SOMETHING DIFFERENT. Easy's Wave 8 is the last
// entry of the opening list, which would give a Hulk; Medium's Wave 10 and Hard's
// Wave 13 fall in the cycle, which would give a Sprint and a Hulk; the three
// final waves fall in the cycle too. So a build that applied the milestone rule
// only after the opening list, or only inside the cycle, is named by exactly the
// waves it let through — and the failure message says what the list would have
// given instead.
//
// WHY THE WAVE IS RELEASED FOR REAL. What a wave carries is the unit that comes
// out of the vent, so the run's own release is turned back on and the wave is
// begun with a send (`surge/roster.ts`). That a milestone releases exactly ONE
// Core rather than a crowd of them is `surge/wave-size`'s.
//
// THE REPLAY is the last of the six: a Core released onto the floor of a
// twenty-wave run's final wave, driven for a few seconds so the boss is seen
// crossing rather than standing.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  DIFFICULTIES,
  DIFFICULTY_TABLE,
  milestoneWaves,
  waveType,
  type DifficultyId,
} from "../constants";
import {
  captureReplay,
  createHarness,
  framesFor,
  type Harness,
} from "../harness";
import { firstRelease, openWave } from "./roster";

/** The type both milestones must field (`specs/waves.md`). */
const MILESTONE_TYPE = "core";

/** Every difficulty's two milestone waves, in the order they are read. */
const MILESTONES: readonly { difficulty: DifficultyId; wave: number }[] =
  DIFFICULTIES.flatMap((difficulty) =>
    milestoneWaves(DIFFICULTY_TABLE[difficulty].waves).map((wave) => ({
      difficulty,
      wave,
    })),
  );

/** Which one the replay is taken on: the final wave of the Medium run. */
const REPLAY_AT = { difficulty: "medium" as DifficultyId, wave: 20 };

/** How long the replay follows the Core, in seconds of game time. */
const REPLAY_SECONDS = 3;

/**
 * What the wave would have carried had the milestone rule not fired: the opening
 * list's or the cycle's answer for the same wave, computed by running the run's
 * wave count out past both milestones.
 *
 * It is stated in the failure message alone and decides nothing.
 */
function withoutMilestone(wave: number): string {
  return waveType(wave, Number.MAX_SAFE_INTEGER);
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("fields a Core on round(N / 2) and on N, at all three difficulties", async () => {
  const released: { difficulty: DifficultyId; wave: number; type: string }[] =
    [];

  for (const { difficulty, wave } of MILESTONES) {
    await openWave(h, wave, difficulty);
    const { unit } = await firstRelease(h);
    released.push({ difficulty, wave, type: unit.type });
    if (difficulty === REPLAY_AT.difficulty && wave === REPLAY_AT.wave) {
      await captureReplay(h, "core", () =>
        h.advance(framesFor(REPLAY_SECONDS)),
      );
    }
  }

  for (const { difficulty, wave, type } of released) {
    const count = DIFFICULTY_TABLE[difficulty].waves;
    const [mid, last] = milestoneWaves(count);
    assertEqual(
      type,
      MILESTONE_TYPE,
      `the type wave ${wave} of the ${difficulty} ${count}-wave run releases: ` +
        `its milestones are round(${count} / 2) = ${mid} and ${last}, so this ` +
        `wave is a Core wave whatever the lists would give ` +
        `(specs/waves.md) — they would have given ${withoutMilestone(wave)}`,
    );
  }
});
