// instrumentation/remove-saucer — `removeSaucer()` empties the saucer's one slot
// and leaves every other roster standing.
//
// THE SAUCER IS A SLOT RATHER THAN A ROSTER. `specs/saucer.md` allows at most one
// on the field at a time, so `specs/instrumentation.md` addresses it through a
// single slot: `snapshot().saucer` is the address, and `removeSaucer()` is both the
// per-entity removal and the clear. The reading is therefore `null` rather than an
// empty array, and that is what this asks for.
//
// THE SECOND HALF IS THE HALF THAT MATTERS. The saucer's fire outlives the saucer:
// `specs/saucer.md` gives a saucer bullet its own `SAUCER_BULLET_LIFE`, and nothing
// says a bullet dies with the craft that fired it. So the enemy-bullet roster is on
// the field when the saucer is removed and is read back by id, along with the rocks
// and the ship's own bullets.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNull } from "../assert";
import {
  captureStill,
  createHarness,
  startPlaying,
  theSaucer,
  type Harness,
} from "../harness";
import { posePopulatedField } from "./populated-field";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("clears the saucer alone and leaves the rest of the field standing", async () => {
  startPlaying(h);
  const posed = posePopulatedField(h);
  await h.advance(1);
  assertEqual(
    theSaucer(h.snapshot(), "the posed saucer").id,
    posed.saucer,
    "the saucer the field held",
  );

  h.debug.removeSaucer();
  await h.advance(1);
  captureStill(h, "removed");
  const after = h.snapshot();

  assertNull(after.saucer, "the saucer slot removeSaucer left");
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
  assertDeepEqual(
    after.enemyBullets.map((bullet) => bullet.id),
    posed.enemyBullets,
    "the saucer bullets left standing",
  );
});
