// pickups/drop-at-most-one — a common kill drops at most one of bread and a
// draft.
//
// WHERE THE REQUIREMENT COMES FROM. specs/world.md ("The drop roll"): "A first
// draw, uniform on `[0, 1)`, drops bread when it is below `BREAD_CHANCE`. Only
// when it did not, a second draw drops a draft when it is below `DRAFT_CHANCE`.
// The second draw is made only in that case, so a kill that drops bread takes
// one draw off the generator and a kill that does not takes two. A kill
// therefore drops at most one of the two, and the pickup lands at the enemy's
// position beside its gem."
//
// THE WORLD. The seeded sample of `pickups/sample.ts`: `DROP_SAMPLE` (4000)
// moths killed by posed Ember bolts, each on a point no other kill uses, with
// every driver switch off but `drops` and no weapon held, so the drop roll is
// the only thing that can leave a pickup anywhere and the only thing that can
// draw from the generator.
//
// THE TWO READINGS, AND WHY BOTH. The rule is one sentence with two visible
// faces, and the one sample decides it from both.
//
//   - WHAT LANDED. The most pickups any single kill point carries, at most one;
//     and, as a guard on the sample itself, that no pickup fell on a point no
//     kill happened at. Four thousand kills is a sample in which the bread
//     branch is expected about 80 times and the draft branch about 20, so a
//     build that drops both at any material rate puts two pickups on one point
//     many times over.
//   - WHAT WAS DRAWN. The build that breaks the rule most simply draws for a
//     draft on every kill regardless of the bread draw, and what landed betrays
//     that build only on the kill where BOTH draws hit — `BREAD_CHANCE ×
//     DRAFT_CHANCE` (`1e-4`) per kill, which no sample a validator can afford
//     makes certain. The draws themselves betray it on every kill: the sample's
//     kills owe one draw for each kill that dropped bread and two for each kill
//     that did not, and that count is read off the build's own generator rather
//     than counted for it. Neither reading replaces the other: a build that
//     drops both pickups without drawing twice fails the first, and a build that
//     draws twice on a bread kill fails the second.
//
// HOW THE DRAWS ARE COUNTED. specs/instrumentation.md ("A deterministic core"):
// the game "holds one pseudo-random generator, seeded by `reset` and keeping its
// whole state in `rngState`", and "the generator's whole sequence follows from
// its seed". `advanceRng(draws)` "takes `draws` draws off the seeded generator
// and discards them, so `rngState` lands where `draws` random choices would have
// left it". A fresh reset on the sample's own seed and one `advanceRng` of the
// count the rule owes therefore lands the build's own generator exactly where
// the sample's kills left it, and the two states are compared.
//
// TOLERANCE. None. The first reading is a count over exact positions, and the
// kill points are 100 units apart, so it cannot confuse two neighbouring kills;
// `rngState` is a state the generator either reached or did not.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLessThanOrEqual } from "../assert";
import { DEFAULT_SEED } from "../constants";
import { createHarness, type Harness } from "../harness";
import { drawDrops } from "./sample";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves no kill point carrying two pickups across 4000 seeded kills, and draws once for each kill that dropped bread", async () => {
  const sample = await drawDrops(h, "one");

  assertEqual(sample.strays, 0, "pickups that fell on no kill point");
  assertLessThanOrEqual(
    sample.mostPerPoint,
    1,
    `pickups on the busiest of ${sample.kills} kill points`,
  );

  // The same rule read off the generator: one draw for a kill that dropped
  // bread, two for one that did not.
  const bread = sample.counts.bread;
  const owed = 2 * sample.kills - bread;
  h.reset(DEFAULT_SEED);
  assertEqual(
    h.snapshot().rngState,
    sample.startRng,
    "rngState on the seed the sample began at, so the replay of its draws begins where the sample did (specs/instrumentation.md, reset)",
  );
  h.debug.advanceRng(owed);
  assertEqual(
    h.snapshot().rngState,
    sample.endRng,
    `rngState after ${owed} draws taken off the generator on the sample's own seed, against where the sample's ${sample.kills} kills left it: one draw for each of the ${bread} kills that dropped bread and two for each of the ${sample.kills - bread} that did not (specs/world.md, The drop roll)`,
  );
});
