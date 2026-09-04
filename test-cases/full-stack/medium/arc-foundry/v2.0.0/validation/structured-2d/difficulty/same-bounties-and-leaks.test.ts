// difficulty/same-bounties-and-leaks — every difficulty pays and charges the same.
//
// THE REQUIREMENT. `specs/difficulty.md` is explicit about the negative: "A
// difficulty sets the number of waves and the constants of the per-wave health
// scaling, and nothing else. Every other value is identical at every difficulty:
// the starting Charge, the starting Grid Integrity, the stamp allowance, the
// refinement track and its costs, the Load roster's base figures, the bounties,
// the leak values, the wave-clear bonus, the component stats, and the recipes."
//
// ONE GROUP PER CHECK. Those figures are reached five different ways — off a fresh
// run, off the refinement track, off standing structures, off the inspector, and
// off a unit actually dying or leaking — and a build can leak the difficulty into
// one of the five and not the others, so each is decided on its own and a grade
// names which one drifted. This one is about what a kill pays and what a leak costs, for every type of the roster.
//
// THE COMPARISON IS BETWEEN THE DIFFICULTIES, not against the specification's
// numbers: whether the starting Charge is `10`, what a Slug's bounty is, and what
// a Charged Capacitor hits for are each decided by a point of their own on the
// economy, campaign and component checklists, and a build that gets one of them
// wrong should fail that point once rather than twice over. What is decided HERE
// is that whichever figure a build carries, it carries the same one at Easy, at
// Medium and at Hard.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  type DifficultyId,
  LOAD_ROSTER,
  mapById,
  tileCenter,
} from "../constants";
import {
  captureStill,
  createHarness,
  type Harness,
  openYard,
  parkUnit,
  releaseUnit,
  ticks,
} from "../harness";

/** The wave every economy reading below is taken at. */
const WAVE = 3;

/** Grid Integrity a leak is measured against. */
const INTEGRITY = 100;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

/**
 * Read one figure at each difficulty in turn and hold the three against each
 * other.
 *
 * The Easy reading is the one the other two are compared to, so a failure names
 * the difficulty that drifted and what it drifted to.
 */
async function sameAtEveryDifficulty<T>(
  what: string,
  read: (difficulty: DifficultyId) => Promise<T>,
): Promise<T> {
  const easy = await read("easy");
  for (const difficulty of ["medium", "hard"] as const) {
    const other = await read(difficulty);
    assertDeepEqual(
      other,
      easy,
      `${what} to be the same at ${difficulty} as at easy, because difficulty ` +
        "sets the wave count and the health scaling alone (specs/difficulty.md)",
    );
  }
  return easy;
}

it("pays the same bounties and charges the same leaks at every difficulty", async () => {
  await sameAtEveryDifficulty(
    "the bounties, the leaks and the wave-clear bonus",
    async (difficulty) => {
      const bounties: Record<string, number> = {};
      const leaks: Record<string, number> = {};

      for (const unit of LOAD_ROSTER) {
        // A KILL. The unit is held where it stands, dropped to a single point of
        // health, and burned off it — so nothing on the yard is firing, nothing is
        // walking, and the only Charge that can arrive is the bounty the death
        // pays plus the bonus the wave's clear pays behind it.
        openYard(h, { difficulty, wave: WAVE, charge: 0 });
        parkUnit(h, unit.type, tileCenter(20, 20), {
          hp: 1,
          burn: { dps: 500, seconds: 3 },
        });
        const killed = await h.until((s) => s.units.length === 0, {
          maxFrames: ticks(5),
        });
        assertEqual(
          killed.hit,
          true,
          `a burned ${unit.type} on one point of health to die within five ` +
            "seconds (specs/enemies.md)",
        );
        // The wave clears on the advance after its last unit has gone.
        await h.advance(2);
        bounties[unit.type] = h.snapshot().charge;

        // A LEAK. The unit is put at the collector heading for it, so it grounds
        // out on the next advance without walking a maze first.
        openYard(h, {
          difficulty,
          wave: WAVE,
          integrity: INTEGRITY,
        });
        const collector = mapById(h.snapshot().map).collector;
        releaseUnit(h, unit.type, {
          waypoint: 7,
          at: tileCenter(collector.col, collector.row),
        });
        const leaked = await h.until((s) => s.units.length === 0, {
          maxFrames: ticks(5),
        });
        assertEqual(
          leaked.hit,
          true,
          `a ${unit.type} standing on the collector to ground out within five ` +
            "seconds (specs/enemies.md)",
        );
        leaks[unit.type] = INTEGRITY - leaked.snapshot.integrity;
      }

      return { bounties, leaks };
    },
  );
  captureStill(h, "economy");
});
