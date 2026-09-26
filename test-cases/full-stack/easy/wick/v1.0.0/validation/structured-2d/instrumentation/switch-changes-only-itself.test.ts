// Wick — instrumentation/switch-changes-only-itself: `setDespawning(false)`
// issued on `title` reads back false, leaves the other eight switches and the
// idle run exactly as they were, and is still false after
// `setScreen('playing')`.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`, "The
// nine switch operations": "Each applies on every screen and changes nothing
// but its switch"; "The driver switches": "A switch changes only what it
// names" and "each is left as it stands by `setScreen`".
//
// THE POSE. `reset` to the title, the call, and the whole snapshot compared
// with the one before it save `despawning`; then a pose to `playing`.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("flips one flag and nothing else, and keeps it across a posed screen", async () => {
  h.reset();
  const before = h.snapshot();

  h.debug.setDespawning(false);
  const after = h.snapshot();
  assertEqual(
    after.despawning,
    false,
    "despawning after setDespawning(false) on title",
  );
  assertDeepEqual(
    after,
    { ...before, despawning: false },
    "snapshot after the call, against the one before",
  );

  h.debug.setScreen("playing");
  const posed = h.snapshot();
  await h.frameDraw();
  captureStill(h, "one");
  assertEqual(posed.despawning, false, "despawning after setScreen('playing')");
});
