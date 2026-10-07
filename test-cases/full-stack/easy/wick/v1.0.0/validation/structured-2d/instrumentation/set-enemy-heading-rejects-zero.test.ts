// Wick — instrumentation/set-enemy-heading-rejects-zero:
// `setEnemyHeading(id, 0, 0)` throws and leaves the heading as it was.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`,
// `setEnemyHeading(id, hx, hy)`: "a zero vector is invalid"; an invalid
// argument throws.
//
// THE POSE. An isolated run with a gnat, the call, and the whole snapshot
// compared with the one before it.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertThrows } from "../assert";
import {
  captureStill,
  createHarness,
  enemyById,
  isolate,
  placeEnemy,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("throws on a zero vector and changes nothing", async () => {
  isolate(h);
  const id = placeEnemy(h, "gnat", 200, 0);
  const before = h.snapshot();

  assertThrows(
    () => h.debug.setEnemyHeading(id, 0, 0),
    "setEnemyHeading(id, 0, 0)",
  );
  const after = h.snapshot();
  await h.frameDraw();
  captureStill(h, "refused");
  assertDeepEqual(
    enemyById(after, id)?.heading,
    enemyById(before, id)?.heading,
    "the heading after the refused call",
  );
  assertDeepEqual(after, before, "snapshot after the refused call");
});
