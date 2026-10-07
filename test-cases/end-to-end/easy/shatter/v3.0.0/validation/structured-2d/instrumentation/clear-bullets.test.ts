// instrumentation/clear-bullets — `clearBullets()` empties the ship's rounds and
// leaves every other body standing.
//
// THE RULE. `specs/instrumentation.md`, The bullets: "`clearBullets()` Removes
// every one of the ship's bullets, leaving the rocks, saucer bullets, and the
// saucer standing."
//
// THE ROSTER IT MUST NOT TOUCH is the saucer's. The two are separate rosters
// carrying entries of the same shape (`specs/state.md`), and a build that keeps
// one list of rounds with a flag on each, or that clears both from one place,
// reads identically to a correct one on a field where only the ship has fired.
// So the field carries three of each, and the saucer's three are held against
// exactly what they were — the same ids at the same places.
//
// THE READING IS TAKEN AT THE CALL, with no frame between the pose, the clear
// and the reading: a pose acts on the live game the moment it is made
// (`specs/instrumentation.md`), so what is compared is the operation's own
// effect. It also matters here for a second reason — a round in flight is
// spending its `BULLET_LIFE` (`specs/weapons.md`) — and reading at the call
// keeps the comparison free of the lifetime the rounds would otherwise burn.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertLength } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { BULLET_SPOTS, posePopulatedField } from "./scene";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("removes every one of the ship's bullets and leaves the rest standing", async () => {
  posePopulatedField(h);
  const before = h.snapshot();
  assertLength(
    before.bullets,
    BULLET_SPOTS.length,
    "the posed field carries the ship's rounds",
  );

  h.debug.clearBullets();
  const after = h.snapshot();

  assertLength(after.bullets, 0, "clearBullets removes every one of them");
  assertDeepEqual(
    after.rocks,
    before.rocks,
    "clearBullets leaves the rocks standing, unchanged",
  );
  assertDeepEqual(
    after.enemyBullets,
    before.enemyBullets,
    "clearBullets leaves the saucer's bullets standing, unchanged",
  );
  assertDeepEqual(
    after.saucer,
    before.saucer,
    "clearBullets leaves the saucer standing, unchanged",
  );

  // The field with the ship's bullets gone and the rest standing.
  await h.advance(1);
  captureStill(h, "cleared");
});
