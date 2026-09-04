// Wick — progression/passive-max-levels: a passive standing at its own max
// level is not a candidate.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/progression.md`, "The
// candidate pool": the pool holds "every held passive BELOW its max level".
// `specs/passives.md`, "Holding a passive": "A passive enters a slot at level
// `1` and rises one level at a time, up to its max level ... A passive at its
// max level is never offered again", and its table gives each of the ten its
// own max: Brass `3`, Mirror `2`, and `5` for the other eight.
//
// THE POSE. Ten isolated `playing` runs, one for each passive, each holding
// that passive alone at the max its table row gives it. The maxima differ
// between passives, so a build that reads one number for all ten passes at
// most the passives whose max it happens to match. Passive slots stay free, so
// the pool is otherwise full and the check reads a real pool. Every driver
// switch is off and the world is empty in each run.
//
// THE TOLERANCE. Exact: the absence of one id from a list of ids, ten times.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotContains } from "../assert";
import { PASSIVE_IDS, PASSIVES } from "../constants";
import {
  captureStill,
  createHarness,
  holdPassive,
  isolate,
  openLevelUp,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("leaves each of the ten passives out of the pool once it stands at its own max", async () => {
  for (const id of PASSIVE_IDS) {
    const max = PASSIVES[id].maxLevel;
    isolate(h);
    holdPassive(h, id, max);

    const overlay = await openLevelUp(h, 1);
    assertEqual(
      overlay.screen,
      "levelup",
      `screen after the opening tick with ${id} maxed`,
    );
    assertEqual(
      overlay.run.passives[0].level,
      max,
      `the level ${id} stands at`,
    );
    assertNotContains(
      overlay.run.pool,
      id,
      `run.pool with ${id} held at its max of ${max} (specs/passives.md)`,
    );
  }
  await h.frameDraw();
  captureStill(h, "maxed");
});
