// lives/a-saucer-bullet-costs-a-life — enemy fire that lands is lethal.
//
// THE RULE. `specs/collision.md` gives the pair "The ship and a saucer bullet" the
// resolution "The ship is destroyed and a life is lost, and the bullet is
// removed", and `specs/progression.md` names the saucer bullet as the third of the
// three lethal contacts. What is read here is the life alone; the bullet's removal
// belongs to `saucer/bullet-harms-only-the-ship`.
//
// AND THERE IS NO SAUCER ON THE FIELD. The round is placed in flight through
// `addEnemyBullet`, which puts one up "with a full `SAUCER_BULLET_LIFE`"
// (`specs/instrumentation.md`), so the only body that can reach the ship is the
// round itself. A check that flew a saucer in to fire the shot would have two
// lethal pairs on the field at once and could not say which of them took the ship
// — which is exactly the pair `the-saucer-costs-a-life` grades on its own.
//
// THE ROUND IS THE SAUCER'S OWN. It leaves at `SAUCER_BULLET_SPEED` (`300`), the
// speed `specs/saucer.md` fixes, and closes the `83` units past the `17` at which
// it and the ship touch (`SHIP_R + SAUCER_BULLET_R`) in a little over a quarter of
// a second — comfortably inside the `SAUCER_BULLET_LIFE` (`1.4` s) it would
// otherwise expire at, so a build that removed it on its timer rather than on the
// ship still had the contact to resolve. It is pulled by the well like any
// ballistic body, which over that quarter second moves it a fraction of a unit
// against a `17`-unit contact circle.
//
// EVERY WRONG MODEL READS AS A DIFFERENT NUMBER, on the same terms as
// `a-rock-costs-a-life`.

import { afterEach, beforeEach, it } from "vitest";
import { SAUCER_BULLET_R, SAUCER_BULLET_SPEED, SHIP_R } from "../constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  poseEnemyBullet,
  startPlaying,
  type Harness,
} from "../harness";
import {
  APPROACH_GAP,
  DEATH_SPOT,
  contactNeeded,
  untilLifeLost,
} from "./scene";

/** The separation at which the ship and a saucer bullet touch (`specs/collision.md`). */
const TOUCHING = SHIP_R + SAUCER_BULLET_R;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("drops the ship count by exactly one when an enemy round reaches the ship", async () => {
  startPlaying(h);
  const before = h.snapshot().lives;

  h.debug.setShipPosition(DEATH_SPOT.x, DEATH_SPOT.y);
  h.debug.setShipVelocity(0, 0);
  h.debug.setShipInvuln(0);
  // The gate this whole group turns on: the contact test IS the requirement.
  h.debug.setShipCollision(true);
  poseEnemyBullet(
    h,
    DEATH_SPOT.x - APPROACH_GAP,
    DEATH_SPOT.y,
    SAUCER_BULLET_SPEED,
    0,
  );

  const lost = await untilLifeLost(h, before);
  captureStill(h, "contact");

  assertEqual(
    lost.hit,
    true,
    contactNeeded(
      "one saucer bullet",
      APPROACH_GAP,
      TOUCHING,
      SAUCER_BULLET_SPEED,
    ),
  );
  assertEqual(
    lost.snapshot.lives,
    before - 1,
    `the ships left after a saucer bullet reached the ship, from the ${before} ` +
      `it stood at — the ship and a saucer bullet destroys the ship and costs ` +
      `one life (specs/collision.md, specs/progression.md)`,
  );
});
