// scoring/glitch-bounty — destroying a glitch pays SCORE_GLITCH.
//
// specs/scoring.md: "A glitch is destroyed" pays `SCORE_GLITCH` (`300`), against
// `SCORE_DROPPER` (`200`) and `SCORE_CORRUPTOR` (`1000`) for the other two foes,
// and "a foe's bounty is paid on the bolt that destroys it". A glitch takes one
// bolt (specs/foes.md), so the single shot below is the whole event and every
// wrong model reads as a different number: paying another foe's bounty reads `200`
// or `1000`, and paying nothing reads `0`.
//
// THE GLITCH STANDS STILL AND THINKS ABOUT NOTHING. Both faculties are off, so
// specs/instrumentation.md leaves its travel and its mind alike shut: its travel
// would carry it out of the bolt's column at `GLITCH_H_SPEED` and down the board
// at `GLITCH_V_SPEED`, and its mind is the darting and the eating. Neither has
// anything to do with what its death pays, so the foe is on the tile the pose put
// it on when the bolt arrives and the shot is the only thing in the scenario.
//
// WHAT THIS DOES NOT DECIDE. That one bolt is enough to destroy a glitch is
// `foes.glitch-takes-one`'s requirement. This point reads the score alone.

import { afterEach, beforeEach, it } from "vitest";
import { BOLT_SPEED, FOE_HALF, SCORE_GLITCH, TILE } from "../../src/constants";
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
 * The tile the glitch is centred on.
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

it("pays exactly SCORE_GLITCH for a glitch a bolt destroys", async () => {
  startPlaying(h);
  const glitch = poseFoe(h, "glitch", FOE_C, FOE_R);
  h.debug.setFoeTravel(glitch, false);
  h.debug.setFoeMind(glitch, false);

  const before = h.snapshot().score;
  poseBolt(h, FOE_C, FOE_R + BOLT_DROP_TILES);

  await h.until((s) => s.bolts.length === 0, { maxFrames: BOLT_TICKS });
  captureStill(h, "scored");

  assertEqual(
    h.snapshot().score - before,
    SCORE_GLITCH,
    "the score the glitch's death added",
  );
});
