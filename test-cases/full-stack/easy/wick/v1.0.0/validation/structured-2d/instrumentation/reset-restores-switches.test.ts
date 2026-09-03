// Wick — instrumentation/reset-restores-switches: `reset()` turns every driver
// switch back on.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`, "The
// driver switches": "each is restored to on by `reset`", and `reset(options)`:
// "every driver switch on". `specs/state.md`: the seven "each `true` from
// `initialize` and after `reset`".
//
// THE POSE. `isolate` turns all seven off (the harness self-test proves it);
// `reset` is the whole operation under test, read back before any frame.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual } from "../assert";
import {
  SWITCH_NAMES,
  captureStill,
  createHarness,
  isolate,
  switchesOf,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("leaves all seven switches true after reset from all seven false", async () => {
  const off = isolate(h);
  assertDeepEqual(
    Object.values(switchesOf(off)),
    SWITCH_NAMES.map(() => false),
    "the seven switches posed off before reset",
  );

  h.reset();
  const after = h.snapshot();
  await h.frameDraw();
  captureStill(h, "switches");

  assertDeepEqual(
    switchesOf(after),
    {
      spawning: true,
      events: true,
      despawning: true,
      enemyMotion: true,
      enemyContact: true,
      weaponFire: true,
      effectMotion: true,
    },
    "the seven switches after reset",
  );
});
