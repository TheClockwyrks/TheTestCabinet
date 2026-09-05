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
// THE TWO READINGS, AND WHY BOTH. The rule is one sentence with two visible
// faces, and one sample decides it from both.
//
//   - WHAT LANDED. Every pickup a kill drops lands "at the enemy's position",
//     so two pickups sharing a center is exactly one kill having dropped both.
//     No center in the sample carries two. A conformant build leaves none with
//     certainty, whatever the seed.
//   - WHAT WAS DRAWN. The build that breaks the rule most simply draws for a
//     draft on every kill regardless of the bread draw, and what landed betrays
//     that build only on the kill where BOTH draws hit — `BREAD_CHANCE ×
//     DRAFT_CHANCE` (`1e-4`) per kill, which no sample a validator can afford
//     makes certain. The draws themselves betray it on every kill: the sweep's
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
// left it". A fresh reset on the sweep's own seed and one `advanceRng` of the
// count the rule owes therefore lands the build's own generator exactly where
// the sweep's kills left it, and the two states are compared.
//
// WHY THE WORLD IS POSED AS IT IS. `sweepCommonKills` in `./stage` poses the
// sample: an isolated night, every driver switch off but `drops` and no slot
// held, so the only draws the ticks make are the kills' own; `DROP_ROLL_KILLS`
// (`4000`) real kills of a moth by a level-1 Ember bolt, each at its own point,
// no two of the four thousand points coinciding and every one far outside the
// radii that attract or collect. So a pickup's center names the kill that
// dropped it. The field is swept between rounds, which draws nothing, so each
// round's pickups are that round's drops; a kill's two possible drops land at
// one point on one tick, so a round is the whole of the window in which two
// pickups could share a center. Four thousand kills leave about `80` bread, so
// the draw count the second reading compares against is one a build that drew
// unconditionally cannot match.
//
// THE TOLERANCE. None on either reading. Two centers are the same point or they
// are not, and a center is compared as the exact pair the snapshot reports, a
// copy of the position the kill was posed at; `rngState` is a state the
// generator either reached or did not.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { DEFAULT_SEED, DROP_ROLL_KILLS } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { sweepCommonKills } from "./stage";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves no two pickups on one center over 4000 seeded common kills, and draws once for each kill that dropped bread", async () => {
  const sweep = await sweepCommonKills(h, DROP_ROLL_KILLS);
  await captureStill(h, "one");

  assertEqual(sweep.kills, DROP_ROLL_KILLS, "the kills the sample made");

  const shared: string[] = [];
  for (const round of sweep.rounds) {
    const seen = new Map<string, number>();
    for (const pickup of round.pickups) {
      const center = `${pickup.x},${pickup.y}`;
      const count = (seen.get(center) ?? 0) + 1;
      seen.set(center, count);
      if (count > 1) shared.push(center);
    }
  }
  assertEqual(
    shared.length,
    0,
    "the centers carrying more than one pickup over the sample",
  );

  // The same rule read off the generator: one draw for a kill that dropped
  // bread, two for one that did not.
  const bread = sweep.counts.bread;
  const owed = 2 * sweep.kills - bread;
  await h.debug.reset({ seed: DEFAULT_SEED });
  assertEqual(
    (await h.snapshot()).rngState,
    sweep.startRng,
    "rngState on the seed the sweep began at, so the replay of its draws begins where the sweep did (specs/instrumentation.md, reset)",
  );
  await h.debug.advanceRng(owed);
  assertEqual(
    (await h.snapshot()).rngState,
    sweep.endRng,
    `rngState after ${owed} draws taken off the generator on the sweep's own seed, against where the sweep's ${sweep.kills} kills left it: one draw for each of the ${bread} kills that dropped bread and two for each of the ${sweep.kills - bread} that did not (specs/world.md, The drop roll)`,
  );
});
