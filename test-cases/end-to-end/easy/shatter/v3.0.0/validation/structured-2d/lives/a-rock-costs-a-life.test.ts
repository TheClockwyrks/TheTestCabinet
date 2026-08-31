// lives/a-rock-costs-a-life — a rock reaching the ship costs exactly one life.
//
// THE RULE. `specs/collision.md` resolves the ship and a rock as "The ship is
// destroyed and a life is lost", and `specs/progression.md` states what that
// costs: "Losing a ship costs one life." This item decides the ROCK's lethal
// pair alone. The saucer's hull and a saucer bullet are the two items beside
// this one, so a build that dies to a rock and flies through the saucer loses
// exactly one point.
//
// EXACTLY ONE, read on the tick the counter falls. A build that spends a life
// per overlapping body, or that resolves the same contact twice in a tick, drops
// two — so the reading is the counter itself and not merely that it moved.
//
// THE SHIP'S CONTACT GATE IS TURNED BACK ON. `startPlaying` shuts it so that no
// scenario in this case loses a ship by accident; here the lethal contact test
// IS the requirement, so `duel.ts` switches it on and this check asserts it is
// on before a tick runs. The respawn grace is separately at zero, because
// `specs/collision.md` has the grace suspend exactly these three pairs — a ship
// carrying one would pass through unharmed, which is
// `lives/invuln-ignores-a-rock`'s point.
//
// THE FIELD HOLDS THE SHIP AND ONE ROCK AND NOTHING ELSE. `startPlaying` empties
// every roster and shuts both world gates, so nothing arrives to take the ship
// first and the fall in the counter has exactly one possible cause.
//
// A SMALL, because size is not this item's subject: `specs/collision.md` gives
// the ship the same resolution against a rock of any size, and the Small's `14`
// unit radius is the tightest of the three, so a build whose contact test is too
// generous is not flattered by a `46`-unit body.

import { afterEach, beforeEach, it } from "vitest";
import { ROCK_RADIUS, START_LIVES } from "../../src/constants";
import { assertEqual, assertTrue } from "../assert";
import { createHarness, rockById, ticksFor, type Harness } from "../harness";
import { poseClosingRock, poseDuel, watchContact } from "./duel";

/** The size the rock is posed at. See the note above on why it is a Small. */
const ROCK = "small" as const;

/**
 * The ceiling on the watch.
 *
 * The rock is posed `STANDOFF` (40) units of surface gap out and closes at
 * `CLOSING_SPEED` (240), which is a sixth of a second. Half a second bounds a
 * build whose rocks do not travel without hanging the suite.
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

it("spends exactly one life when a rock reaches the ship", async () => {
  poseDuel(h);
  const rockId = poseClosingRock(h, ROCK);

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
    armed.lives,
    START_LIVES,
    "the ships the run stands on before the contact (specs/progression.md)",
  );

  const watch = await watchContact(h, {
    maxTicks: MAX_TICKS,
    radius: ROCK_RADIUS[ROCK],
    read: (snapshot) => rockById(snapshot, rockId),
    still: { id: "contact", gap: CONTACT_PICTURE_GAP },
  });

  assertTrue(
    watch.lostAt >= 0,
    "the rock reaching the ship to destroy it and cost a life " +
      "(specs/collision.md)",
  );
  assertEqual(
    watch.end.lives,
    START_LIVES - 1,
    "the ships left after one rock destroyed one ship — losing a ship costs " +
      "one life (specs/progression.md)",
  );
});
