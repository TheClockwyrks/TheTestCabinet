// progression/no-life-lost-during-ready — the ready hold costs no further life.
//
// specs/progression.md, of the ready hold: "Nothing costs a further life during
// the hold." The lines around it say why — "The ship is off the field for the
// hold: it is not drawn, it answers to no input, and it fires nothing.
// `specs/instrumentation.md` reports it as not alive."
//
// SO THE MEASUREMENT IS THE SECOND EVENT. A life is lost, and then, while the
// hold is still running, a second enemy bullet of the same lethal band is dropped
// down the ship's lane and followed until it has been through it. The count is
// read against the count THE FIRST LOSS LEFT, not against `START_LIVES`, so a
// build that mispriced the first hit fails `progression.bullet-costs-life` and is
// still graded here on the only thing this point is about: whether the hold is
// safe.
//
// THE SECOND BULLET IS REAL, NOT POSED, and its band is the one the hull does not
// take (specs/bands.md), so it is a bullet that WOULD cost a life outside the
// hold. That is what makes the reading a reading: a same-band bullet costs
// nothing at any time and would pass on every build.
//
// THE READING IS TAKEN INSIDE THE HOLD, and the check proves it rather than
// assuming it: the phase is read back on the frame the second bullet cleared the
// lane, and is required to still be `ready`. The arithmetic is comfortable — the
// second bullet's whole fall is `0.47` s at the stage-1 enemy speed against a
// `READY_HOLD` of `1.3` s — but a build whose hold is short would otherwise be
// graded on a bullet that arrived after the ship was back.
//
// THE FIELD HOLDS NOTHING ELSE: no drone, no third bullet, and the wave's own
// entry and dive launching are shut, so nothing but the bullet under test could
// move the count in this window.

import { afterEach, beforeEach, it } from "vitest";
import {
  ENEMY_BULLET_HALF,
  ENEMY_BULLET_SPEED,
  FIELD_BOTTOM,
  READY_HOLD,
  SHIP_HALF,
  SHIP_Y,
  START_LIVES,
  bulletSpeedScale,
} from "../../src/constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  findBullet,
  seconds,
  startPosed,
  ticksFor,
  type Harness,
} from "../harness";
import { poseEnemyBulletAbove } from "./lives";

/** The band the ship holds, and the opposite one both bullets carry. */
const SHIP_BAND = "cyan" as const;
const BULLET_BAND = "magenta" as const;

/** How far above the ship's centre each bullet starts, in logical units. */
const DROP_ABOVE = 120;

/** How close two centres come for the circles to overlap (specs/simulation.md). */
const TOUCHING = SHIP_HALF + ENEMY_BULLET_HALF;

/**
 * How far BELOW the ship's centre the second bullet is followed, in logical
 * units.
 *
 * Past the hull's contact reach against an enemy bullet — `SHIP_HALF` (`15`) plus
 * `ENEMY_BULLET_HALF` (`8`), 23 units — with room to spare, so a bullet still in
 * flight at this depth has been through the lane and out the other side and the
 * hold has had every chance to charge for it.
 */
const PAST_HULL = 30;

/** The speed an enemy bullet falls at on stage 1 (specs/stages.md). */
const FALL_SPEED = ENEMY_BULLET_SPEED * bulletSpeedScale(1);

/** Frames the first fall is given to open the hold: geometry, plus two of slack. */
const FALL_TICKS = ticksFor(DROP_ABOVE / FALL_SPEED) + 2;

/**
 * Frames the second bullet is followed for.
 *
 * The time to fall `DROP_ABOVE + PAST_HULL` at `FALL_SPEED` — geometry, not a
 * tolerance — plus two frames for the frame it is placed on. That is `0.49` s,
 * comfortably inside the `READY_HOLD` (`1.3` s) it has to happen within even
 * after the first fall's own frames, and it leaves the bullet no lower than
 * `y = 637`, above `FIELD_BOTTOM` (`656`), so it cannot leave the roster by
 * falling off the field (specs/field.md).
 */
const PASS_TICKS = ticksFor((DROP_ABOVE + PAST_HULL) / FALL_SPEED) + 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("costs no further life when a bullet reaches the ship's lane during the hold", async () => {
  startPosed(h);
  // The one world gate both halves of this scenario rest on: without a contact
  // test no life is lost, no hold opens, and the second bullet proves nothing.
  h.debug.setShipContact(true);
  h.debug.setShipBand(SHIP_BAND);
  h.debug.setLives(START_LIVES);

  const posed = h.snapshot();
  assertEqual(posed.lives, START_LIVES, "the lives the run was posed with");
  assertEqual(
    posed.phase,
    "live",
    "the phase the wave was posed in, before any life was lost",
  );

  poseEnemyBulletAbove(h, BULLET_BAND, DROP_ABOVE);
  const opened = await h.until((s) => s.phase === "ready", {
    maxFrames: FALL_TICKS,
  });
  assertEqual(
    opened.hit,
    true,
    `losing a life to the first ${BULLET_BAND} bullet, dropped ` +
      `${DROP_ABOVE} units above a ${SHIP_BAND} ship, putting the wave into ` +
      `its ready phase inside ${FALL_TICKS} frames ` +
      `(${seconds(FALL_TICKS)} s) at ENEMY_BULLET_SPEED ` +
      `${ENEMY_BULLET_SPEED} (specs/progression.md)`,
  );
  // What the FIRST loss left. The second event is measured against this, so this
  // point grades the hold rather than the price of the hit that opened it.
  const held = opened.snapshot.lives;

  const second = poseEnemyBulletAbove(h, BULLET_BAND, DROP_ABOVE);
  const passed = await h.until(
    (s) => {
      const inFlight = findBullet(s, second);
      return inFlight === null || inFlight.y > SHIP_Y + PAST_HULL;
    },
    { maxFrames: PASS_TICKS },
  );
  captureStill(h, "safe");

  assertEqual(
    passed.hit,
    true,
    `the second ${BULLET_BAND} bullet reaching the ship's lane — taken, or ` +
      `${PAST_HULL} units past the hull's ${TOUCHING}-unit contact reach — ` +
      `inside ${PASS_TICKS} frames (${seconds(PASS_TICKS)} s), which leaves ` +
      `it above FIELD_BOTTOM ${FIELD_BOTTOM} so it cannot have left the field`,
  );
  assertEqual(
    passed.snapshot.phase,
    "ready",
    "the phase the reading was taken in: the second bullet's whole fall is " +
      `${seconds(PASS_TICKS)} s against a READY_HOLD of ${READY_HOLD} s, so ` +
      "it lands inside the hold (specs/progression.md)",
  );
  assertEqual(
    passed.snapshot.lives,
    held,
    `the lives after a second ${BULLET_BAND} bullet reached the ship's lane ` +
      `during the ready hold, from the ${held} the first hit left — ` +
      "specs/progression.md: nothing costs a further life during the hold. " +
      `${held - 1} is a build whose hull is still live while the ship is off ` +
      "the field",
  );
});
