// instrumentation/roll-drop-changes-nothing — `rollDrop(state)` is a reading
// of the roll alone, so a run of calls leaves the state exactly as it was, a
// posed `nextDrop` included.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md ("Drawn outcomes",
// `rollDrop(state)`): "It is a reading of the roll alone: nothing drops,
// nothing dies, no cue sounds, and every field of the state stands as it was,
// `nextDrop` included, since a posed drop has no part in it."
//
// THE POSE. An isolated night with Taper held, a moth standing well clear of
// the lamplighter, and `setNextDrop("bread")` posed, so the state holds an
// enemy the roll could have killed, a slot it could have touched, and the one
// field a roll that consumed the pose would clear.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  isolate,
  spawnEnemyAt,
  type Harness,
} from "../harness";
import { rollDrops } from "../pickups/sample";

/** How many rolls are made over the posed state. */
const CALLS = 100;

/** Where the moth stands: well outside every radius about the lamplighter. */
const MOTH_AT = { x: 500, y: 0 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves the state, nextDrop included, exactly as it was", async () => {
  isolate(h, { keepTaper: true });
  spawnEnemyAt(h, "moth", MOTH_AT.x, MOTH_AT.y);
  h.debug.setNextDrop("bread");
  const before = h.snapshot();

  const sample = rollDrops(h, CALLS);
  const after = h.snapshot();

  assertEqual(sample.rolls, CALLS, "the rolls made over the posed state");
  assertDeepEqual(after, before, `the snapshot across ${CALLS} rollDrop calls`);
  assertEqual(after.run.nextDrop, "bread", "nextDrop after the rolls");

  await h.tick(1);
  captureStill(h, "unchanged");
});
