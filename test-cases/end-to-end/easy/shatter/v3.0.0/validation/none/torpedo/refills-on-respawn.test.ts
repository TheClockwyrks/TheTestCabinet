// torpedo/refills-on-respawn — the next ship carries a full charge.
//
// specs/weapons.md, "The charge": "A respawn refills the charge to `1` and cancels
// any recharge in progress." specs/progression.md says what a respawn is: a ship is
// lost to one of the three lethal contacts specs/collision.md names, lives remain,
// and "the next ship appears at rest at the safe point ... with `INVULN_TIME`
// (`2.5` seconds) of respawn grace".
//
// THIS IS THE ONE CHECK IN THE GROUP THAT TURNS THE SHIP'S CONTACT GATE BACK ON,
// and it is the item whose requirement the gate is: no operation on the debug
// surface destroys a ship, so a respawn can only be reached by taking a real fatal
// contact, and against the harness default (`setShipCollision(false)`) there is no
// respawn to read at all. The gate is the whole of what is turned on; the wave loop
// and the saucer arrival stay shut, so the only thing on this field is the rock the
// scenario poses.
//
// THE CHARGE IS POSED PART FULL AND READ BACK BEFORE THE DEATH. `0.36` is the
// manifest's own figure and nothing in the specification fixes it — the rule is
// about the refill, not about where the recharge stood. Reading it back is what
// stops the check passing against a build whose `setTorpedoCharge` does nothing,
// which would enter the scenario already at `1` and satisfy the refill without
// performing one. `instrumentation/poses-read-back` is the item that GRADES the
// poses; this only refuses to grade a requirement against a world that was never
// arranged.
//
// AND THE REFILL IS NOWHERE NEAR WHAT THE RECHARGE COULD HAVE DONE. The scenario
// runs for under two seconds of game time from the pose, over which the linear
// refill specs/weapons.md fixes adds at most `0.2` to a charge of `0.36`. A build
// that never refills on respawn reads under half; the rule reads `1`.

import { afterEach, beforeEach, it } from "vitest";
import { assertLessThanOrEqual, fail } from "../assert";
import { ROCK_RADIUS, SHIP_R, START_LIVES } from "../constants";
import {
  captureStill,
  createHarness,
  poseRock,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { chargeOf, poseShip } from "./scene";

/**
 * Where the ship is posed to die: low and to the left, `468` units from the star.
 *
 * Clear of the star's whole drawn extent and of the safe point the respawn puts the
 * next ship at, so nothing about the scenario depends on where the wreck stood.
 */
const DEATH_SPOT = { x: 200, y: 620 } as const;

/** The charge the recharge is posed part way through, the manifest's own figure. */
const PART_CHARGE = 0.36;

/** How closely that pose must read back before the scenario is treated as arranged. */
const POSE_READBACK = 0.001;

/**
 * The separation at which the ship and a Small touch (`specs/collision.md`):
 * `SHIP_R` (`14`) plus `ROCK_RADIUS.small` (`14`).
 */
const TOUCHING = SHIP_R + ROCK_RADIUS.small;

/** How far above the ship the closing rock is posed, centre to centre. */
const APPROACH_GAP = 100;

/** The speed it closes at: inside the `130`–`210` a Small's own drift runs at. */
const CLOSING_SPEED = 200;

/** How long the contact and the respawn are watched for, in ticks. */
const WATCH_TICKS = ticksFor(1.5);

/** How long the build is given to put the next ship up once the life is lost. */
const SETTLE_TICKS = ticksFor(0.5);

/**
 * How far from `1` the refilled charge may read.
 *
 * Float slack, not room on the figure: specs/weapons.md refills to `1` exactly, and
 * the charge is capped there. A build that did not refill reads under `0.6`.
 */
const REFILL_SLACK = 1e-6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("refills the charge to full on the ship the respawn puts up", async () => {
  await startPlaying(h);
  await poseShip(h, { at: DEATH_SPOT });
  await h.debug.setShipInvuln(0);

  await h.debug.setTorpedoCharge(PART_CHARGE);
  const posed = await h.snapshot();
  const stood = chargeOf(posed, "the recharge posed part way through");
  if (Math.abs(stood - PART_CHARGE) > POSE_READBACK) {
    fail(
      `a recharge posed at ${PART_CHARGE} for the respawn to refill ` +
        "(specs/instrumentation.md: setTorpedoCharge sets the stored charge)",
      `the build reported a charge of ${stood}`,
    );
  }

  // The one gate this group turns on, and the rock that closes on the ship.
  await h.debug.setShipCollision(true);
  await poseRock(
    h,
    "small",
    DEATH_SPOT.x,
    DEATH_SPOT.y - APPROACH_GAP,
    0,
    CLOSING_SPEED,
  );

  const lost = await h.until(
    (snapshot) => snapshot.lives < START_LIVES && snapshot.ship.invuln > 0,
    { maxTicks: WATCH_TICKS, poll: 1 },
  );
  if (!lost.hit) {
    fail(
      `the ship destroyed and the next one put up inside 1.5 s of game time, ` +
        `by a Small closing the ${APPROACH_GAP - TOUCHING} units from ` +
        `${APPROACH_GAP} down to the ${TOUCHING} at which the pair touches, at ` +
        `${CLOSING_SPEED} units per second (specs/collision.md, ` +
        `specs/progression.md)`,
      `lives read ${lost.snapshot.lives} and the ship's grace ${lost.snapshot.ship.invuln}`,
    );
  }

  // The rock goes through `clearRocks`, which destroys nothing and scores
  // nothing, so the respawned ship is read on an empty field.
  await h.debug.clearRocks();
  await h.advance(SETTLE_TICKS);
  const respawned = await h.snapshot();
  // The respawned ship, its charge indicator full again.
  await captureStill(h, "refilled");

  assertLessThanOrEqual(
    Math.abs(chargeOf(respawned, "the ship the respawn put up") - 1),
    REFILL_SLACK,
    `the torpedo charge on the ship a respawn put up, having stood at ` +
      `${PART_CHARGE} when the ship before it was lost (specs/weapons.md: a ` +
      `respawn refills the charge to 1 and cancels any recharge in progress)`,
  );
});
