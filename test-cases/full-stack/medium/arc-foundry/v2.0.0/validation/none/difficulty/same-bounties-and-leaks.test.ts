// difficulty/same-bounties-and-leaks — each type pays the same bounty
// and costs the same leak at every difficulty.
//
// THE REQUIREMENT. `specs/difficulty.md` is explicit about the negative: "A
// difficulty sets the number of waves and the constants of the per-wave health
// scaling, and nothing else. Every other value is identical at every difficulty:
// the starting Charge, the starting Grid Integrity, the stamp allowance, the
// refinement track and its costs, the Load roster's base figures, the bounties,
// the leak values, the wave-clear bonus, the component stats, and the recipes."
// That sentence names several separately observable things, and a build can get
// any one of them wrong on its own, so each is its own point.
//
// THE COMPARISON IS BETWEEN THE DIFFICULTIES, not against the specification's
// numbers: what the starting Charge is, what a Slug's bounty is and what a
// Charged Capacitor hits for are each decided by a point of their own on the
// economy, campaign and component checklists, and a build that gets one of them
// wrong should fail that point once rather than twice over. What is decided HERE
// is that whichever figure a build carries, it carries the same one at Easy, at
// Medium and at Hard.
//
// HOW IT IS DECIDED. At each difficulty every roster type is killed once and
// leaked once, and the Charge the death paid and the Grid Integrity the leak cost
// are read off the counters. The three difficulties' readings are held against
// each other.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { LOAD_ROSTER, mapById, tileCenter } from "../constants";
import {
  captureStill,
  createHarness,
  openYard,
  parkUnit,
  releaseUnit,
  ticks,
  type Harness,
} from "../harness";
import { sameAtEveryDifficulty } from "./same";

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
  // The last of the three readings, drawn: the yard the comparison ended on.
  await h.advance(1);
  await captureStill(h, "economy");
});
