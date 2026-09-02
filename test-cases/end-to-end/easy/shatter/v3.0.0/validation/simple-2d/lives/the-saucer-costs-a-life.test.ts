// lives/the-saucer-costs-a-life — the saucer's own hull is lethal to the ship.
//
// THE RULE. `specs/collision.md` gives the pair "The ship and the saucer" the
// resolution "The ship is destroyed and a life is lost", and
// `specs/progression.md` names the saucer as one of the three lethal contacts. It
// is a different pair from the one the saucer's GUN makes, and it is graded
// separately here so a build that kills the ship with saucer fire but flies its
// saucer straight through the ship loses this point and keeps
// `a-saucer-bullet-costs-a-life`.
//
// SO THE SAUCER ARRIVES WITH ITS GUN SHUT. `setSaucerGun(false)` gates the aimed
// shot alone (`specs/instrumentation.md`), which is what makes the reading
// attributable: with the gun open, a saucer that fires on its way in could take
// the ship with a bullet, and this item would pass on a build whose hull is
// harmless. Its mind is shut on the same terms, so the weave and the steering
// around the core cannot carry it off the line this check put it on; its travel is
// left running, because crossing the field into the ship is the whole scenario.
//
// THE APPROACH IS THE SAUCER'S OWN. It enters `APPROACH_GAP` to the ship's left
// travelling right at `SAUCER_SPEED` (`140`), which is the speed
// `specs/saucer.md` fixes for a crossing, and closes the `68` units past the `32`
// at which the pair touches (`SHIP_R + SAUCER_R`) in half a second. The well never
// pulls the saucer at all (`specs/gravity.md`), so the course is exactly the one
// posed.
//
// EVERY WRONG MODEL READS AS A DIFFERENT NUMBER, on the same terms as
// `a-rock-costs-a-life`: `3` for a saucer that passes through, `1` or `0` for a
// build that resolves the same overlap on tick after tick.

import { afterEach, beforeEach, it } from "vitest";
import { SAUCER_R, SAUCER_SPEED, SHIP_R } from "../../src/constants";
import { assertEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  poseSaucer,
  startPlaying,
  type Harness,
} from "../harness";
import {
  APPROACH_GAP,
  DEATH_SPOT,
  contactNeeded,
  untilLifeLost,
} from "./scene";

/** The separation at which the ship and the saucer touch (`specs/collision.md`). */
const TOUCHING = SHIP_R + SAUCER_R;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("drops the ship count by exactly one when the saucer reaches the ship", async () => {
  startPlaying(h);
  const before = h.snapshot().lives;

  h.debug.setShipPosition(DEATH_SPOT.x, DEATH_SPOT.y);
  h.debug.setShipVelocity(0, 0);
  h.debug.setShipInvuln(0);
  // The gate this whole group turns on: the contact test IS the requirement.
  h.debug.setShipCollision(true);
  poseSaucer(h, DEATH_SPOT.x - APPROACH_GAP, DEATH_SPOT.y);
  h.debug.setSaucerVelocity(SAUCER_SPEED, 0);
  h.debug.setSaucerMind(false);
  h.debug.setSaucerGun(false);

  const armed = h.snapshot();
  const lost = await untilLifeLost(h, before);
  captureStill(h, "contact");

  // THE HULL, NOT THE GUN. `setSaucerGun(false)` is asked for above; a build that
  // ignored it would take the ship with a bullet, and this item would pass on the
  // pair `a-saucer-bullet-costs-a-life` grades. Both the gate's own readback and an
  // empty enemy-bullet roster on the tick the life went are what make the hull the
  // only thing that reached the ship.
  assertEqual(
    armed.saucer?.gun,
    false,
    "the saucer's gun held on the approach, so the ship can only be taken by " +
      "its hull (specs/instrumentation.md: setSaucerGun)",
  );
  assertEqual(
    lost.hit,
    true,
    contactNeeded("the saucer", APPROACH_GAP, TOUCHING, SAUCER_SPEED),
  );
  assertEqual(
    lost.snapshot.lives,
    before - 1,
    `the ships left after the saucer reached the ship, from the ${before} it ` +
      `stood at — the ship and the saucer destroys the ship and costs one life ` +
      `(specs/collision.md, specs/progression.md)`,
  );
  assertLength(
    lost.snapshot.enemyBullets,
    0,
    "saucer bullets on the field on the tick the life went — with the gun " +
      "held there are none, so what reached the ship was the craft itself " +
      "(specs/collision.md: the ship and the saucer)",
  );
});
