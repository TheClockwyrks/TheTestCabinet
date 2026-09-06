// Wick — instrumentation/roll-drop: `rollDrop()` makes one drop roll and
// returns what it decided, one of `bread`, `draft`, and `none`, on `playing`
// and on `title` alike.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — "Drawn
// outcomes", `rollDrop()`): "Makes one drop roll exactly as `specs/world.md`
// states under The drop roll and returns what it decided: `bread`, `draft`,
// or `none` ... Applies on every screen." What each call returns is the
// build's own roll, so the reading is held to the domain alone; the rates are
// `pickups/bread-rate` and `pickups/draft-rate`, and that the reading changes
// nothing is `roll-drop-changes-nothing`.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night for the calls on
// `playing`, and the title screen, reached through `setScreen`, for the calls
// there.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { captureStill, createHarness, isolate, type Harness } from "../harness";
import { rollDrops } from "../pickups/stage";

/** How many rolls are read on each screen. */
const CALLS = 100;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("returns one of bread, draft, and none on playing and on title", async () => {
  await isolate(h);
  const playing = await rollDrops(h, CALLS);
  await captureStill(h, "rolled");

  assertEqual(playing.rolls, CALLS, "the rolls made on playing");
  assertDeepEqual(
    playing.others,
    [],
    `results of ${CALLS} rollDrop() calls on playing outside bread, draft, and none`,
  );

  await h.debug.setScreen("title");
  const title = await rollDrops(h, CALLS);
  assertEqual(title.rolls, CALLS, "the rolls made on title");
  assertDeepEqual(
    title.others,
    [],
    `results of ${CALLS} rollDrop() calls on title outside bread, draft, and none`,
  );
});
