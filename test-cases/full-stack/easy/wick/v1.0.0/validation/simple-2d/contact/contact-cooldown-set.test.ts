// contact/contact-cooldown-set — an enemy that landed a hit reads
// contactCooldown CONTACT_COOLDOWN (0.5) in that tick's snapshot.
//
// THE RULE, FROM THE SPEC. specs/world.md, Contact damage: "An overlapping enemy
// whose contactCooldown is due lands a hit: hp falls by
// max(MIN_DAMAGE_TAKEN, enemy damage − armor), and its contactCooldown is set to
// CONTACT_COOLDOWN", with CONTACT_COOLDOWN 0.5 in that section's table.
//
// WHY 0.5 AND NOT 0.5 − TICK_DT. Phase 7 of specs/world.md, One tick: "Every
// live enemy's contactCooldown counts down, and, while enemyContact is on, an
// overlapping enemy whose cooldown is due hits". The count-down precedes the hit
// within the phase, so the value the hit sets is the value the tick leaves, and
// the snapshot taken after that tick reads 0.5 exactly.
//
// THE POSE. An isolated night with enemyContact on: one moth overlapping the
// lamplighter, posed 5 units along +x, well inside the 22 its radius 10 plus
// PLAYER_RADIUS sum to, holding still with enemyMotion off. Its cooldown is 0
// at spawn and due on the first tick, so that tick's hit is what sets it.
//
// THE TOLERANCE is FIGURE_TOLERANCE: 0.5 is a stated figure read back.

import { afterEach, beforeEach, it } from "vitest";
import { assertWithin, fail } from "../assert";
import { CONTACT_COOLDOWN, FIGURE_TOLERANCE } from "../constants";
import {
  captureStill,
  createHarness,
  enable,
  enemyById,
  isolate,
  spawnEnemyNear,
  type Harness,
} from "../harness";

/** The enemy that hits. */
const TYPE = "moth";

/** Where the moth is posed: 5 units along +x, well inside the overlap. */
const OFFSET = 5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reads contactCooldown 0.5 on the enemy in the snapshot of the tick its hit landed", async () => {
  isolate(h);
  enable(h, "enemyContact");
  const id = spawnEnemyNear(h, TYPE, OFFSET, 0);

  const after = await h.tick(1);
  captureStill(h, "cooldown");

  const moth = enemyById(after, id);
  if (moth === undefined)
    fail("the posed moth alive after the tick", after.run.enemies);
  assertWithin(
    moth.contactCooldown,
    CONTACT_COOLDOWN,
    FIGURE_TOLERANCE,
    "contactCooldown on the tick of the hit",
  );
});
