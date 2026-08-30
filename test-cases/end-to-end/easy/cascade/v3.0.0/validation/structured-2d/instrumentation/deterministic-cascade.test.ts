// instrumentation/deterministic-cascade — one seed replays one cascade.
//
// THE RULE. specs/instrumentation.md, under A deterministic core: "Any
// randomness the game uses runs off a generator seeded from the state's
// generator field, and it keeps its whole generator state in that field, so
// reseeding and replaying the same calls reproduces the same result exactly.
// The deal's shuffle and the cascade's launch velocities are both drawn from
// it. ... Given the same seed and the same sequence of calls and elapsed game
// time, the game reaches the same state every time."
//
// THE CASCADE IS THE HARDER HALF OF THAT SENTENCE. specs/victory.md draws every
// launch's `vx` from the generator — a magnitude out of `[180, 420]` and a sign,
// two draws per card — so a cascade makes a hundred draws in a few seconds and
// carries each of them into a position that keeps integrating. A build that
// reseeds the deal but draws its launch velocities from `Math.random`, or that
// keeps generator state outside the field `reset` restores, deals reproducibly
// and cascades differently every time. This is the reading that separates them.
//
// TWO RUNS FROM ONE SEED, AND NOTHING ELSE DIFFERS. Each run enters the cascade
// through the game's own win path from the same seed, turns painting off, and
// is advanced by the same number of frames of the same clock — so the elapsed
// game time and the sequence of calls are identical and the seed is the only
// thing the two share by choice.
//
// EVERY FLYER IS COMPARED, BY ORDER AND BY POSITION. The flight is reported in
// the order the cards launched (specs/state.md), so entry `n` of one run is
// entry `n` of the other; both the count and each `x` and `y` are held, within
// the half a unit the item states, which is a fortieth of a card's width and
// far under the spread two different `vx` draws would open in a second.
//
// PAINTING IS TURNED OFF IN BOTH RUNS, identically. It changes no position —
// the stamping is the last thing a frame does to a card that has already moved
// — and it keeps the recorded replay to the cards themselves rather than a
// full-screen blit per frame.
//
// WHAT IT DOES NOT DECIDE. That the launch velocities lie in their stated range
// is `cascade.launch-vx-magnitude`, and that both signs occur is
// `cascade.launch-vx-both-signs`. This point decides only that the same seed
// reaches the same place twice.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength, assertLessThanOrEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  startCascade,
  type CascadeSnapshot,
  type Harness,
} from "../harness";

/** The seed both runs are taken from. Any seed the specification permits. */
const SEED = 4242;

/** How long each run's cascade is advanced. */
const SPAN = 1;

/**
 * How far apart the two runs' flyers may lie, in logical units.
 *
 * The item's figure. It is a fortieth of a card's `100`-unit width, and two
 * different draws from `[LAUNCH_VX_MIN, LAUNCH_VX_MAX]` (`[180, 420]`) separate
 * two cards by tens of units inside a tenth of a second (specs/victory.md), so
 * nothing but an identical replay meets it.
 */
const POSITION_TOLERANCE = 0.5;

/** Enter the cascade from `SEED`, with painting held off, and run it for `SPAN`. */
async function runCascade(
  harness: Harness,
  capture: boolean,
): Promise<CascadeSnapshot> {
  startCascade(harness, { seed: SEED });
  harness.debug.setTrailPainting(false);
  if (capture) {
    await captureReplay(harness, "replay", () => harness.advanceSeconds(SPAN));
  } else {
    await harness.advanceSeconds(SPAN);
  }
  return harness.snapshot();
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("puts every flyer in the same place on two runs from one seed", async () => {
  const first = await runCascade(h, false);
  const second = await runCascade(h, true);

  assertLength(
    second.flyers,
    first.flyers.length,
    `cards in flight after ${SPAN} s of a cascade replayed from seed ` +
      `${SEED}, against the same second of the first run: the same seed and ` +
      "the same elapsed game time reach the same state " +
      "(specs/instrumentation.md)",
  );

  const compared = Math.min(first.flyers.length, second.flyers.length);
  for (let index = 0; index < compared; index += 1) {
    const before = first.flyers[index];
    const after = second.flyers[index];
    assertLessThanOrEqual(
      Math.hypot(after.x - before.x, after.y - before.y),
      POSITION_TOLERANCE,
      `how far flyer ${index} of the replayed cascade lies from where the ` +
        `first run from seed ${SEED} left it: the launch velocities are ` +
        "drawn from the seeded generator, so the replay is the same cascade " +
        "(specs/instrumentation.md, specs/victory.md)",
    );
  }
});
