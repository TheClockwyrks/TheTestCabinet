// Wick — instrumentation/roll-drop-changes-nothing: `rollDrop()` is a reading
// of the roll alone, so a run of calls leaves the state exactly as it was, a
// posed `nextDrop` included.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — "Drawn
// outcomes", `rollDrop()`): "It is a reading of the roll alone: nothing drops,
// nothing dies, no cue sounds, and every field of the state stands as it was,
// `nextDrop` included, since a posed drop has no part in it."
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night with Taper held, a moth
// standing well clear of the lamplighter, and `setNextDrop("bread")` posed, so
// the state holds an enemy the roll could have killed, a slot it could have
// touched, and the one field a roll that consumed the pose would clear.
// `posedState` reads the fields a pose fixes, which is what "exactly as it was"
// is decided on.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  isolate,
  placeEnemy,
  posedState,
  type Harness,
} from "../harness";
import { rollDrops } from "../pickups/stage";

/** How many rolls are made over the posed state. */
const CALLS = 100;

/** Where the moth stands: well outside every radius about the lamplighter. */
const MOTH_AT = { x: 500, y: 0 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves the state, nextDrop included, exactly as it was", async () => {
  await isolate(h, { taper: true });
  await placeEnemy(h, "moth", MOTH_AT.x, MOTH_AT.y);
  await h.debug.setNextDrop("bread");
  const before = await h.snapshot();

  const sample = await rollDrops(h, CALLS);
  const after = await h.snapshot();
  await captureStill(h, "unchanged");

  assertEqual(sample.rolls, CALLS, "the rolls made over the posed state");
  assertDeepEqual(
    posedState(after),
    posedState(before),
    `the state across ${CALLS} rollDrop() calls`,
  );
  assertEqual(after.run.nextDrop, "bread", "nextDrop after the rolls");
});
