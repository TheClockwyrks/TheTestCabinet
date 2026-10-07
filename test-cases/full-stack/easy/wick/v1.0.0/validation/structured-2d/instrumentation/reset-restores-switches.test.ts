// Wick — instrumentation/reset-restores-switches: `reset()` turns every driver
// switch back on.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`, "The
// driver switches": "each is restored to on by `reset`", and `reset()`:
// "every driver switch on". `specs/state.md`: the nine "each `true` from
// `initialize` and after `reset`".
//
// THE POSE. `isolate` turns all nine off, which the check reads back before
// posing anything else; `reset` is the whole operation under test, read back
// before any frame.

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

it("leaves all nine switches true after reset from all nine false", async () => {
  const off = isolate(h);
  assertDeepEqual(
    Object.values(switchesOf(off)),
    SWITCH_NAMES.map(() => false),
    "the nine switches posed off before reset",
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
      drops: true,
      progression: true,
    },
    "the nine switches after reset",
  );
});
