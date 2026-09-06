// Wick — instrumentation/set-next-strike-target-unknown-id:
// setNextStrikeTarget refuses an id that names no live enemy, throws, and
// leaves the state exactly as it was.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`
// ("Drawn outcomes", `setNextStrikeTarget(id)`): "`id`, the id of a live
// enemy; any other value is invalid"; ("The operations") "the call throws
// rather than guessing what was meant".

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertThrows } from "../assert";
import {
  captureStill,
  createHarness,
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

it("throws on an id that names no live enemy", async () => {
  isolate(h);
  placeEnemy(h, "moth", 200, 0);
  const before = h.snapshot();
  const unknown = before.run.nextId + 1000;

  assertThrows(
    () => h.debug.setNextStrikeTarget(unknown),
    "setNextStrikeTarget(id) with an unknown id",
  );
  assertDeepEqual(
    h.snapshot(),
    before,
    "the snapshot after setNextStrikeTarget was refused",
  );

  await h.frameDraw();
  captureStill(h, "refused");
});
