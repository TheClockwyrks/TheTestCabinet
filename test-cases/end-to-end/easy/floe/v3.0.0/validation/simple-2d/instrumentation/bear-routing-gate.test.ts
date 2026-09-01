// instrumentation/bear-routing-gate — `setBearRouting(id, false)` gates that bear's
// choice of the next step and nothing else, so it finishes the step it is on and
// then holds that tile.
//
// specs/instrumentation.md fixes the gate: "Gates that bear's choice of the next
// step alone. Off, it takes no new step decision on settling: it finishes the step
// it is on and then holds that tile. Its sense still refreshes its target, and its
// travel still carries out a step `setBearStep` commits it to."
//
// SO THREE THINGS ARE READ, AND THEY FAIL INDEPENDENTLY:
//
//   1. THE COMMITTED STEP IS FINISHED. The gated bear is committed to one step with
//      `setBearStep` and must arrive on that tile — a build that gates the travel
//      along with the routing never leaves the tile it started on.
//   2. AND THEN IT HOLDS. Over the three seconds this item names it settles there
//      and chooses nothing else, so the tile it last settled on and the tile it is
//      travelling into are both that one. At `BEAR_ICE_SPEED` (`3` tiles a second,
//      specs/hunter.md) an ungated bear covers nine tiles in that span, so a build
//      that kept routing is nowhere near.
//   3. ITS SENSE STILL RUNS. The critter is moved during the drive and the gated
//      bear's target must follow it, which is what says the gate took the routing
//      alone.
//
// AND A SECOND BEAR, ROUTING ON, KEEPS STEPPING. It is posed on the same row and
// left with all three faculties, so the only difference between the two is the
// gate. It must settle somewhere other than the tile it started on: what this point
// asks of it is that it kept choosing, not how fast it travelled, which is
// `hunter/ice-speed`'s.
//
// THE STRAIT CARRIES NOTHING ELSE, so every neighbouring tile is open to both bears
// (specs/hunter.md) and neither can be held up by traffic it never asked for. The
// critter is posed and moved with the surface rather than hopped, because how it
// got there is `hopping/*`'s point.

import { afterEach, beforeEach, it } from "vitest";
import { tileCX, tileCY } from "../../src/constants";
import { assertCloseTo, assertEqual, assertNotEqual } from "../assert";
import {
  bearOf,
  captureReplay,
  createHarness,
  poseBear,
  startCrossing,
  ticksFor,
  type Facing,
  type Harness,
} from "../harness";

/** Where the critter starts, and the tile it is moved to mid-drive. */
const CRITTER_COL = 20;
const CRITTER_ROW = 15;
const MOVED_COL = 24;
const MOVED_ROW = 13;

/** The gated bear's tile, and the one step it is committed to. */
const GATED_COL = 8;
const GATED_ROW = 15;
const STEP: Facing = "right";
const STEP_COL = GATED_COL + 1;
const STEP_ROW = GATED_ROW;

/** The ungated bear's tile, on the same row and the far side of the critter. */
const ROUTING_COL = 34;
const ROUTING_ROW = 15;

/**
 * The span the two bears are watched over, in seconds: the three this item names.
 *
 * The critter is moved at the halfway mark, so the gated bear's target is read
 * after a change it could only have followed by sensing.
 */
const SPAN_SECONDS = 3;
const HALF_TICKS = ticksFor(SPAN_SECONDS / 2);

/**
 * How far the held bear's centre may sit from the centre of the tile its step
 * ended on, as `assertCloseTo` digits.
 *
 * Six digits is half a millionth of a stage unit. specs/hunter.md settles a bear
 * "exactly on that center" for the tick its travel would carry it past, so a
 * build that stopped there is out only by the arithmetic of adding a tick's
 * travel; a build still sliding is out by whole tiles. Without this reading a
 * build that pinned the tile it REPORTS while going on moving the centre would
 * pass, which is the failure the tile assertions alone cannot see.
 */
const CENTRE_DIGITS = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("holds a gated bear on the tile its committed step ended, and lets the other keep stepping", async () => {
  startCrossing(h);
  h.debug.setCritterTile(CRITTER_COL, CRITTER_ROW);

  // The gated bear keeps its sense and its travel: the requirement is that the
  // gate takes the choice of the next step and nothing else.
  const gated = poseBear(h, GATED_COL, GATED_ROW, { routing: false });
  h.debug.setBearStep(gated, STEP);
  const routing = poseBear(h, ROUTING_COL, ROUTING_ROW);

  // The pose, read back off the snapshot before anything is driven: every gate is
  // reported by `snapshot` (specs/instrumentation.md), and the read-back is what
  // makes the arrangement this point rests on a verifiable one.
  const posed = h.snapshot();
  assertEqual(
    bearOf(posed, gated).routing,
    false,
    `snapshot() bear ${gated}.routing after setBearRouting(${gated}, false), ` +
      `which the snapshot reports (specs/instrumentation.md)`,
  );
  assertEqual(
    bearOf(posed, routing).routing,
    true,
    `snapshot() bear ${routing}.routing, which addBear leaves on ` +
      `(specs/instrumentation.md)`,
  );

  const after = await captureReplay(h, "gate", async () => {
    await h.advance(HALF_TICKS);
    h.debug.setCritterTile(MOVED_COL, MOVED_ROW);
    await h.advance(HALF_TICKS);
    return h.snapshot();
  });

  const held = bearOf(after, gated);
  assertEqual(
    `${held.col},${held.row}`,
    `${STEP_COL},${STEP_ROW}`,
    `the tile the bear with setBearRouting(${gated}, false) last settled on ` +
      `after ${SPAN_SECONDS} s — it finishes the step setBearStep(${gated}, ` +
      `"${STEP}") committed it to and then holds that tile ` +
      `(specs/instrumentation.md)`,
  );
  assertEqual(
    `${held.stepCol},${held.stepRow}`,
    `${STEP_COL},${STEP_ROW}`,
    `the tile that same bear is travelling into — a bear settled on a tile ` +
      `reports the tile it is entering as the tile it is on, so a build that ` +
      `chose another step is named here`,
  );
  assertCloseTo(
    held.x,
    tileCX(STEP_COL),
    CENTRE_DIGITS,
    `the centre x that same bear holds, against the centre of tile ` +
      `(${STEP_COL}, ${STEP_ROW}) — a build that pinned the tile it reports ` +
      `while going on moving the centre is named here ` +
      `(specs/instrumentation.md)`,
  );
  assertCloseTo(
    held.y,
    tileCY(STEP_ROW),
    CENTRE_DIGITS,
    `the centre y that same bear holds, against the centre of tile ` +
      `(${STEP_COL}, ${STEP_ROW})`,
  );
  assertEqual(
    `${held.target.col},${held.target.row}`,
    `${MOVED_COL},${MOVED_ROW}`,
    `the tile that same bear hunts after the critter moved mid-drive — its sense ` +
      `still refreshes its target (specs/instrumentation.md)`,
  );

  const stepping = bearOf(after, routing);
  assertNotEqual(
    `${stepping.col},${stepping.row}`,
    `${ROUTING_COL},${ROUTING_ROW}`,
    `the tile the bear with its routing ON settled on over the same ` +
      `${SPAN_SECONDS} s, against the tile it was posed on — the gate is one ` +
      `bear's alone, and a bear that routes keeps stepping (specs/hunter.md)`,
  );
});
