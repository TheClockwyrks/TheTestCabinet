// progression/charge-set-table — each level uses only its own charges.
//
// THE SPEC LINE. `specs/progression.md` — "Levels" fixes one charge set per
// level:
//
//   | 1 | halide, sulfur, cobalt |
//   | 2 | halide, sulfur, cobalt, garnet |
//   | 3 | halide, sulfur, cobalt, garnet |
//   | 4 | halide, sulfur, cobalt, garnet, olivine |
//   | 5 | halide, sulfur, cobalt, garnet, olivine |
//
// "The charges in play are the level's charge set, the set every charge draw
// falls back to." Two draws put a core on the channel, and `specs/channel.md`
// states both: the seeded cores, whose "charge is drawn from the seeded generator
// uniformly over the level's charge set", and an emission, "uniformly over the
// set of distinct charges on the channel at the moment of emission, and uniformly
// over the level's charge set when the channel carries no core".
//
// THE DRIVE, IN TWO HALVES, BECAUSE THE SET IS REACHED TWO WAYS.
//
//   1. The opening twelve. `startLevel(n)` seeds them from the level's set, so
//      every charge the level opens with is read straight off the snapshot.
//   2. Emissions. The channel-carrying case draws from the charges already
//      standing, which cannot leave the set a conformant seed put there, so the
//      half that exercises the LEVEL's set is the empty-channel fallback. Twenty
//      further cores are placed by emptying the channel, leaving the inlet a
//      quota, and stepping one tick: `specs/channel.md` — "A channel carrying no
//      core satisfies that condition, so an emission follows at once."
//   3. A run of ordinary play between the two, long enough for several emissions
//      onto a channel that is carrying cores, so a build that draws an emission
//      from some fixed set rather than from the level's is caught there as well.
//
// WHY TWENTY. The set is small and the draw is uniform, so twenty independent
// draws is what makes a stray member likely to show rather than a formality; the
// point is decided by whether any charge seen falls outside the set, so more
// draws only sharpen it.
//
// TOLERANCES. None. A charge id is exact, and membership of a five-name set is a
// yes or a no.

import { afterEach, beforeEach, it } from "vitest";
import { assertEachIn } from "../assert";
import { LEVELS, SPACING, TICK_HZ } from "../constants";
import {
  captureStill,
  charges,
  createHarness,
  poseHall,
  type Harness,
} from "../harness";

/** Emissions drawn from an emptied channel, which is the level-set fallback. */
const EMPTY_DRAWS = 20;

/** Emissions to watch onto a channel that is already carrying cores. */
const CARRIED_EMISSIONS = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws every core's charge from the level's own set", async () => {
  // The evidence first: level 5 opens with the widest set of the five, so its
  // opening twelve is the picture that shows the most.
  await h.debug.startLevel(LEVELS[LEVELS.length - 1].level);
  await h.step(1);
  await captureStill(h, "charges");

  for (const level of LEVELS) {
    const context = `a charge in play on level ${level.level}`;

    // 1. The twelve the level opens with.
    await h.debug.startLevel(level.level);
    assertEachIn(charges(await h.snapshot()), level.charges, context);

    // 2. Emissions onto a channel that is carrying cores. The inlet places one
    //    each time the tail reaches the channel spacing, so the ticks a run of
    //    them takes follow from the level's own feed speed, with one interval
    //    over for the wait the opening tail starts on.
    const interval = Math.ceil((SPACING / level.feed) * TICK_HZ);
    const after = await h.step(interval * (CARRIED_EMISSIONS + 1));
    assertEachIn(charges(after), level.charges, context);

    // 3. Emissions onto an empty channel, which is the draw that reaches for the
    //    level's set rather than for what is standing on the channel.
    for (let draw = 0; draw < EMPTY_DRAWS; draw += 1) {
      await poseHall(h, {
        level: level.level,
        // The draw being read IS an emission, so the inlet's gate is open.
        emission: true,
        quotaRemaining: level.quota,
      });
      assertEachIn(charges(await h.step(1)), level.charges, context);
    }
  }
});
