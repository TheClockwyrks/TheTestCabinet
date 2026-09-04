// instrumentation/clear-bullets — `clearBullets()` empties the ship's bullet roster
// and leaves every other roster standing.
//
// THE SECOND HALF IS THE HALF THAT MATTERS. `specs/instrumentation.md` gives the
// operation both halves — "Removes every one of the ship's bullets, leaving the
// rocks, saucer bullets, and the saucer standing" — and the second is what the
// harness's own `clearWorld` leans on, since it empties the world one roster at a
// time. The two shot rosters are the pair most easily confused for one another, so
// the saucer's fire is on the field while the ship's is cleared, and it is read
// back by id.
//
// IT IS ALSO WHAT KEEPS THIS OPERATION APART FROM THE GUN. Nothing here fires:
// `specs/instrumentation.md` gives the surface no operation that does, so the
// bullets are placed and then removed, and what is graded is the removal alone.

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

it("removes every one of the ship's bullets and leaves the rest standing", async () => {
  await startPlaying(h);
  const posed = await posePopulatedField(h);
  const before = await h.advance(1);
  assertLength(
    before.bullets,
    posed.bullets.length,
    "the ship's bullets the field held",
  );

  await h.debug.clearBullets();
  await h.advance(1);
  await captureStill(h, "cleared");
  const after = await h.snapshot();

  assertLength(after.bullets, 0, "the ship's bullets clearBullets left");
  assertDeepEqual(
    after.rocks.map((rock) => rock.id),
    posed.rocks,
    "the rocks left standing",
  );
  assertDeepEqual(
    after.enemyBullets.map((bullet) => bullet.id),
    posed.enemyBullets,
    "the saucer bullets left standing",
  );
  assertEqual(
    requireSaucer(after, "the saucer clearBullets left standing").id,
    posed.saucer,
    "the saucer left standing",
  );
});
