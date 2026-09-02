// lives/the-saucer-costs-a-life — the saucer's hull reaching the ship costs
// exactly one life.
//
// THE RULE. `specs/collision.md` resolves the ship and the saucer as "The ship
// is destroyed and a life is lost", the same resolution it gives a rock and the
// same one `specs/progression.md` prices at one ship. This item decides the
// SAUCER's lethal pair alone; the rock and the saucer's bullet are the two items
// beside it.
//
// THE SAUCER'S OTHER TWO FACULTIES ARE HELD, and that is what makes this the
// hull's item rather than the visit's. `specs/instrumentation.md` gates each of
// the saucer's three faculties separately, so `duel.ts` holds its MIND — the
// weave it would otherwise reroll every `SAUCER_WEAVE_INTERVAL`, which would
// carry it off the line it was posed on — and holds its GUN, because a saucer
// left firing could take the ship with a bullet instead and this check would
// report `lives/a-saucer-bullet-costs-a-life`'s result under this item's name.
// Its TRAVEL is left running, because travelling into the ship is the whole
// scenario.
//
// EXACTLY ONE, read on the tick the counter falls, for the reason the rock's
// item states: a build that spends a life per overlapping body drops two.
//
// The ship's contact gate is on and its respawn grace at zero — asserted before
// a tick runs — and the field holds the ship and the saucer and nothing else.

import { afterEach, beforeEach, it } from "vitest";
import { SAUCER_R, START_LIVES } from "../constants";
import { assertEqual, assertTrue } from "../assert";
import { createHarness, ticksFor, type Harness } from "../harness";
import { poseClosingSaucer, poseDuel, watchContact } from "./duel";

/**
 * The ceiling on the watch.
 *
 * The saucer is posed `STANDOFF` (40) units of surface gap out and closes at
 * `CLOSING_SPEED` (240), a sixth of a second. Half a second bounds a build whose
 * saucer does not travel without hanging the suite, and stays far inside
 * `SAUCER_LIFETIME` (12 s) so the visit cannot be what ends the scenario.
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

it("spends exactly one life when the saucer reaches the ship", async () => {
  poseDuel(h);
  poseClosingSaucer(h);

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
  assertEqual(
    armed.saucer?.gun,
    false,
    "the saucer's gun held, so the ship can only be taken by its hull " +
      "(specs/instrumentation.md)",
  );
  assertEqual(
    armed.lives,
    START_LIVES,
    "the ships the run stands on before the contact (specs/progression.md)",
  );

  const watch = await watchContact(h, {
    maxTicks: MAX_TICKS,
    radius: SAUCER_R,
    read: (snapshot) => snapshot.saucer ?? undefined,
    still: { id: "contact", gap: CONTACT_PICTURE_GAP },
  });

  assertEqual(
    watch.end.enemyBullets.length,
    0,
    "no saucer bullet on the field, so the hull is what reached the ship " +
      "(specs/instrumentation.md)",
  );
  assertTrue(
    watch.lostAt >= 0,
    "the saucer reaching the ship to destroy it and cost a life " +
      "(specs/collision.md)",
  );
  assertEqual(
    watch.end.lives,
    START_LIVES - 1,
    "the ships left after the saucer destroyed one ship — losing a ship " +
      "costs one life (specs/progression.md)",
  );
});
