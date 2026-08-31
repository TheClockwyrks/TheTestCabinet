// lives/a-saucer-bullet-costs-a-life — an enemy round reaching the ship costs
// exactly one life.
//
// THE RULE. `specs/collision.md` resolves the ship and a saucer bullet as "The
// ship is destroyed and a life is lost, and the bullet is removed", and
// `specs/progression.md` prices the loss at one ship. This item decides the
// BULLET's lethal pair alone; the rock's hull and the saucer's are the two items
// beside it.
//
// THERE IS NO SAUCER ON THE FIELD, which is the isolation that matters here. A
// scenario that waited for a saucer to shoot would be deciding the saucer's aim,
// its fire interval and its arrival as well as this rule, and a saucer standing
// by could take the ship with its hull first — the item next door. So the round
// is placed in flight through `addEnemyBullet`, which
// `specs/instrumentation.md` says puts up a saucer bullet with a full
// `SAUCER_BULLET_LIFE` that is "live in the same way" as one the saucer fired.
// What the saucer's gun does with it is `saucer/`'s business.
//
// EXACTLY ONE, read on the tick the counter falls, for the reason the rock's
// item states: a build that spends a life per overlapping body drops two.
//
// The ship's contact gate is on and its respawn grace at zero — asserted before
// a tick runs — and the field holds the ship and the one round and nothing else.

import { afterEach, beforeEach, it } from "vitest";
import { SAUCER_BULLET_R, START_LIVES } from "../../src/constants";
import { assertEqual, assertNull, assertTrue } from "../assert";
import {
  createHarness,
  enemyBulletById,
  ticksFor,
  type Harness,
} from "../harness";
import { poseClosingEnemyBullet, poseDuel, watchContact } from "./duel";

/**
 * The ceiling on the watch.
 *
 * The round is posed `STANDOFF` (40) units of surface gap out and closes at
 * `CLOSING_SPEED` (240), a sixth of a second — well inside the
 * `SAUCER_BULLET_LIFE` (1.4 s) it carries, so the round cannot expire before it
 * arrives. Half a second bounds a build whose enemy rounds do not travel without
 * hanging the suite.
 */
const MAX_TICKS = ticksFor(0.5);

/** How close the two surfaces are when the picture is kept: about to touch. */
const CONTACT_PICTURE_GAP = 8;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("spends exactly one life when a saucer bullet reaches the ship", async () => {
  poseDuel(h);
  const bulletId = poseClosingEnemyBullet(h);

  const armed = h.snapshot();
  assertEqual(
    armed.ship.collision,
    true,
    "the ship's lethal contact test running for the contact " +
      "(specs/instrumentation.md)",
  );
  assertEqual(
    armed.ship.invuln,
    0,
    "the ship carrying no respawn grace, so the contact is lethal " +
      "(specs/collision.md)",
  );
  assertNull(
    armed.saucer,
    "no saucer on the field, so the round is the only thing that can reach " +
      "the ship (specs/instrumentation.md)",
  );
  assertEqual(
    armed.lives,
    START_LIVES,
    "the ships the run stands on before the contact (specs/progression.md)",
  );

  const watch = await watchContact(h, {
    maxTicks: MAX_TICKS,
    radius: SAUCER_BULLET_R,
    read: (snapshot) => enemyBulletById(snapshot, bulletId),
    still: { id: "contact", gap: CONTACT_PICTURE_GAP },
  });

  assertTrue(
    watch.lostAt >= 0,
    "the saucer bullet reaching the ship to destroy it and cost a life " +
      "(specs/collision.md)",
  );
  assertEqual(
    watch.end.lives,
    START_LIVES - 1,
    "the ships left after a saucer bullet destroyed one ship — losing a ship " +
      "costs one life (specs/progression.md)",
  );
});
