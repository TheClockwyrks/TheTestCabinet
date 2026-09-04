// difficulty/nothing-else-changes — difficulty changes the wave count and the
// health scaling, and nothing else.
//
// THE REQUIREMENT. `specs/difficulty.md` is explicit about the negative: "A
// difficulty sets the number of waves and the constants of the per-wave health
// scaling, and nothing else. Every other value is identical at every difficulty:
// the starting Charge, the starting Grid Integrity, the stamp allowance, the
// refinement track and its costs, the Load roster's base figures, the bounties,
// the leak values, the wave-clear bonus, the component stats, and the recipes."
//
// HOW IT IS DECIDED. Every one of those figures is read off the running game at
// each of the three difficulties in turn, and the three readings are held against
// each other. The comparison is deliberately between the difficulties rather than
// against the specification's numbers: whether the starting Charge is `10`, what
// a Slug's bounty is, and what a Charged Capacitor hits for are each decided by a
// point of their own on the economy, campaign and component checklists, and a
// build that gets one of them wrong should fail that point once rather than twice
// over. What is decided HERE is that whichever figure a build carries, it carries
// the same one at Easy, at Medium and at Hard.
//
// EACH GROUP IS ITS OWN DRIVE. The figures are read in five groups because they
// are reached five different ways — off a fresh run, off the refinement track,
// off standing structures, off the inspector, and off a unit actually dying or
// leaking — and splitting them keeps each drive short enough to read.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  COMBOS,
  COMPONENT_TYPES,
  LOAD_ROSTER,
  REFINEMENT_MAX,
  mapById,
  tileCenter,
  type ComboDef,
  type DifficultyId,
} from "../constants";
import {
  captureStill,
  createHarness,
  openRun,
  openYard,
  parkUnit,
  releaseUnit,
  standComponent,
  structureById,
  ticks,
  type Harness,
} from "../harness";

/** The anchors a recipe's ingredients are stood on: clear of every map's chain. */
const BENCH = [
  { col: 10, row: 0 },
  { col: 13, row: 0 },
  { col: 16, row: 0 },
  { col: 19, row: 0 },
];

/** The wave every economy reading below is taken at. */
const WAVE = 3;

/** Grid Integrity a leak is measured against. */
const INTEGRITY = 100;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
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

it("opens every run with the same Charge, Integrity, stamps and refinement", async () => {
  await sameAtEveryDifficulty(
    "a run's opening allocation",
    async (difficulty) => {
      await openRun(h, { difficulty });
      const s = await h.snapshot();
      return {
        charge: s.charge,
        integrity: s.integrity,
        stampsLeft: s.stampsLeft,
        refinement: s.refinement,
      };
    },
  );
  await captureStill(h, "same");
});

it("carries the same refinement track, odds and costs at every difficulty", async () => {
  await sameAtEveryDifficulty("the refinement track", async (difficulty) => {
    await openRun(h, { difficulty });

    // The odds at every rung of the track.
    const odds: number[][] = [];
    for (let level = 0; level <= REFINEMENT_MAX; level += 1) {
      await h.debug.setRefinement(level);
      odds.push((await h.snapshot()).qualityOdds);
    }

    // And what each rung costs, taken off the bank the press's own refinement
    // control spends from.
    const costs: number[] = [];
    for (let level = 1; level <= REFINEMENT_MAX; level += 1) {
      await h.debug.setRefinement(level - 1);
      await h.debug.setCharge(10_000);
      await h.debug.upgradeQuality();
      const s = await h.snapshot();
      assertEqual(
        s.refinement,
        level,
        `refining the press from R${level - 1} to reach R${level} ` +
          "(specs/scrap-press.md)",
      );
      costs.push(10_000 - s.charge);
    }

    return { odds, costs };
  });
});

it("gives every component and every tower the same stats at every difficulty", async () => {
  await sameAtEveryDifficulty("the structures' stats", async (difficulty) => {
    await openYard(h, { difficulty });

    const components: Record<string, unknown> = {};
    for (const type of COMPONENT_TYPES) {
      for (const tier of [1, 3, 5] as const) {
        await h.debug.clearStructures();
        const id = await standComponent(
          h,
          type,
          tier,
          BENCH[0]!.col,
          BENCH[0]!.row,
        );
        const stood = structureById(await h.snapshot(), id);
        components[`${type}@${tier}`] = {
          damage: stood.damage,
          range: stood.range,
          fireRate: stood.fireRate,
          auraRadius: stood.auraRadius,
          auraBonus: stood.auraBonus,
          abilities: [...stood.abilities].sort(),
        };
      }
    }

    return components;
  });
});

it("offers the same recipes at every difficulty", async () => {
  await sameAtEveryDifficulty(
    "the recipes the inspector offers",
    async (difficulty) => {
      await openYard(h, { difficulty });

      const offered: Record<string, string[]> = {};
      for (const combo of COMBOS as readonly ComboDef[]) {
        await h.debug.clearStructures();
        const ids: number[] = [];
        for (const [index, ingredient] of combo.recipe.entries()) {
          const anchor = BENCH[index]!;
          ids.push(
            await standComponent(
              h,
              ingredient.type,
              ingredient.tier,
              anchor.col,
              anchor.row,
            ),
          );
        }
        // The recipe is reachable from any of its own ingredients, so the piece
        // the combine would be initiated from is one of the pieces just stood up.
        await h.debug.select(ids[0]!);
        const rows = await h.debug.panelButtons();
        offered[combo.id] = rows
          .filter((row) => row.action === "combine-special")
          .map((row) => row.label.trim().toUpperCase())
          .sort();
      }

      return offered;
    },
  );
});

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
        await openYard(h, { difficulty, wave: WAVE, charge: 0 });
        await parkUnit(h, unit.type, tileCenter(20, 20), {
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
        bounties[unit.type] = (await h.snapshot()).charge;

        // A LEAK. The unit is put at the collector heading for it, so it grounds
        // out on the next advance without walking a maze first.
        await openYard(h, {
          difficulty,
          wave: WAVE,
          integrity: INTEGRITY,
        });
        const collector = mapById((await h.snapshot()).map).collector;
        await releaseUnit(h, unit.type, {
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
});
