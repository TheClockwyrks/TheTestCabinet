// instrumentation/clear-enemy-bullets — `clearEnemyBullets()` empties the
// saucer's fire and leaves every other body standing.
//
// THE RULE. `specs/instrumentation.md`, The bullets: "`clearEnemyBullets()`
// Removes every saucer bullet, leaving the rest standing."
//
// THE ROSTER IT MUST NOT TOUCH is the ship's. The two are separate rosters
// carrying entries of the same shape (`specs/state.md`), so a build that keeps
// one list of rounds with a flag on each reads identically to a correct one on a
// field where only the saucer has fired. The field carries three of each, and
// the ship's three are held against exactly what they were.
//
// AND THE SAUCER ITSELF STAYS. Clearing the rounds it fired is not removing it:
// `removeSaucer()` is the operation that does that, and it is a different item.
//
// THE READING IS TAKEN AT THE CALL, with no frame between the pose, the clear
// and the reading, so what is compared is the operation's own effect rather than
// a tick of the game's rules — the `SAUCER_BULLET_LIFE` those rounds are
// spending among them (`specs/saucer.md`).

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertLength, assertNotNull } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { ENEMY_BULLET_SPOTS, posePopulatedField } from "./scene";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("removes every saucer bullet and leaves the rest standing", async () => {
  posePopulatedField(h);
  const before = h.snapshot();
  assertLength(
    before.enemyBullets,
    ENEMY_BULLET_SPOTS.length,
    "the posed field carries the saucer's rounds",
  );

  h.debug.clearEnemyBullets();
  const after = h.snapshot();

  assertLength(after.enemyBullets, 0, "clearEnemyBullets removes every one");
  assertDeepEqual(
    after.rocks,
    before.rocks,
    "clearEnemyBullets leaves the rocks standing, unchanged",
  );
  assertDeepEqual(
    after.bullets,
    before.bullets,
    "clearEnemyBullets leaves the ship's bullets standing, unchanged",
  );
  assertNotNull(
    after.saucer,
    "clearEnemyBullets leaves the saucer on the field",
  );
  assertDeepEqual(
    after.saucer,
    before.saucer,
    "clearEnemyBullets leaves the saucer standing, unchanged",
  );

  // The field with the enemy fire gone and the rest standing.
  await h.advance(1);
  captureStill(h, "cleared");
});
