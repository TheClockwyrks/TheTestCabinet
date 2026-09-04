// instrumentation/remove-saucer — `removeSaucer()` clears the saucer and leaves
// every other body standing.
//
// THE RULE. `specs/instrumentation.md`, The saucer: "At most one saucer exists
// at a time, so the saucer is a single slot rather than a roster:
// `snapshot().saucer` is the address, and `removeSaucer()` is both the
// per-entity removal and the clear." Its row reads: "Clears the saucer from the
// field."
//
// WHAT IS READ. The slot reads `null` — the specification's own word for an
// empty slot, and the value every check that asks "is a saucer up" tests
// against, so a build that leaves an object behind with its fields blanked is
// caught here rather than reading as a saucer everywhere else in the suite. And
// the three rosters are held against exactly what they were.
//
// THE ROUNDS IT LEFT BEHIND ARE THE ONES TO WATCH. A saucer bullet in flight is
// an ordinary body once fired (`specs/saucer.md`), belonging to the field rather
// than to the craft that fired it, so removing the saucer removes none of them.
// A build that keeps its enemy bullets under the saucer, or clears them with it,
// is caught by the saucer-bullet roster standing whole.
//
// THE READING IS TAKEN AT THE CALL, with no frame between the pose, the removal
// and the reading: a pose acts on the live game the moment it is made
// (`specs/instrumentation.md`), so what is compared is the operation's own
// effect and not a tick of the game's rules laid over it.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertNotNull, assertNull } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { posePopulatedField } from "./scene";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("clears the saucer and leaves the rocks and both rounds standing", async () => {
  posePopulatedField(h);
  const before = h.snapshot();
  assertNotNull(before.saucer, "the posed field carries a saucer");

  h.debug.removeSaucer();
  const after = h.snapshot();

  assertNull(after.saucer, "removeSaucer leaves the saucer slot null");
  assertDeepEqual(
    after.rocks,
    before.rocks,
    "removeSaucer leaves the rocks standing, unchanged",
  );
  assertDeepEqual(
    after.bullets,
    before.bullets,
    "removeSaucer leaves the ship's bullets standing, unchanged",
  );
  assertDeepEqual(
    after.enemyBullets,
    before.enemyBullets,
    "removeSaucer leaves the saucer's bullets standing, unchanged",
  );

  // The field with the saucer gone and the rest standing.
  await h.advance(1);
  captureStill(h, "removed");
});
