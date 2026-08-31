// Floe — instrumentation/bear-sense-gate: `setBearSense` gates one bear's reading
// of the critter's tile, and only that bear's.
//
// `specs/instrumentation.md` gives the gate exactly that scope: "Gates that
// bear's reading of the critter's tile alone. Off, it stops refreshing its
// target and keeps hunting the tile the target holds; its routing and its travel
// run untouched." `specs/hunter.md` fixes what is being held off: "A bear's
// target is the tile the critter is on, read afresh every tick."
//
// WITHOUT IT NOTHING CAN BE ASKED OF A BEAR'S ROUTE. A check that wants to know
// which step a bear takes toward a given tile has to be able to name that tile,
// and with sense running the game overwrites it on the next tick. That makes the
// gate load-bearing — `poseBear` offers it for exactly this — and a gate the
// suite leans on has to be known to work before anything leaning on it means
// anything.
//
// SO TWO BEARS ARE POSED SIDE BY SIDE AND THE CRITTER IS MOVED OUT FROM UNDER
// BOTH. One has its sense off and a target of its own; the other has its sense
// on. After the move, the gated bear must still report the posed tile and the
// other must report the critter's new one. One bear alone would be half the
// requirement: a build whose targets never refresh at all passes the gated
// reading and fails the other, so the pair names which.
//
// THE POSED TARGET IS DISTINGUISHING. `(2, 18)` is not the gated bear's own tile,
// not the critter's tile before the move, and not its tile after it, so each
// wrong model reads as a tile this check names: a build that refreshed anyway
// reports the critter's new tile, and one that reset the target on gating
// reports the bear's own.
//
// THE OTHER TWO FACULTIES ARE HELD OFF ON BOTH BEARS. Neither is asked to choose
// a step or to travel — the requirement is what each one HUNTS — so neither
// moves, and a build whose routing or travel is broken is graded on those by the
// hunter checks rather than here.
//
// THE LEVEL IS `SECOND_BEAR_LEVEL`, because `specs/hunter.md` gives a level below
// it one slot: two bears on the strait at once is a situation the specification
// allows only from level `5`, and this check needs two.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { SECOND_BEAR_LEVEL } from "../constants";
import {
  captureReplay,
  createHarness,
  critterTile,
  poseBear,
  requireBear,
  startCrossing,
  ticksFor,
  type Harness,
} from "../harness";

/** The level posed, so two bears on the strait at once is a legal situation. */
const LEVEL = SECOND_BEAR_LEVEL;

/** The row all three bodies stand on: solid ice, well clear of every edge. */
const ROW = 15;

/** Where the critter starts, and the tile four columns away it is moved to. */
const CRITTER_FROM = 20;
const CRITTER_TO = 24;

/** The two bears: the gated one, and the one that keeps its sense. */
const GATED_COL = 6;
const SENSING_COL = 34;

/**
 * The tile the gated bear is posed to hunt.
 *
 * Neither bear's own tile, and neither the critter's tile before the move nor
 * after it, so a build that refreshed the target anyway and a build that reset
 * it on gating each read as a different, named tile.
 */
const POSED_TARGET = { col: 2, row: 18 };

/**
 * The game time run after the critter is moved, in seconds.
 *
 * Half a second, which is sixty ticks. `specs/hunter.md` refreshes a target
 * "afresh every tick", so one tick is all a sensing bear needs; this is sixty
 * times that, and it grades no cadence — a build that refreshes once a second
 * still reports the new tile inside it.
 */
const SETTLE_SECONDS = 0.5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("holds a gated bear's target while the bear beside it follows the critter", async () => {
  await startCrossing(h, LEVEL);
  await h.debug.setCritterTile(CRITTER_FROM, ROW);

  // Only the faculty this point exercises is left to differ between the two:
  // neither chooses a step and neither travels.
  const gated = await poseBear(h, GATED_COL, ROW, {
    sense: false,
    routing: false,
    travel: false,
    target: POSED_TARGET,
  });
  const sensing = await poseBear(h, SENSING_COL, ROW, {
    routing: false,
    travel: false,
  });

  const posed = await h.snapshot();
  assertEqual(
    requireBear(posed, gated, "the gated bear").sense,
    false,
    `snapshot() bear ${gated}.sense after setBearSense(${gated}, false), ` +
      `which the snapshot reports (specs/instrumentation.md)`,
  );
  assertEqual(
    requireBear(posed, sensing, "the sensing bear").sense,
    true,
    `snapshot() bear ${sensing}.sense, which addBear leaves on ` +
      `(specs/instrumentation.md)`,
  );

  const read = await captureReplay(h, "gate", async () => {
    await h.debug.setCritterTile(CRITTER_TO, ROW);
    await h.advance(ticksFor(SETTLE_SECONDS));
    return h.snapshot();
  });

  const moved = critterTile(read);
  assertEqual(
    `${moved.col},${moved.row}`,
    `${CRITTER_TO},${ROW}`,
    `the tile the critter stands on after the move, which is the tile a ` +
      `sensing bear must now be hunting`,
  );

  const held = requireBear(read, gated, "the gated bear after the move");
  assertEqual(
    `${held.target.col},${held.target.row}`,
    `${POSED_TARGET.col},${POSED_TARGET.row}`,
    `the tile bear ${gated} hunts ${SETTLE_SECONDS} s after the critter moved ` +
      `four tiles, with its sense off — it "stops refreshing its target and ` +
      `keeps hunting the tile the target holds" (specs/instrumentation.md)`,
  );

  const following = requireBear(
    read,
    sensing,
    "the sensing bear after the move",
  );
  assertEqual(
    `${following.target.col},${following.target.row}`,
    `${CRITTER_TO},${ROW}`,
    `the tile bear ${sensing} hunts over the same stretch, with its sense on ` +
      `— specs/hunter.md reads the critter's tile afresh every tick`,
  );
});
