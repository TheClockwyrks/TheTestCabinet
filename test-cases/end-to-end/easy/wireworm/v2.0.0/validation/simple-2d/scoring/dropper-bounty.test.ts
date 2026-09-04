// scoring/dropper-bounty — destroying a dropper pays SCORE_DROPPER, once.
//
// specs/scoring.md: "A dropper is destroyed" pays `SCORE_DROPPER` (`200`), and "a
// foe's bounty is paid on the bolt that destroys it, so the first bolt into a
// dropper pays nothing and the second pays `SCORE_DROPPER`". A dropper takes two
// bolts (specs/foes.md), so the whole event is the pair of shots below and what
// this point reads is what the run's score is worth once the dropper is gone.
// Every wrong model reads as a different number: paying the bounty on each bolt
// reads `400`, paying another foe's bounty reads `300` or `1000`, and paying
// nothing reads `0`.
//
// THE DROPPER STANDS STILL AND THINKS ABOUT NOTHING. Both faculties are off, so
// specs/instrumentation.md leaves its travel and its mind alike shut: its travel
// would carry it out of the bolt's column at `DROPPER_SPEED`, and faster still
// once the first bolt has landed, since a struck dropper falls at
// `DROPPER_SPEED_HIT`; its mind is the node it lays on the tile beneath it, which
// a later bolt could score. Neither has anything to do with what its death pays,
// so the foe is on the tile the pose put it on for both shots and the pair is the
// only thing in the scenario.
//
// EACH BOLT IS POSED AND FLOWN TO ITS RESOLUTION IN TURN, rather than both at
// once, so the second one strikes a dropper that has already taken the first —
// which is the ordering the figure is written against.
//
// WHAT THIS DOES NOT DECIDE. That the first bolt only sets the hit flag and the
// second is what destroys it is `foes.dropper-takes-two`'s requirement, and that a
// struck dropper falls faster is `foes.dropper-speeds-up`'s. This point reads the
// score alone.

import { afterEach, beforeEach, it } from "vitest";
import { BOLT_SPEED, FOE_HALF, SCORE_DROPPER, TILE } from "../constants";
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
 * The tile the dropper is centred on.
 *
 * Row 10 is in the open middle of the board: clear of the entry row `0` and of the
 * player band, rows `18` and `19` (specs/board.md), so the shots are decided by
 * the foe alone.
 */
const FOE_C = 20;
const FOE_R = 10;

/** How many bolts a dropper takes to destroy (specs/foes.md). */
const BOLTS_TO_KILL = 2;

/** How far below the foe each bolt is posed, in tiles. */
const BOLT_DROP_TILES = 4;

/**
 * How long each bolt is given to reach the foe, in frames.
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

it("pays exactly SCORE_DROPPER across the two bolts a dropper takes", async () => {
  startPlaying(h);
  const dropper = poseFoe(h, "dropper", FOE_C, FOE_R);
  h.debug.setFoeTravel(dropper, false);
  h.debug.setFoeMind(dropper, false);

  const before = h.snapshot().score;
  for (let shot = 0; shot < BOLTS_TO_KILL; shot += 1) {
    poseBolt(h, FOE_C, FOE_R + BOLT_DROP_TILES);
    await h.until((s) => s.bolts.length === 0, { maxFrames: BOLT_TICKS });
  }
  captureStill(h, "scored");

  assertEqual(
    h.snapshot().score - before,
    SCORE_DROPPER,
    `the score the dropper's ${BOLTS_TO_KILL} bolts added between them`,
  );
});
