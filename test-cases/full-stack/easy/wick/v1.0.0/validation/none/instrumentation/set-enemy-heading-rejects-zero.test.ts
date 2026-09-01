// Wick — instrumentation/set-enemy-heading-rejects-zero:
// `setEnemyHeading(id, 0, 0)` throws and leaves the heading as it was.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md —
// `setEnemyHeading(id, hx, hy)`): "a zero vector is invalid"; "the call
// throws rather than guessing what was meant".
//
// WHY THE WORLD IS POSED AS IT IS. A gnat spawned off the origin carries a
// non-trivial spawn heading, read exactly across the refused call.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertRejects } from "../assert";
import {
  captureStill,
  createHarness,
  isolate,
  mustEnemy,
  placeEnemy,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("throws on a zero vector and leaves the heading as it was", async () => {
  await isolate(h);
  const gnat = await placeEnemy(h, "gnat", 300, 400);

  await assertRejects(() => h.debug.setEnemyHeading(gnat.id, 0, 0), "setEnemyHeading(id, 0, 0)");
  const after = mustEnemy(await h.snapshot(), gnat.id);
  await captureStill(h, "refused");
  assertDeepEqual(after.heading, gnat.heading, "the heading after the refused call");
});
