// instrumentation/clear-enemy-bullets — `clearEnemyBullets()` empties the saucer's
// fire and leaves every other roster standing.
//
// THE SECOND HALF IS THE HALF THAT MATTERS. `specs/instrumentation.md` gives the
// operation both halves — "Removes every saucer bullet, leaving the rest standing"
// — and the second is what the harness's own `clearWorld` leans on, since it empties
// the world one roster at a time. The ship's own bullets are on the field while the
// saucer's are cleared, because those two rosters are the pair a build most easily
// confuses, and each survivor is read back by id.
//
// AND THE SAUCER ITSELF IS LEFT ALONE. Clearing what a saucer has fired is not
// removing the saucer — `removeSaucer()` is a separate operation with an item of
// its own — so the saucer is up throughout and is read back by its arrival id.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  requireSaucer,
  startPlaying,
  type Harness,
} from "../harness";
import { posePopulatedField } from "./populated-field";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("removes every saucer bullet and leaves the rest standing", async () => {
  await startPlaying(h);
  const posed = await posePopulatedField(h);
  await h.advance(1);
  const before = await h.snapshot();
  assertLength(
    before.enemyBullets,
    posed.enemyBullets.length,
    "the saucer bullets the field held",
  );

  await h.debug.clearEnemyBullets();
  await h.advance(1);
  await captureStill(h, "cleared");
  const after = await h.snapshot();

  assertLength(
    after.enemyBullets,
    0,
    "the saucer bullets clearEnemyBullets left",
  );
  assertDeepEqual(
    after.rocks.map((rock) => rock.id),
    posed.rocks,
    "the rocks left standing",
  );
  assertDeepEqual(
    after.bullets.map((bullet) => bullet.id),
    posed.bullets,
    "the ship's bullets left standing",
  );
  assertEqual(
    requireSaucer(after, "the saucer clearEnemyBullets left standing").id,
    posed.saucer,
    "the saucer left standing",
  );
});
