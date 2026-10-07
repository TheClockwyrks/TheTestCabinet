// ship/bullet-travels-up — one of the player's bullets climbs at
// `PLAYER_BULLET_SPEED`.
//
// specs/ship.md, "Firing": a shot "travels straight up at `PLAYER_BULLET_SPEED`
// (`760`) units per second". The review item states the reading as a rate: the
// bullet's centre rises `PLAYER_BULLET_SPEED` units in a second of game time, within
// 5%.
//
// THE SPAN IS HALF A SECOND, NOT A WHOLE ONE, and it has to be. specs/field.md
// removes a player bullet "whose center climbs above `FIELD_TOP`", and the play
// field is only `FIELD_BOTTOM - FIELD_TOP` (592) units tall, so no bullet anywhere
// on the stage can be watched climbing for the 760 units a full second would carry
// it: the measurement would end with the bullet off the roster whatever the build
// did. What is under test is a RATE, so half a second of it against half the stated
// distance is the same requirement at the same relative tolerance — the item's 5%,
// which is 19 units over this span. Even a build 5% fast ends the span 251 units
// clear of `FIELD_TOP`, so nothing is removed mid-reading and no part of this is
// secretly a check on the field's edge, which is `field/player-bullet-leaves-field`.
//
// THE BULLET IS POSED RATHER THAN FIRED. `addPlayerBullet` adds "one of the player's
// bullets in flight … traveling straight up at `PLAYER_BULLET_SPEED`"
// (specs/instrumentation.md), so a posed bullet is under exactly the rule this point
// decides, and placing it at the bottom of the play field is what buys the span its
// room. Firing one instead would start it wherever the build's own nose is and make
// this point fail for a build whose spawn point is wrong — which is
// `ship/bullet-spawn-point`'s to charge, once.
//
// THE START IS READ, NOT ASSUMED. The rise is measured between two readings of the
// same bullet's own `y`, so nothing here depends on the pose landing the bullet at
// exactly the requested point: only on how far it travelled between them.
//
// THE WORLD IS EMPTY AND QUIET. `startPosed` clears the four rosters and shuts the
// wave's entry gate, its dive gate and the ship's contact test, so there is no drone
// for the bullet to be consumed by on its way up (specs/bands.md) and nothing else
// on the field at all.

import { afterEach, beforeEach, it } from "vitest";
import {
  FIELD_BOTTOM,
  FIELD_TOP,
  PLAYER_BULLET_HALF,
  PLAYER_BULLET_SPEED,
} from "../constants";
import { assertBetween, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  LANE_CENTER,
  posePlayerBullet,
  startPosed,
  ticksFor,
  type Harness,
} from "../harness";
import { bulletOnRoster } from "./cannon";

/** The review item's tolerance on the climb: within 5% of the stated speed. */
const SPEED_TOLERANCE = 0.05;

/**
 * The span the climb is measured over, in seconds and in frames.
 *
 * Half a second, because a whole one cannot be watched inside a play field 592
 * units tall — see the note above. The requirement is a rate, so the same relative
 * tolerance decides it over this span as over a second.
 */
const SPAN_SECONDS = 0.5;
const SPAN_FRAMES = ticksFor(SPAN_SECONDS);

/** The rise the span must carry the bullet, before the tolerance. */
const EXPECTED_RISE = PLAYER_BULLET_SPEED * SPAN_SECONDS;

/**
 * Where the bullet starts: the bottom of the play field, its own half-extent
 * inside it.
 *
 * The lowest point on the stage a bullet can be posed and still be in the field,
 * which is what gives the span its room: `FIELD_BOTTOM - FIELD_TOP` (592) units of
 * climb are available, and even a build 5% fast uses only 399 of them.
 */
const START_Y = FIELD_BOTTOM - PLAYER_BULLET_HALF;

/** The band the posed bullet carries. Immaterial here: no drone is on the field. */
const BAND = "cyan";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("raises the bullet's centre PLAYER_BULLET_SPEED units per second", async () => {
  startPosed(h);
  const id = posePlayerBullet(h, LANE_CENTER, START_Y, BAND);

  const before = bulletOnRoster(
    h.snapshot(),
    id,
    "before the climb was measured",
  );
  assertEqual(
    before.friendly,
    true,
    "the posed bullet is one of the PLAYER's, which is what climbs " +
      "(specs/instrumentation.md)",
  );

  await h.advance(SPAN_FRAMES);
  // Before the assertion, so a check that fails still leaves the picture of where
  // the climb carried the bullet.
  captureStill(h, "climb");

  const after = bulletOnRoster(
    h.snapshot(),
    id,
    `after ${String(SPAN_SECONDS)}s of climbing from ${String(START_Y)}, which ` +
      `leaves it ${String(START_Y - EXPECTED_RISE - FIELD_TOP)} units clear of ` +
      "FIELD_TOP",
  );

  assertBetween(
    before.y - after.y,
    EXPECTED_RISE * (1 - SPEED_TOLERANCE),
    EXPECTED_RISE * (1 + SPEED_TOLERANCE),
    `the units the bullet's centre rose over ${String(SPAN_SECONDS)}s of game ` +
      `time, PLAYER_BULLET_SPEED (${String(PLAYER_BULLET_SPEED)}) for a second ` +
      `within ${String(SPEED_TOLERANCE * 100)}% (specs/ship.md)`,
  );
});
