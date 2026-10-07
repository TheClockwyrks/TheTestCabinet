// contact/contact-cooldown-counts-out-of-contact — a contact cooldown counts
// down by TICK_DT a tick whether or not the enemy touches the lamplighter.
//
// THE RULE, FROM THE SPEC. specs/world.md, Contact damage: "The cooldown counts
// down on every tick the enemy is alive, in or out of contact." And Timers: "On
// every tick a timer counts down by TICK_DT and is held at 0", with TICK_DT
// 1 / 60. A cooldown posed to 0.5 on a moth far from the lamplighter therefore
// reads 0.5 − 10 × TICK_DT after 10 ticks.
//
// THE POSE. An isolated night: one moth posed 500 units along +x, far outside
// the 22 its radius 10 plus PLAYER_RADIUS sum to, holding its place with
// enemyMotion off so it stays out of contact for the whole span. enemyContact is
// on, because the phase whose count-down this item reads is the contact phase
// as it runs in play; the moth is out of contact, so no hit can set the timer
// again. Its cooldown is posed to 0.5 through setEnemyContactCooldown, which
// specs/instrumentation.md gives that exact effect.
//
// THE TOLERANCE is MOTION_TOLERANCE: ten subtractions of TICK_DT integrate
// tick by tick, and 1e-6 covers their rounding with margin while sitting
// far below the 1 / 60 a single missed or extra tick would move the reading.

import { afterEach, beforeEach, it } from "vitest";
import { assertWithin, fail } from "../assert";
import { CONTACT_COOLDOWN, MOTION_TOLERANCE, TICK_DT } from "../constants";
import {
  captureStill,
  createHarness,
  enable,
  enemyById,
  isolate,
  spawnEnemyNear,
  type Harness,
} from "../harness";

/** The enemy whose cooldown counts. */
const TYPE = "moth";

/** Where the moth is posed: 500 units along +x, far out of contact. */
const OFFSET = 500;

/** The cooldown posed on it. */
const POSED_COOLDOWN = CONTACT_COOLDOWN;

/** How many ticks the count-down is read across. */
const TICKS = 10;

/** 0.5 − 10 × TICK_DT. */
const EXPECTED = POSED_COOLDOWN - TICKS * TICK_DT;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reads 0.5 − 10 × TICK_DT after 10 ticks on a moth 500 units away", async () => {
  isolate(h);
  enable(h, "enemyContact");
  const id = spawnEnemyNear(h, TYPE, OFFSET, 0);
  h.debug.setEnemyContactCooldown(id, POSED_COOLDOWN);

  const after = await h.tick(TICKS);
  captureStill(h, "counting");

  const moth = enemyById(after, id);
  if (moth === undefined)
    fail("the posed moth alive after the ticks", after.run.enemies);
  assertWithin(
    moth.contactCooldown,
    EXPECTED,
    MOTION_TOLERANCE,
    `contactCooldown after ${TICKS} ticks out of contact`,
  );
});
