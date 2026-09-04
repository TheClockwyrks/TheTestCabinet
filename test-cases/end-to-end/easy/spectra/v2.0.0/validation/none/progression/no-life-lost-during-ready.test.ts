// progression/no-life-lost-during-ready — the ready hold costs no further life.
//
// `specs/progression.md`, of the ready hold: "Nothing costs a further life during
// the hold." The lines around it say why — "The ship is off the field for the
// hold: it is not drawn, it answers to no input, and it fires nothing.
// `specs/instrumentation.md` reports it as not alive."
//
// SO THE MEASUREMENT IS THE SECOND EVENT. A life is lost, and then, while the
// hold is still running, a second enemy bullet of the same lethal band is dropped
// down the ship's lane and followed until it has been through it. The count is
// read against the count the FIRST loss left, not against `START_LIVES`, so a
// build that mispriced the first hit fails `progression/bullet-costs-life` and is
// still graded here on the only thing this item is about: whether the hold is
// safe.
//
// THE SECOND BULLET IS REAL, NOT POSED, and its band is the one the hull does not
// take (`specs/bands.md`), so it is a bullet that WOULD cost a life outside the
// hold. That is what makes the reading a reading: a same-band bullet costs
// nothing at any time and would pass on every build.
//
// THE READING IS TAKEN INSIDE THE HOLD, and the check proves it rather than
// assuming it: the phase is read back on the frame the second bullet cleared the
// lane, and is required to still be `ready`. The arithmetic is comfortable —
// `READY_HOLD` is `1.3 s` and the second bullet's whole fall is under half of
// that at the stage-1 enemy speed — but a build whose hold is short would
// otherwise be graded on a bullet that arrived after the ship was back.
//
// THE FIELD HOLDS NOTHING ELSE: no drone, no third bullet, and the wave's own
// entry and dive launching are shut, so nothing but the bullet under test could
// move the count in this window.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  ENEMY_BULLET_SPEED,
  SHIP_Y,
  START_LIVES,
  bulletSpeedScale,
  opposite,
} from "../constants";
import {
  bulletById,
  captureStill,
  createHarness,
  framesFor,
  startPosed,
  type Harness,
} from "../harness";
import { poseEnemyBulletAbove } from "./lives";

/** How far above the ship's centre each bullet starts, in logical units. */
const DROP_ABOVE = 120;

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

/** The speed an enemy bullet falls at on stage 1 (`specs/stages.md`). */
const FALL_SPEED = ENEMY_BULLET_SPEED * bulletSpeedScale(1);

/** Frames the first fall is given to open the hold: geometry, plus two of slack. */
const FALL_FRAMES = framesFor(DROP_ABOVE / FALL_SPEED) + 2;

/**
 * Frames the second bullet is followed for.
 *
 * The time to fall `DROP_ABOVE + PAST_HULL` at `FALL_SPEED` — geometry, not a
 * tolerance — plus two frames for the frame it is placed on. That is `0.49 s`,
 * comfortably inside the `READY_HOLD` (`1.3 s`) it has to happen within, and it
 * leaves the bullet no lower than `y = 637`, above `FIELD_BOTTOM` (`656`), so it
 * cannot leave the roster by falling off the field (`specs/field.md`).
 */
const PASS_FRAMES = framesFor((DROP_ABOVE + PAST_HULL) / FALL_SPEED) + 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("costs no further life when a bullet reaches the ship's lane during the hold", async () => {
  await startPosed(h);
  // The one world gate both halves of this scenario rest on: without a contact
  // test no life is lost, no hold opens, and the second bullet would prove
  // nothing.
  await h.debug.setShipContact(true);
  const posed = await h.snapshot();
  assertEqual(posed.lives, START_LIVES, "the lives the run was posed with");

  const band = opposite(posed.ship.band);
  await poseEnemyBulletAbove(h, band, DROP_ABOVE);
  const opened = await h.until((s) => s.phase === "ready", {
    maxFrames: FALL_FRAMES,
  });
  assertEqual(
    opened.hit,
    true,
    `losing a life to the first ${band} bullet putting the wave into its ready ` +
      `phase, inside the ${String(FALL_FRAMES)} frames the fall takes ` +
      "(specs/progression.md)",
  );
  // What the FIRST loss left. The second event is measured against this, so this
  // item grades the hold rather than the price of the hit that opened it.
  const held = opened.snapshot.lives;

  const second = await poseEnemyBulletAbove(h, band, DROP_ABOVE);
  const passed = await h.until(
    (s) => {
      const inFlight = bulletById(s, second);
      return inFlight === undefined || inFlight.y > SHIP_Y + PAST_HULL;
    },
    { maxFrames: PASS_FRAMES },
  );
  await captureStill(h, "safe");

  assertEqual(
    passed.hit,
    true,
    `the second ${band} bullet reaching the ship's lane — taken, or past it — ` +
      `inside the ${String(PASS_FRAMES)} frames its fall takes`,
  );
  assertEqual(
    passed.snapshot.phase,
    "ready",
    "the phase the reading was taken in: the second bullet's whole fall is " +
      "under half of READY_HOLD (1.3 s), so it lands inside the hold " +
      "(specs/progression.md)",
  );
  assertEqual(
    passed.snapshot.lives,
    held,
    `the lives left after a second ${band} bullet reached the ship's lane ` +
      `during the ready hold, from the ${String(held)} the first hit left — ` +
      "nothing costs a further life during the hold (specs/progression.md)",
  );
});
