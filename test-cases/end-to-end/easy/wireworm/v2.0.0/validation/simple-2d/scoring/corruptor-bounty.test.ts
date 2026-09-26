// scoring/corruptor-bounty — destroying a corruptor pays SCORE_CORRUPTOR.
//
// specs/scoring.md: "A corruptor is destroyed" pays `SCORE_CORRUPTOR` (`1000`),
// against `SCORE_GLITCH` (`300`) and `SCORE_DROPPER` (`200`) for the other two
// foes, and "a foe's bounty is paid on the bolt that destroys it". A corruptor
// takes one bolt (specs/foes.md), so the single shot below is the whole event and
// every wrong model reads as a different number: paying another foe's bounty reads
// `300` or `200`, and paying nothing reads `0`.
//
// THE CORRUPTOR STANDS STILL AND THINKS ABOUT NOTHING. Both faculties are off, so
// specs/instrumentation.md leaves its travel and its mind alike shut: its travel
// would carry it out of the bolt's column at `CORRUPTOR_SPEED`, and its mind is
// the slam that sets the node under it to critical. Neither has anything to do
// with what its death pays, so the foe is on the tile the pose put it on when the
// bolt arrives and the shot is the only thing in the scenario.
//
// THE TILE UNDER IT IS EMPTY, so even a build whose slam ran anyway lays nothing a
// later event could score: a corruptor "lays no node on an empty tile"
// (specs/foes.md).
//
// WHAT THIS DOES NOT DECIDE. That one bolt is enough to destroy a corruptor is
// `foes.corruptor-takes-one`'s requirement. This point reads the score alone.

import { afterEach, beforeEach, it } from "vitest";
import { BOLT_SPEED, FOE_HALF, SCORE_CORRUPTOR, TILE } from "../constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  poseBolt,
  poseFoe,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";

/**
 * The tile the corruptor is centred on.
 *
 * Row 10 is in the open middle of the board: clear of the entry row `0` and of the
 * player band, rows `18` and `19` (specs/board.md), so the shot is decided by the
 * foe alone.
 */
const FOE_C = 20;
const FOE_R = 10;

/** How far below the foe the bolt is posed, in tiles. */
const BOLT_DROP_TILES = 4;

/**
 * How long the bolt is given to reach the foe, in frames.
 *
 * specs/cursor.md has a bolt climb at `BOLT_SPEED` (`900` units per second) and
 * resolve against a foe when "the bolt's centre is inside the foe's box,
 * `FOE_HALF` (`12`) units from the foe's centre on each axis". Posed four tiles
 * below the foe's centre, the bolt's centre starts `128` units under it and so
 * `116` units under the box's lower edge, which is `0.129` s of flight. Twice that
 * is the budget, so a conforming build has ample room and a build whose bolt never
 * resolves still reaches a verdict rather than running the suite out.
 */
const BOLT_TICKS =
  2 * ticksFor((BOLT_DROP_TILES * TILE - FOE_HALF) / BOLT_SPEED);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("pays exactly SCORE_CORRUPTOR for a corruptor a bolt destroys", async () => {
  startPlaying(h);
  const corruptor = poseFoe(h, "corruptor", FOE_C, FOE_R);
  h.debug.setFoeTravel(corruptor, false);
  h.debug.setFoeMind(corruptor, false);

  const before = h.snapshot().score;
  poseBolt(h, FOE_C, FOE_R + BOLT_DROP_TILES);

  await h.until((s) => s.bolts.length === 0, { maxFrames: BOLT_TICKS });
  captureStill(h, "scored");

  assertEqual(
    h.snapshot().score - before,
    SCORE_CORRUPTOR,
    "the score the corruptor's death added",
  );
});
