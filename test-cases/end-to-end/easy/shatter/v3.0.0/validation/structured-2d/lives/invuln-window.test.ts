// lives/invuln-window — the ship a death puts up opens with 2.5 seconds of grace.
//
// THE RULE. `specs/progression.md`: the next ship appears "with `INVULN_TIME`
// (`2.5` seconds) of respawn grace". This item decides the OPENING VALUE alone.
// That the value then falls with game time is `lives/invuln-counts-down`, that
// the ship inside it ignores a rock is `lives/invuln-ignores-a-rock`, and that
// contact resumes when it runs out is `lives/invuln-ends`, so a build that opens
// the window at the wrong figure but honours it correctly loses one point.
//
// WHERE IT IS READ. As the MOST grace the ship was seen carrying over the
// quarter second after the counter fell. A window that opens at some tick in
// there and counts down from there stands at its opening value on that tick, so
// the largest reading is that opening value — which is what makes this item the
// OPENING figure's rather than a second reading of the descent
// `lives/invuln-counts-down` decides. It also costs a build nothing for settling
// its respawn a frame or two after the loss: whichever tick the window opened
// on is the tick this reads.
//
// That a ship was put up at all is required first, because a grace without a
// ship is not a respawn: `duel.ts` kills the ship 481 units from the safe point,
// so the ship found there cannot be the one that died.
//
// THE GRACE IS POSED AT ZERO BEFORE THE DEATH, and the check asserts it, because
// a ship that already carried grace would not have died at all — and a reading
// of `INVULN_TIME` on a build that simply never touches the timer would be the
// pose's own value rather than the respawn's.
//
// The tolerance is one tick of game time (`TICK_DT`, 1/120 s). The order in
// which a build runs its timers inside a tick is its own — a build that counts
// the grace down before it resolves the contact reads `INVULN_TIME`, one that
// counts down after reads a tick less — and `specs/simulation.md` fixes the
// timestep rather than the order of two independent steps within it, so both
// pass and a build that opened the window at 2 seconds or at 3 does not.

import { afterEach, beforeEach, it } from "vitest";
import {
  INVULN_TIME,
  SAFE_X,
  SAFE_Y,
  START_LIVES,
  TICK_DT,
} from "../../src/constants";
import { assertBetween, assertEqual, assertTrue } from "../assert";
import { type Vec } from "../geometry";
import {
  captureStill,
  createHarness,
  ticksFor,
  type Harness,
} from "../harness";
import {
  poseLosingDuel,
  requireRespawnedShip,
  watchForRespawn,
  watchTheDeath,
} from "./duel";

/** The place `specs/progression.md` fixes for the ship a death puts up. */
const SAFE: Vec = { x: SAFE_X, y: SAFE_Y };

/** How far the opening grace may sit from `INVULN_TIME`, in seconds. */
const OPENING_TOLERANCE = TICK_DT;

/** The ceiling on the drive to the death: see `duel.ts`. */
const DEATH_TICKS = ticksFor(0.5);

/**
 * How long the ship is watched for after the counter falls.
 *
 * Short on purpose. The grace counts down with game time, so every tick between
 * the loss and the reading is a tick off the value read — a quarter second is
 * the slack a build that settles its respawn a frame later needs, and no more.
 */
const RESPAWN_TICKS = ticksFor(0.25);

/** How near the safe point counts as "a ship appeared there" for the watch. */
const RESPAWN_MARK = 60;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("opens the respawn grace at INVULN_TIME", async () => {
  const rockId = poseLosingDuel(h);

  const armed = h.snapshot();
  assertEqual(
    armed.ship.invuln,
    0,
    "the doomed ship carrying no grace, so the window read below is one the " +
      "respawn opened (specs/instrumentation.md)",
  );

  const death = await watchTheDeath(h, rockId, DEATH_TICKS);
  assertTrue(
    death.lostAt >= 0,
    "the rock reaching the ship to cost a life (specs/collision.md)",
  );
  assertEqual(
    death.end.lives,
    START_LIVES - 1,
    "ships still remaining after the loss, which is the case " +
      "specs/progression.md puts a new ship up in",
  );

  const respawn = await watchForRespawn(h, SAFE, RESPAWN_MARK, RESPAWN_TICKS);
  captureStill(h, "grace");

  requireRespawnedShip(respawn);
  assertBetween(
    respawn.mostGrace,
    INVULN_TIME - OPENING_TOLERANCE,
    INVULN_TIME + OPENING_TOLERANCE,
    "the grace the next ship appeared with, read as the most it carried " +
      "after the loss, within a tick of INVULN_TIME (2.5 s) " +
      "(specs/progression.md)",
  );
});
