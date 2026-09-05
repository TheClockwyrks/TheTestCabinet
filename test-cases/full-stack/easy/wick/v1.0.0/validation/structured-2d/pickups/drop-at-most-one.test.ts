// pickups/drop-at-most-one — a common kill drops at most one of bread and
// draft.
//
// WHERE THE REQUIREMENT COMES FROM. `specs/world.md` ("The drop roll"): "A
// first draw, uniform on `[0, 1)`, drops bread when it is below
// `BREAD_CHANCE`. Only when it did not, a second draw drops a draft when it is
// below `DRAFT_CHANCE`. The second draw is made only in that case, so a kill
// that drops bread takes one draw off the generator and a kill that does not
// takes two. A kill therefore drops at most one of the two, and the pickup
// lands at the enemy's position beside its gem."
//
// THE TWO READINGS, AND WHY BOTH. The rule is one sentence with two visible
// faces, and a sample decides it from both.
//
//   - WHAT LANDED. Every pickup a kill drops lands at that kill's own point, so
//     two pickups sharing a center is exactly one kill having dropped both. No
//     center in the sample carries two.
//   - WHAT WAS DRAWN. The build that breaks the rule most simply makes the
//     second draw unconditionally, and what landed betrays that build only on
//     the kill where BOTH draws hit — `BREAD_CHANCE × DRAFT_CHANCE` (`0.02 ×
//     0.005`, `1e-4`) per kill, which no sample a validator can afford makes
//     certain. The draws themselves betray it on every kill: the sample's kills
//     owe exactly one draw for each kill that dropped bread and two for each
//     kill that did not, and that count is read off the build's own generator
//     rather than counted for it. So this reading catches with certainty the
//     design the first reading catches only by luck, and neither replaces the
//     other: a build that drops both pickups without drawing twice fails the
//     first, and a build that draws twice on a bread kill fails the second.
//
// HOW THE DRAWS ARE COUNTED. `specs/instrumentation.md` ("A deterministic
// core"): the game "holds one pseudo-random generator, seeded by `reset` and
// keeping its whole state in `rngState`", and "the generator's whole sequence
// follows from its seed". `advanceRng(draws)` "takes `draws` draws off the
// seeded generator and discards them, so `rngState` lands where `draws` random
// choices would have left it". So a fresh `reset` on the sample's own seed and
// one `advanceRng` of the count the rule owes lands the build's own generator
// exactly where the sample's kills left it, and the two states are compared.
// Nothing else in the sample draws: every switch but `drops` is off, no slot is
// held, and a pose "changes the state alone".
//
// WHY THE SAMPLE IS THE SHARED ONE. `pickups/roll` poses it: an isolated night,
// every driver switch off but `drops`, and `DROP_TRIALS` (`4000`) moths killed
// by their own level-1 Oil Splash puddles on a lattice `200` units apart, each
// kill at its own point, far enough from the lamplighter that nothing is
// attracted or collected, posed `NARROW_BATCH` (`20`) to a tick rather than the
// hundred the counting checks pose, which is the same four thousand kills over
// more ticks and less field. The seed is fixed, so a build's answer here is the
// same on every run of the check. Four thousand kills leave about `80` bread,
// so the draw count the second reading compares against is one a build that
// drew unconditionally cannot match; a sample that happened to drop no bread at
// all would leave the two counts equal, which four thousand kills at
// `BREAD_CHANCE` puts past any accident.
//
// THE TOLERANCE. None on either reading. Two centers are the same point or they
// are not, and every point of the lattice is a sum of exact whole numbers;
// `rngState` is a state the generator either reached or did not.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { DEFAULT_SEED, DROP_TRIALS } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { NARROW_BATCH, countOf, sampleDrops } from "./roll";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("leaves no two pickups sharing a center over 4000 seeded kills, and draws once for each kill that dropped bread", async () => {
  const sample = await sampleDrops(h, DEFAULT_SEED, DROP_TRIALS, NARROW_BATCH);
  // The still is the last batch's own frame: the field its kills left.
  captureStill(h, "one");

  assertEqual(sample.kills, DROP_TRIALS, "the common kills the sample made");

  const centers = new Set(sample.drops.map((drop) => `${drop.x},${drop.y}`));
  assertEqual(
    centers.size,
    sample.drops.length,
    `the distinct pickup centers among the ${sample.drops.length} pickups ${DROP_TRIALS} kills dropped, which must equal the count (specs/world.md, The drop roll)`,
  );

  // The same rule read off the generator: one draw for a kill that dropped
  // bread, two for one that did not.
  const bread = countOf(sample.drops, "bread");
  const owed = 2 * sample.kills - bread;
  h.reset(DEFAULT_SEED);
  assertEqual(
    h.snapshot().rngState,
    sample.startRng,
    `rngState on the seed the sample began at, so the replay of its draws begins where the sample did (specs/instrumentation.md, reset)`,
  );
  h.debug.advanceRng(owed);
  assertEqual(
    h.snapshot().rngState,
    sample.endRng,
    `rngState after ${owed} draws taken off the generator on the sample's own seed, against where the sample's ${sample.kills} kills left it: one draw for each of the ${bread} kills that dropped bread and two for each of the ${sample.kills - bread} that did not (specs/world.md, The drop roll)`,
  );
});
