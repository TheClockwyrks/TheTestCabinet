// difficulty/same-bounties-and-leaks — a kill pays the same and a leak costs the
// same at every difficulty.
//
// `specs/difficulty.md` names them among the values "identical at every
// difficulty": "the bounties, the leak values". Both are events rather than reads,
// so each of the six roster types is actually killed and actually leaked at each of
// the three difficulties, and the change each made is held against the other two.
//
// NOTHING ELSE CAN MOVE EITHER COUNTER. The yard is emptied, nothing fires, nothing
// refines, and the wave's own clear-and-pay resolution is held
// (`specs/instrumentation.md`), so the Charge a kill moves is the bounty and the
// Grid Integrity a leak moves is the leak value. The wave is deep enough for no
// reason but this: the health posed for a kill is `1` whatever the wave.
//
// What each figure IS is decided by the campaign and Load checklists, so a build
// that pays a Slug wrong fails there rather than twice over here.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { LOAD_ROSTER, mapById, tileCenter } from "../constants";
import {
  captureStill,
  createHarness,
  type Harness,
  holdWave,
  openYard,
  parkUnit,
  releaseUnit,
  ticks,
} from "../harness";
import { sameAtEveryDifficulty } from "./same";

/** The wave every reading below is taken at. */
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

it("pays the same bounties and charges the same leaks at every difficulty", async () => {
  await sameAtEveryDifficulty(
    "the bounties and the leak values",
    async (difficulty) => {
      const bounties: Record<string, number> = {};
      const leaks: Record<string, number> = {};

      for (const unit of LOAD_ROSTER) {
        // A KILL. The unit is held where it stands, dropped to a single point of
        // health, and burned off it — so nothing on the yard is firing, nothing is
        // walking, and the wave cannot clear behind the death. What is left to
        // move the counter is the bounty.
        openYard(h, { difficulty, wave: WAVE, charge: 0 });
        holdWave(h);
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
        bounties[unit.type] = killed.snapshot.charge;

        // A LEAK. The unit is put at the collector heading for it, so it grounds
        // out on the next advance without walking a maze first.
        openYard(h, { difficulty, wave: WAVE, integrity: INTEGRITY });
        holdWave(h);
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
  // The last of the three readings, drawn: the yard the comparison ended on.
  await h.advance(1);
  captureStill(h, "economy");
});
