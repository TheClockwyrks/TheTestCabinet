// instrumentation/deterministic-cascade — one seed replays one cascade: reseeded
// and driven through the same calls and the same elapsed game time, the victory
// cascade puts every card in the same place.
//
// THE RULE. `specs/instrumentation.md`, A deterministic core: "Any randomness the
// game uses runs off a generator seeded from the state's generator field, and it
// keeps its whole generator state in that field, so reseeding and replaying the
// same calls reproduces the same result exactly. The deal's shuffle and the
// cascade's launch velocities are both drawn from it." And, of the whole surface:
// "Given the same seed and the same sequence of calls and elapsed game time, the
// game reaches the same state every time."
//
// WHY THE CASCADE IS WORTH ITS OWN POINT BESIDE THE DEAL.
// `instrumentation/reset-seed-repeats-deal` replays one call and reads one
// arrangement. This replays two hundred and forty frames of a running simulation,
// and the randomness it exercises is the other of the two the specification names:
// the launch velocity, whose "magnitude and the sign are drawn from the game's
// seeded generator" (`specs/victory.md`). A build that seeded its shuffle properly
// and reached for `Math.random()` for the launches — the natural split, since one
// is asked for a seed and the other is not — passes there and fails here.
//
// WHAT MAKES THE TWO RUNS THE SAME RUN. Each is opened by `reset({ seed })`, which
// "seeds all of the game's randomness", and then driven through an identical
// sequence: the same poses, the same win, and the same number of frames from the
// suite's own clock, which gives every frame the same delta. So the two differ in
// nothing the specification allows a difference in, and any difference in the
// result is the build's own.
//
// THE CARDS ARE COMPARED IN FLIGHT ORDER, NOT BY ID. A card added to the flight
// "is appended, so it is the last entry" (`specs/instrumentation.md`), and the
// cascade launches in a fixed order, so the nth entry of one run answers the nth
// of the other. Ids are the build's own bookkeeping and nothing requires a second
// run to hand out the same numbers, so they are left out of the comparison.
//
// THE TRAIL IS OFF. A replay of a cascade that paints spends its whole image
// budget on the full-stage layer in a handful of frames, and the layer is not what
// this point compares — the cards' positions are, and the trail changes none of
// them.
//
// WHAT THIS DOES NOT DECIDE. Where a launch puts a card, how fast, how often, or
// which foundation's turn it is — every one of those is a point of its own in the
// `cascade` group, and a build that launched every card straight up at the same
// speed would satisfy this one while failing those. Nor that the two runs agree on
// anything but the cards in flight.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThanOrEqual,
  assertLessThanOrEqual,
} from "../assert";
import { DEFAULT_SEED } from "../constants";
import {
  captureReplay,
  createHarness,
  framesFor,
  startCascade,
  type CascadeSnapshot,
  type Harness,
} from "../harness";

/** The seed both runs are made from. Deliberately not `DEFAULT_SEED`. */
const SEED = 20250830;

/**
 * How much of each cascade is run, in seconds of game time.
 *
 * One second is `floor(1 / LAUNCH_INTERVAL) + 1` launches — six
 * (`specs/victory.md`) — so several independent draws from the generator have been
 * made and several parabolas are part-way through. Long enough that a build
 * drawing its velocities from an unseeded source cannot agree by luck, and short
 * enough that a replay of it stays small.
 */
const RUN_SECONDS = 1;

/**
 * The fewest cards that must be in flight at the reading.
 *
 * Two. A comparison of an empty flight against an empty flight would pass on a
 * build that launched nothing, so this is the precondition that says there was a
 * cascade to replay. It is far below the six launches the second covers, because a
 * card launched fast enough retires off a side edge inside it and the
 * specification leaves that speed random — how many are still up is not this
 * point's business.
 */
const MIN_FLYERS = 2;

/**
 * How far a replayed card may sit from where the first run put it, in logical
 * units.
 *
 * `0.5`, half a unit on a stage `1280` wide — a twentieth of a card's height and
 * far under a pixel of the reader's eye. A conforming build reproduces the run
 * exactly, so this is arithmetic room rather than a reading of anything: two
 * summations of the same doubles in the same order are equal, and any build that
 * drew a different velocity misses by tens of units within the first frames.
 */
const POSITION_TOLERANCE = 0.5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/**
 * Open one run: reseeded, on an empty table, with a real win behind it.
 *
 * The body of `openTable` with the seed written in, since `openTable` resets to
 * `DEFAULT_SEED` and the seed is the whole subject here. `startCascade` then wins
 * the game through its own path, so what runs from there is the build's own
 * cascade.
 */
async function openRun(harness: Harness): Promise<void> {
  await harness.debug.reset({ seed: SEED });
  await harness.debug.setScreen("playing");
  await harness.debug.clearTable();
  await harness.debug.setTrailPainting(false);
  await startCascade(harness);
}

/** The cards in flight, in flight order, as `x` and `y` alone. */
function flight(s: CascadeSnapshot): { x: number; y: number }[] {
  return s.flyers.map((flyer) => ({ x: flyer.x, y: flyer.y }));
}

it("replays the same cascade from the same seed", async () => {
  await openRun(h);
  await h.advance(framesFor(RUN_SECONDS));
  const first = flight(await h.snapshot());

  await openRun(h);
  await captureReplay(h, "replay", () => h.advance(framesFor(RUN_SECONDS)));
  const second = flight(await h.snapshot());

  assertGreaterThanOrEqual(
    first.length,
    MIN_FLYERS,
    `the cards in flight after ${RUN_SECONDS} s of the first run's cascade — ` +
      `two empty flights would agree trivially and say nothing about the seed`,
  );
  assertEqual(
    second.length,
    first.length,
    `the cards in flight after ${RUN_SECONDS} s of the second run from ` +
      `seed ${SEED}, against what the first run had up at the same point — ` +
      `reseeding and replaying the same calls reproduces the same result ` +
      `exactly (specs/instrumentation.md), and the default seed this scenario ` +
      `does NOT use is ${DEFAULT_SEED}`,
  );

  for (const [index, card] of second.entries()) {
    for (const axis of ["x", "y"] as const) {
      assertLessThanOrEqual(
        Math.abs(card[axis] - first[index][axis]),
        POSITION_TOLERANCE,
        `how far the ${axis} of the card ${index + 1} entries into the second ` +
          `run's flight sits from the ${axis} of the card at the same place in ` +
          `the first run's, in logical units — one seed and one sequence of ` +
          `calls replay one cascade (specs/instrumentation.md); the first run ` +
          `had it at (${first[index].x.toFixed(2)}, ` +
          `${first[index].y.toFixed(2)}) and the second at ` +
          `(${card.x.toFixed(2)}, ${card.y.toFixed(2)})`,
      );
    }
  }
});
