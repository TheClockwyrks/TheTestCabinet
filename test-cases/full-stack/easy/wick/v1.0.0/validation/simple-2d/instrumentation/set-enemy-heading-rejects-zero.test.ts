// instrumentation/set-enemy-heading-rejects-zero — `setEnemyHeading(id, 0, 0)`
// throws and leaves the heading as it was.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md, `setEnemyHeading`:
// "a zero vector is invalid"; an invalid argument "throws rather than guessing
// what was meant".
//
// THE POSE. An isolated run, a gnat with a heading posed to something no
// default would produce, the refused call, and the whole snapshot against the
// reading before.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertThrows } from "../assert";
import {
  captureStill,
  createHarness,
  isolate,
  spawnEnemyAt,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("refuses a zero vector", async () => {
  isolate(h);
  const id = spawnEnemyAt(h, "gnat", 300, 0);
  h.debug.setEnemyHeading(id, 3, 4);
  const before = h.snapshot();

  assertThrows(
    () => h.debug.setEnemyHeading(id, 0, 0),
    "setEnemyHeading(id, 0, 0)",
  );
  const s = h.snapshot();
  await h.tick(1);
  captureStill(h, "refused");

  assertDeepEqual(s, before, "the snapshot across the refused pose");
});
