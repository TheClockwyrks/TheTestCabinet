// instrumentation/switch-changes-only-itself — `setDespawning(false)` issued
// on title reads back false, leaves the other eight switches and the idle run
// exactly as they were, and is still false after `setScreen('playing')`.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md, "The nine switch
// operations": "Each applies on every screen and changes nothing but its
// switch"; "A switch changes only what it names"; each "is left as it stands
// by `setScreen`".
//
// THE POSE. A fresh reset on the title, the one switch off, the snapshot
// compared against the reading before it with that field alone changed; then
// the pose to `playing`, and the switch still off.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  SWITCH_NAMES,
  switchesOf,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("changes one switch on the title and carries it into the run", async () => {
  h.reset();
  const before = h.snapshot();

  h.debug.setDespawning(false);
  const s = h.snapshot();

  assertEqual(s.despawning, false, "despawning after the pose");
  for (const name of SWITCH_NAMES) {
    if (name !== "despawning")
      assertEqual(s[name], true, `${name} after the pose`);
  }
  assertDeepEqual(
    { ...s, despawning: true },
    before,
    "the snapshot across the pose, but for despawning",
  );

  h.debug.setScreen("playing");
  const playing = h.snapshot();
  await h.tick(1);
  captureStill(h, "one");
  assertEqual(
    playing.despawning,
    false,
    "despawning after setScreen('playing')",
  );
  assertDeepEqual(
    switchesOf(playing),
    { ...switchesOf(before), despawning: false },
    "the nine switches after the pose to playing",
  );
});
