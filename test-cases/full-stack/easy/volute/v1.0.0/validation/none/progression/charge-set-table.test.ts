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
// states both: the seeded cores, whose "charge is drawn at random, uniformly
// over the level's charge set", and an emission, "uniformly over the set of
// distinct charges on the channel at the moment of emission, and uniformly over
// the level's charge set when the channel carries no core".
//
// THE DRIVE, IN TWO HALVES, BECAUSE THE SET IS REACHED TWO WAYS.
//
//   1. The opening twelve. `startLevel(n)` seeds them from the level's set, so
//      every charge the level opens with is read straight off the snapshot.
//   2. The emission that falls back to the level's set. An emission onto a
//      channel that is carrying cores draws from the charges already standing,
//      which cannot leave the set the opening put there, so the half that
//      reaches the LEVEL's set is the empty-channel fallback: the channel is
//      emptied, the inlet is left a quota with its gate open, and one tick is
//      stepped. `specs/channel.md` — "A channel carrying no core satisfies that
//      condition, so an emission follows at once."
//
// THE SAMPLE. Twelve opening charges and eight emissions a level, each read
// against the set the specification names for it. A handful of unposed draws is
// what a check on a draw's RANGE reads: how many draws it takes for a set to
// show every one of its members is a property of a build's generator rather
// than of the specification.
//
// WHAT THIS FILE DELIBERATELY DOES NOT DRIVE. An emission onto an occupied
// channel is `channel/emission-charge-present`'s point, and reaching one means
// riding the train for hundreds of ticks a level. Every draw read here is posed
// instead.
//
// TOLERANCES. None. A charge id is exact, and membership of a five-name set is a
// yes or a no.

import { afterEach, beforeEach, it } from "vitest";
import { assertEachIn, assertLength } from "../assert";
import { LEVELS } from "../constants";
import {
  captureStill,
  charges,
  createHarness,
  poseHall,
  type Harness,
} from "../harness";

/** Emissions drawn from an emptied channel, which is the level-set fallback. */
const EMPTY_DRAWS = 8;

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

    // 2. Emissions onto an empty channel, which is the draw that reaches for
    //    the level's set rather than for what is standing on the channel.
    for (let draw = 0; draw < EMPTY_DRAWS; draw += 1) {
      await poseHall(h, {
        level: level.level,
        // The draw being read IS an emission, so the inlet's gate is open.
        emission: true,
        quotaRemaining: level.quota,
      });
      const placed = charges(await h.step(1));
      // The emission "follows at once" onto an empty channel, so the tick placed
      // exactly one core, and the reading is of that core rather than of nothing.
      assertLength(
        placed,
        1,
        `the cores one tick placed onto the emptied channel on level ${level.level}`,
      );
      assertEachIn(placed, level.charges, context);
    }
  }
});
