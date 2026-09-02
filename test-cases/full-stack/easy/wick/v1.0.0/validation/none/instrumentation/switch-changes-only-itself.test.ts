// Wick — instrumentation/switch-changes-only-itself: `setDespawning(false)`
// issued on `title` reads back `false`, leaves the other six switches and the
// idle run exactly as they were, and is still `false` after
// `setScreen("playing")`.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md): "A switch changes
// only what it names" ("The driver switches"); "Each applies on every screen
// and changes nothing but its switch" ("The seven switch operations"); and
// `setScreen`: "The driver switches stay as they are." The comparison is exact
// equality of the documented snapshot with the one switch set aside.
//
// WHY THE WORLD IS POSED AS IT IS. The title is a screen the operation must
// apply on and one whose run is idle, so anything the call touched beside its
// switch would be plain; a fresh run is then begun, the one transition that
// could have reset it.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { SWITCH_NAMES } from "../constants";
import {
  captureStill,
  createHarness,
  posedState,
  poseScreen,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("changes nothing but its own flag, on title and across a fresh run", async () => {
  const before = await h.snapshot();
  assertEqual(before.screen, "title", "the screen the call is made on");

  await h.debug.setDespawning(false);
  const after = await h.snapshot();
  await captureStill(h, "one");

  assertEqual(after.despawning, false, "despawning after the call");
  for (const name of SWITCH_NAMES) {
    if (name !== "despawning") {
      assertEqual(after[name], true, `the ${name} switch after the call`);
    }
  }
  const rest = posedState(after);
  rest.despawning = before.despawning;
  assertDeepEqual(rest, posedState(before), "everything beside the switch");

  const fresh = await poseScreen(h, "playing");
  assertEqual(fresh.despawning, false, "despawning after setScreen('playing')");
});
