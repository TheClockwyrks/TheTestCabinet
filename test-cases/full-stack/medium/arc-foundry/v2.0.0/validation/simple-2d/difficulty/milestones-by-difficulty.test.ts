// difficulty/milestones-by-difficulty — the Dynamo waves follow the difficulty.
//
// THE REQUIREMENT. `specs/difficulty.md` puts the milestone waves at
// `round(N / 2)` and `N`, which is `20` and `40` on Easy, `25` and `50` on Medium
// and `30` and `60` on Hard, and `specs/enemies.md` states the composition rule
// they enforce: wave `round(N / 2)` and wave `N` each carry exactly one Dynamo,
// and no other wave carries one. So the milestones move with the difficulty
// rather than sitting at fixed numbers.
//
// HOW IT IS DECIDED. Four waves are run at each difficulty: the wave BEFORE the
// mid-run milestone, the milestone itself, the wave before the final one, and the
// final one. Each is launched by committing the level's harvest with the wave
// counter set one below the wave wanted, which is the only way a wave starts
// (`specs/campaign.md`: there is no send control), and the wave that opened is
// asserted to be the one asked for — a check that read the wrong wave's
// composition would decide this point on the wrong evidence. What that wave
// carries is then read off `waveCount`.
//
// WHY THE READ DECIDES THE SAME THING AS WATCHING THE WAVE. `specs/enemies.md`
// settles a wave's composition when the wave begins — "the wave releases exactly
// that sequence" — and `specs/instrumentation.md` makes `waveCount` that schedule
// rather than a figure kept beside it: "the units a wave releases are exactly the
// ones it counts", counting a unit still to come exactly as it counts one already
// walking the yard. So the count read on the frame the harvest launched the wave
// is the whole of what that wave will release, and a build cannot answer "no
// Dynamo" and release one. That the count and the arrivals agree is decided once,
// by `instrumentation/wave-count-matches-the-spawner`, which drives a whole wave
// the expensive way and holds the two against each other; this point is left with
// the one thing it is about, which is WHICH waves carry the boss at each
// difficulty.
//
// NOTHING IS POSED THAT PLAY DOES NOT REACH. The wave is a wave the game composed
// for itself, at the number the run really reached, started by the control that
// really starts one. Only the watching goes: twelve waves played to exhaustion
// bought twelve integers.
//
// THE FRAMES THAT REMAIN ARE EVIDENCE, NOT THE ASSERTION. On the milestone wave
// of each difficulty a few seconds run while its opening units arrive, so the
// recorded replay shows the wave the count is about. The verdict is the count.

import { ConstantClock } from "@clockwyrks/simple-2d";
import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import {
  DIFFICULTIES,
  type Difficulty as DifficultyDef,
  milestoneWaves,
} from "../constants";
import {
  captureReplay,
  createHarness,
  type Harness,
  openYard,
  startWave,
} from "../harness";

/** 20 Hz: coarse, and the simulation is defined to be indifferent to it. */
const CLOCK_MS = 50;

/** Four seconds of the milestone wave arriving, in frames, for the replay. */
const EVIDENCE = 4 * (1000 / CLOCK_MS);

/** Where the harvest that launches each wave is stood, clear of every chain. */
const HARVEST = { col: 10, row: 0 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness({ clock: new ConstantClock(CLOCK_MS) });
});

afterEach(() => {
  h.dispose();
});

/**
 * Launch wave `wave` and hand back how many Dynamos its schedule holds.
 *
 * The wave counter is posed one below the wave wanted and the level's harvest is
 * committed, which is what starts a wave; the wave that opens is then asserted to
 * be the one asked for, and to be live, because a count read off no wave at all
 * reads `0` for every type and would agree with half of this point by accident.
 */
function dynamosIn(
  h: Harness,
  difficulty: DifficultyDef,
  wave: number,
): number {
  openYard(h, {
    difficulty: difficulty.id,
    wave: wave - 1,
    integrity: 10_000,
  });
  startWave(h, "capacitor", 1, HARVEST.col, HARVEST.row);

  const opened = h.snapshot();
  assertEqual(
    opened.wave,
    wave,
    `committing the level's harvest with the counter at ${wave - 1} to launch ` +
      `wave ${wave} (specs/campaign.md)`,
  );
  assertEqual(
    opened.waveActive,
    true,
    `wave ${wave} to be running once its harvest is committed, so what ` +
      "`waveCount` reads is that wave's own schedule (specs/instrumentation.md)",
  );

  return h.debug.waveCount("dynamo");
}

it.each(DIFFICULTIES.map((d) => ({ difficulty: d })))(
  "carries a Dynamo on the milestone waves of $difficulty.id and on no other",
  async ({ difficulty }: { difficulty: DifficultyDef }) => {
    const [mid, last] = milestoneWaves(difficulty.waves);

    const before = dynamosIn(h, difficulty, mid - 1);
    assertTrue(
      before === 0,
      `wave ${mid - 1} on ${difficulty.id} to carry no Dynamo, because only ` +
        `waves ${mid} and ${last} do (specs/enemies.md); its schedule holds ` +
        `${before}`,
    );

    const milestone = await captureReplay(h, "milestone", async () => {
      const dynamos = dynamosIn(h, difficulty, mid);
      // Evidence, not the assertion: the wave's opening units arriving, so the
      // replay shows the wave the count above is about.
      await h.advance(EVIDENCE);
      return dynamos;
    });
    assertTrue(
      milestone > 0,
      `wave ${mid} on ${difficulty.id}, which is round(${difficulty.waves} / 2), ` +
        "to carry a Dynamo (specs/difficulty.md, specs/enemies.md)",
    );

    const penultimate = dynamosIn(h, difficulty, last - 1);
    assertTrue(
      penultimate === 0,
      `wave ${last - 1} on ${difficulty.id} to carry no Dynamo, because only ` +
        `waves ${mid} and ${last} do (specs/enemies.md); its schedule holds ` +
        `${penultimate}`,
    );

    const final = dynamosIn(h, difficulty, last);
    assertTrue(
      final > 0,
      `wave ${last} on ${difficulty.id}, the run's last, to carry a Dynamo ` +
        "(specs/difficulty.md, specs/enemies.md)",
    );
  },
);
