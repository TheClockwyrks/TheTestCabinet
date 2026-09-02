// instrumentation/clear-rocks — `clearRocks()` empties the rock roster and leaves
// every other roster standing.
//
// THE SECOND HALF IS THE HALF THAT MATTERS. Emptying the rocks is easy to get
// right; emptying the rocks AND NOTHING ELSE is what `specs/instrumentation.md`
// asks for — "Removes every rock, leaving the bullets, saucer bullets, and the
// saucer standing" — and it is what the harness's own `clearWorld` depends on,
// since it empties the world one roster at a time and would be blind to a clear
// that took a neighbour with it. So the field this runs over carries something on
// every roster at once, and each survivor is read back BY ITS ID: a build that
// emptied a roster and refilled it would be caught by the count, and one that
// replaced an entity with a fresh one is caught by the id.
//
// AND IT DESTROYS NOTHING. `specs/instrumentation.md` is explicit that `clearRocks`
// "destroys nothing and scores nothing, so a field it emptied has had no rock
// destroyed on that tick", which is what keeps it apart from the wave-clear rule of
// `specs/progression.md`. The score is therefore read before and after, and a build
// that paid for the rocks it removed fails here.

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

it("removes every rock and leaves the rest of the field standing", async () => {
  await startPlaying(h);
  const posed = await posePopulatedField(h);
  const before = await h.advance(1);
  assertLength(before.rocks, posed.rocks.length, "the rocks the field held");

  await h.debug.clearRocks();
  await h.advance(1);
  await captureStill(h, "cleared");
  const after = await h.snapshot();

  assertLength(after.rocks, 0, "the rocks clearRocks left");
  assertDeepEqual(
    after.bullets.map((bullet) => bullet.id),
    posed.bullets,
    "the ship's bullets left standing",
  );
  assertDeepEqual(
    after.enemyBullets.map((bullet) => bullet.id),
    posed.enemyBullets,
    "the saucer bullets left standing",
  );
  assertEqual(
    requireSaucer(after, "the saucer clearRocks left standing").id,
    posed.saucer,
    "the saucer left standing",
  );
  assertEqual(
    after.score,
    before.score,
    "clearRocks destroys nothing, so it scores nothing",
  );
});
