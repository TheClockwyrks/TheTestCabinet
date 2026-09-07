// Wick — instrumentation/set-next-strike-target-unknown-id: setNextStrikeTarget
// refuses an id that names no live enemy, throws, and leaves the state exactly
// as it was.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — "Drawn
// outcomes", `setNextStrikeTarget(id)`): "`id`, the id of a live enemy; any
// other value is invalid"; ("The operations") "the call throws rather than
// guessing what was meant".

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertRejects } from "../assert";
import {
  captureStill,
  createHarness,
  isolate,
  placeEnemy,
  posedState,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("throws on an id that names no live enemy", async () => {
  await isolate(h);
  await placeEnemy(h, "moth", 200, 0);
  const before = await h.snapshot();
  const unknown = before.run.nextId + 1000;

  await assertRejects(
    () => h.debug.setNextStrikeTarget(unknown),
    "setNextStrikeTarget(id) with an unknown id",
  );
  await captureStill(h, "refused");

  assertDeepEqual(
    posedState(await h.snapshot()),
    posedState(before),
    "the state across the refused setNextStrikeTarget",
  );
});
