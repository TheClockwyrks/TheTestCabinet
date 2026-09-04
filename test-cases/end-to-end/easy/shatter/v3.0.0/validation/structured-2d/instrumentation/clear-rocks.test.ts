// instrumentation/clear-rocks — `clearRocks()` empties the rocks and leaves
// every other body standing.
//
// THE RULE. `specs/instrumentation.md`, The rocks: "`clearRocks()` Removes every
// rock, leaving the bullets, saucer bullets, and the saucer standing. It
// destroys nothing and scores nothing, so a field it emptied has had no rock
// destroyed on that tick."
//
// BOTH HALVES ARE READ. The rocks go, and the three other rosters are held
// against exactly what they held before the call — not merely "not empty", but
// the same entries with the same ids at the same places, so a build whose clear
// walks one roster too far is caught by the roster it walked into.
//
// AND NOTHING SCORES. The second sentence of the rule is what the whole case
// leans on: `clearRocks` is a way to make room, so a wave it emptied is a wave
// being played rather than a wave cleared (`specs/progression.md`), and no
// check in this suite reaches a cleared wave with it. A build that paid for the
// rocks it removed would make the field's emptiness look like a clear, so the
// score is read across the call too.
//
// THE READING IS TAKEN AT THE CALL, with no frame between the pose, the clear
// and the reading: a pose acts on the live game the moment it is made
// (`specs/instrumentation.md`), so what is compared is the operation's own
// effect and not a tick of the game's rules laid over it.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { posePopulatedField } from "./scene";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("removes every rock, leaves the rest standing, and scores nothing", async () => {
  posePopulatedField(h);
  const before = h.snapshot();
  assertLength(before.rocks, 3, "the posed field carries three rocks");

  h.debug.clearRocks();
  const after = h.snapshot();

  assertLength(after.rocks, 0, "clearRocks removes every rock");
  assertDeepEqual(
    after.bullets,
    before.bullets,
    "clearRocks leaves the ship's bullets standing, unchanged",
  );
  assertDeepEqual(
    after.enemyBullets,
    before.enemyBullets,
    "clearRocks leaves the saucer bullets standing, unchanged",
  );
  assertDeepEqual(
    after.saucer,
    before.saucer,
    "clearRocks leaves the saucer standing, unchanged",
  );
  assertEqual(
    after.score,
    before.score,
    "clearRocks destroys nothing and scores nothing",
  );

  // The field with the rocks gone and the rest standing.
  await h.advance(1);
  captureStill(h, "cleared");
});
