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
// (`specs/campaign.md`: there is no send control). The units the wave releases are
// then read off the snapshot as they arrive, and a Dynamo either turns up or does
// not.
//
// WHY THE YARD IS SWEPT BETWEEN READS. `clearUnits` kills nothing and leaks
// nothing, so sweeping the units already read costs no Charge and no Grid
// Integrity and leaves the wave's own schedule alone. What it buys is the end of
// the wave: a wave with nothing left to release and nothing left on the yard
// clears on the next advance, so the drive ends when the SCHEDULE is exhausted
// rather than after every unit has walked the whole maze — which is what makes
// reading a whole wave's composition affordable, twelve times over. Nothing about
// the composition is touched by it: a unit is read on the poll it appeared on.
//
// THE CLOCK IS COARSE HERE ON PURPOSE. The simulation is delta-time independent
// (`specs/controls.md`), and this point reads which types appear rather than
// anything positional, so a 20 Hz frame keeps twelve whole waves inside a
// sensible budget. No unit crosses a whole map in the half-second between two
// polls, so nothing can arrive and ground out unseen.

import { ConstantClock } from "@test-cabinet/simple-2d";
import { afterEach, beforeEach, it } from "vitest";

import { assertEqual, assertTrue, fail } from "../assert";
import {
  DIFFICULTIES,
  type Difficulty as DifficultyDef,
} from "../../src/constants";
import {
  captureReplay,
  createHarness,
  milestoneWaves,
  openYard,
  startWave,
  type Harness,
} from "../harness";

/** 20 Hz: coarse, and the simulation is defined to be indifferent to it. */
const CLOCK_MS = 50;

/** Frames per poll, so half a second of simulation between two reads. */
const POLL_FRAMES = 10;

/** The most simulation a wave's spawn schedule is given to finish, in polls. */
const MAX_POLLS = 480; // 240 s

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
 * Launch wave `wave` and hand back every unit type it released.
 *
 * The wave counter is posed one below the wave wanted and the level's harvest is
 * committed, which is what starts a wave; the wave that opens is then asserted to
 * be the one asked for, because a check that read the wrong wave's composition
 * would decide this point on the wrong evidence.
 */
async function typesReleasedBy(
  h: Harness,
  difficulty: DifficultyDef,
  wave: number,
): Promise<Set<string>> {
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

  const seen = new Set<string>();
  for (let poll = 0; poll < MAX_POLLS; poll += 1) {
    await h.advance(POLL_FRAMES);
    const s = h.snapshot();
    for (const unit of s.units) seen.add(unit.type);
    if (!s.waveActive) return seen;
    h.debug.clearUnits();
  }

  return fail(
    `wave ${wave} to finish releasing its units within ` +
      `${(MAX_POLLS * POLL_FRAMES * CLOCK_MS) / 1000} seconds of simulation, ` +
      "so its composition can be read (specs/enemies.md)",
    `it was still releasing units after that, having shown ${[...seen].join(", ")}`,
  );
}

it.each(DIFFICULTIES.map((d) => ({ difficulty: d })))(
  "carries a Dynamo on the milestone waves of $difficulty.id and on no other",
  async ({ difficulty }: { difficulty: DifficultyDef }) => {
    const [mid, last] = milestoneWaves(difficulty.waves);

    const before = await typesReleasedBy(h, difficulty, mid - 1);
    assertTrue(
      !before.has("dynamo"),
      `wave ${mid - 1} on ${difficulty.id} to carry no Dynamo, because only ` +
        `waves ${mid} and ${last} do (specs/enemies.md)`,
    );

    const milestone = await captureReplay(h, "milestone", () =>
      typesReleasedBy(h, difficulty, mid),
    );
    assertTrue(
      milestone.has("dynamo"),
      `wave ${mid} on ${difficulty.id}, which is round(${difficulty.waves} / 2), ` +
        "to carry a Dynamo (specs/difficulty.md, specs/enemies.md)",
    );

    const penultimate = await typesReleasedBy(h, difficulty, last - 1);
    assertTrue(
      !penultimate.has("dynamo"),
      `wave ${last - 1} on ${difficulty.id} to carry no Dynamo, because only ` +
        `waves ${mid} and ${last} do (specs/enemies.md)`,
    );

    const final = await typesReleasedBy(h, difficulty, last);
    assertTrue(
      final.has("dynamo"),
      `wave ${last} on ${difficulty.id}, the run's last, to carry a Dynamo ` +
        "(specs/difficulty.md, specs/enemies.md)",
    );
  },
);
