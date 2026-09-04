// instrumentation/deterministic-cascade — one seed replays one cascade.
//
// specs/instrumentation.md "A deterministic core": any randomness the game uses
// runs off a generator seeded from the state's generator field and keeps its whole
// generator state there, "so reseeding and replaying the same calls reproduces the
// same result exactly", and "the deal's shuffle and the cascade's launch velocities
// are both drawn from it". Given the same seed and the same sequence of calls and
// elapsed game time, the game reaches the same state every time.
//
// THE CASCADE IS WHAT THIS READS, because it is the other of the two draws, and
// because it is the one whose result is a continuous quantity rather than an
// arrangement. specs/victory.md gives each launched card a `vx` drawn uniformly
// from `[180, 420]` with a sign chosen with equal probability, and the card then
// integrates that velocity against gravity and the floor for the rest of its
// flight. Two runs drawing independently would put a card on the other side of the
// stage within a fraction of a second, so positions agreeing to half a unit after
// half a second of flight is a seeded generator and nothing else.
//
// TWO ENGINES, ONE SEED, THE SAME CALLS. Each is a harness of its own, seeded with
// `reset({ seed })`, posed with the same board, won by the same move, and advanced
// by the same number of frames of the same constant clock. Nothing else differs
// between them, so what the comparison reads is the generator.
//
// THE CASCADE IS ENTERED THROUGH THE GAME'S OWN WIN PATH rather than posed, because
// what is being compared is what the LAUNCHES drew: `poseNearlyWon` leaves the
// fifty-second card on a column and the move that sends it home wins the game,
// which is what starts the cascade (specs/victory.md).
//
// THE PAINTING IS GATED OFF IN BOTH. It is no part of this point, it is identical
// in the two runs whether it is on or off, and a recording armed around a cascade
// that puts a full-screen layer down on every frame spends the recorder's budget on
// pixels rather than on the flight the reviewer is being shown.
//
// WHAT IT DOES NOT DECIDE. Nothing about the cadence, the launch order or the
// velocities themselves, which are the `cascade` group's points. This one compares
// one cascade against another.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThanOrEqual,
  assertLessThanOrEqual,
  fail,
} from "../assert";
import {
  captureReplay,
  createHarness,
  framesFor,
  poseNearlyWon,
  seconds,
  type CascadeSnapshot,
  type Harness,
} from "../harness";

/** The seed both cascades are drawn from. Any number serves; this is not the default. */
const SEED = 11;

/**
 * How long each cascade is run for.
 *
 * Half a second, which is three of specs/victory.md's `LAUNCH_INTERVAL` (`0.18` s)
 * launches, so several cards are in flight and each has integrated its own drawn
 * `vx` for long enough that two different draws could not still agree.
 */
const RUN_FRAMES = framesFor(0.5);

/**
 * How far apart the two runs may put one card, in logical units.
 *
 * Half a unit, which is the figure this point is stated at. The two runs are the
 * same arithmetic on the same numbers, so a seeded build lands on zero; half a unit
 * is float noise beside the `[180, 420]` units per second a launch draws from, and
 * two independent draws differ by tens of units within a single frame.
 */
const TOLERANCE = 0.5;

/** The cards in flight this point compares between two runs. */
const MIN_FLYERS = 2;

let one: Harness;
let two: Harness;

beforeEach(async () => {
  one = await createHarness();
  two = await createHarness();
});

afterEach(() => {
  one?.dispose();
  two?.dispose();
});

/**
 * Seed the game, win it through its own move rules, and hand back the cascade
 * already running with no frame yet advanced.
 *
 * `openTable` resets with the default seed, so the seed is posed FIRST and the
 * table is opened out of that reset: `reset({ seed })`, the screen, and the empty
 * table are exactly what `openTable` does, with the seed named.
 */
function winFrom(h: Harness, seed: number): void {
  h.debug.reset({ seed });
  h.debug.setScreen("playing");
  h.debug.clearTable();
  h.debug.setTrailPainting(false);

  const pending = poseNearlyWon(h);
  const accepted = h.debug.move(
    pending.from.pile,
    pending.from.index,
    pending.from.row,
    "foundation",
    pending.foundation,
  );
  if (accepted !== true) {
    fail(
      "move() to accept the last card of a suit onto that suit's foundation, " +
        "which is what wins the game (specs/foundations.md)",
      accepted,
    );
  }
}

/** The cards in flight, as one line each, for a failure a reader can follow. */
function flight(snapshot: CascadeSnapshot): string {
  return snapshot.flyers
    .map((f) => `${f.id}@(${f.x.toFixed(3)}, ${f.y.toFixed(3)})`)
    .join(" ");
}

it("puts every card in flight in the same place, twice from one seed", async () => {
  winFrom(one, SEED);
  winFrom(two, SEED);

  await one.advance(RUN_FRAMES);
  const first = one.snapshot();

  // One seed's cascade, replayed.
  await captureReplay(two, "replay", () => two.advance(RUN_FRAMES));
  const again = two.snapshot();

  assertGreaterThanOrEqual(
    first.flyers.length,
    MIN_FLYERS,
    `the cards in flight after ${seconds(RUN_FRAMES)} s of a cascade, which ` +
      "is what the two runs are compared on (specs/victory.md)",
  );
  assertEqual(
    again.flyers.length,
    first.flyers.length,
    "the cards in flight in the second run: two runs from one seed launch the " +
      "same cards (specs/instrumentation.md)",
  );
  assertEqual(
    again.launched,
    first.launched,
    "the cards the second run's cascade had launched",
  );

  for (const [index, flyer] of first.flyers.entries()) {
    const other = again.flyers[index];
    assertEqual(
      other.id,
      flyer.id,
      `the ${index}th card in flight in the second run, beside ` +
        `${flight(first)}`,
    );
    assertLessThanOrEqual(
      Math.abs(other.x - flyer.x),
      TOLERANCE,
      `how far the two runs put card ${flyer.id} apart along x, replayed from ` +
        `seed ${SEED} (specs/instrumentation.md)`,
    );
    assertLessThanOrEqual(
      Math.abs(other.y - flyer.y),
      TOLERANCE,
      `how far the two runs put card ${flyer.id} apart along y, replayed from ` +
        `seed ${SEED} (specs/instrumentation.md)`,
    );
  }
});
