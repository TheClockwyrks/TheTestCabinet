// Floe — instrumentation/bear-routing-gate: `setBearRouting` gates one bear's
// choice of the next step, and only that bear's.
//
// `specs/instrumentation.md` gives the gate exactly that scope: "Gates that
// bear's choice of the next step alone. Off, it takes no new step decision on
// settling: it finishes the step it is on and then holds that tile. Its sense
// still refreshes its target, and its travel still carries out a step
// `setBearStep` commits it to." `specs/hunter.md` fixes what is being held off:
// "On settling on a tile, a bear commits to one step along the four grid
// directions."
//
// WITHOUT IT A BEAR CANNOT BE PUT ANYWHERE AND LEFT THERE. A check about a
// bear's speed, or about which tiles it refuses, has to be able to send it one
// way and read the result without the game choosing a different way on the next
// tick. That makes the gate load-bearing — `poseBear` offers it for exactly this
// — and a gate the suite leans on has to be known to work before anything
// leaning on it means anything.
//
// SO TWO BEARS ARE POSED ON ONE ROW AND THE STRAIT IS RUN FOR THREE SECONDS.
// One has its routing off and a committed step of its own; the other has its
// routing on. One bear alone would be half the requirement: a build whose bears
// never step at all passes the gated reading and fails the other, so the pair
// names which.
//
// THE COMMITTED STEP POINTS AWAY FROM THE CRITTER, which is what makes the gated
// reading distinguishing. The bear is settled at column `6` with the critter at
// column `20`, and it is committed one step LEFT: a build that ignored the gate
// and routed on settling would turn round and finish the three seconds a dozen
// tiles to the RIGHT, so the failure names the wrong model rather than merely
// missing a tile. The two halves of the gate's own sentence are then both read:
// the bear FINISHES the step it is on — it is settled on `(5, 15)`, one tile
// left of where it started, rather than frozen where it stood — and it HOLDS
// that tile for the rest of the three seconds.
//
// AND ITS SENSE IS LEFT RUNNING, so the third reading is the rest of that
// sentence: the critter is moved partway through and the gated bear's target
// follows it. A build that implemented "routing off" by switching the whole
// creature off is caught there.
//
// THE LEVEL IS `SECOND_BEAR_LEVEL`, because `specs/hunter.md` gives a level below
// it one slot: two bears on the strait at once is a situation the specification
// allows only from level `5`, and this check needs two. Nothing here reads a
// speed, so the level's own scaling is not in the reading.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertEqual, assertNotEqual } from "../assert";
import { SECOND_BEAR_LEVEL, tileCX, tileCY, type Facing } from "../constants";
import {
  captureReplay,
  createHarness,
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

/** Where the critter starts, and the tile it is moved to partway through. */
const CRITTER_FROM = 20;
const CRITTER_TO = 24;

/** The gated bear, and the one step it is committed to before the gate shuts. */
const GATED_COL = 6;
const STEP: Facing = "left";
const HELD_COL = GATED_COL - 1;

/** The bear left to route for itself. */
const ROUTING_COL = 34;

/** The game time the strait is run for, in seconds: the item's figure. */
const SECTION_SECONDS = 3;

/** How far into that section the critter is moved, in seconds. */
const MOVE_AT_SECONDS = 1.5;

/**
 * How far the gated bear's center may sit from the tile center it settled on, as
 * `assertCloseTo` digits.
 *
 * Six digits is half a millionth of a stage unit. `specs/hunter.md` settles a
 * bear "exactly on that center" for the tick its travel would carry it past, so
 * a build that stopped there is out only by the arithmetic of adding a tick's
 * travel; a build still travelling is out by whole tiles.
 */
const CENTRE_DIGITS = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("holds a gated bear on the tile its step finished on while the bear beside it keeps stepping", async () => {
  await startCrossing(h, LEVEL);
  await h.debug.setCritterTile(CRITTER_FROM, ROW);

  // The gated bear keeps its sense and its travel: the requirement is that it
  // takes no NEW step, and both halves of that sentence need the other two
  // faculties running.
  const gated = await poseBear(h, GATED_COL, ROW, { routing: false });
  await h.debug.setBearStep(gated, STEP);
  const routing = await poseBear(h, ROUTING_COL, ROW);

  const posed = await h.snapshot();
  assertEqual(
    requireBear(posed, gated, "the gated bear").routing,
    false,
    `snapshot() bear ${gated}.routing after setBearRouting(${gated}, false), ` +
      `which the snapshot reports (specs/instrumentation.md)`,
  );
  assertEqual(
    requireBear(posed, routing, "the routing bear").routing,
    true,
    `snapshot() bear ${routing}.routing, which addBear leaves on ` +
      `(specs/instrumentation.md)`,
  );

  const read = await captureReplay(h, "gate", async () => {
    await h.advance(ticksFor(MOVE_AT_SECONDS));
    await h.debug.setCritterTile(CRITTER_TO, ROW);
    await h.advance(ticksFor(SECTION_SECONDS - MOVE_AT_SECONDS));
    return h.snapshot();
  });

  const held = requireBear(read, gated, "the gated bear after the section");
  assertEqual(
    `${held.col},${held.row}`,
    `${HELD_COL},${ROW}`,
    `the tile bear ${gated} is settled on after ${SECTION_SECONDS} s with its ` +
      `routing off — it finishes the step setBearStep(${gated}, "${STEP}") ` +
      `committed it to, onto (${HELD_COL}, ${ROW}), and then holds that tile ` +
      `(specs/instrumentation.md)`,
  );
  assertEqual(
    `${held.stepCol},${held.stepRow}`,
    `${HELD_COL},${ROW}`,
    `the tile bear ${gated} is travelling into at the end of the section — a ` +
      `settled bear reports its own tile (specs/instrumentation.md), and a ` +
      `bear that had taken a new step decision would report a neighbour`,
  );
  assertCloseTo(
    held.x,
    tileCX(HELD_COL),
    CENTRE_DIGITS,
    `the center x bear ${gated} holds, against the center of tile ` +
      `(${HELD_COL}, ${ROW})`,
  );
  assertCloseTo(
    held.y,
    tileCY(ROW),
    CENTRE_DIGITS,
    `the center y bear ${gated} holds, against the center of tile ` +
      `(${HELD_COL}, ${ROW})`,
  );
  assertEqual(
    `${held.target.col},${held.target.row}`,
    `${CRITTER_TO},${ROW}`,
    `the tile bear ${gated} hunts at the end of the section, after the critter ` +
      `moved — its sense still refreshes its target ` +
      `(specs/instrumentation.md)`,
  );

  const stepping = requireBear(read, routing, "the routing bear");
  assertNotEqual(
    `${stepping.col},${stepping.row}`,
    `${ROUTING_COL},${ROW}`,
    `the tile bear ${routing} is settled on after ${SECTION_SECONDS} s with ` +
      `its routing on, against the tile it was posed on — a bear that routes ` +
      `commits to a step on settling (specs/hunter.md)`,
  );
});
