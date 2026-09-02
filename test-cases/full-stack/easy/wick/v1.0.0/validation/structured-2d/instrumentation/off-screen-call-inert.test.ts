// Wick — instrumentation/off-screen-call-inert: a run-screen operation called
// off a run screen changes nothing.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`, "The
// operations": "A call on a screen the operation does not apply to leaves the
// state exactly as it was, and each operation names the screens it applies
// to. 'A run screen' below means `playing` or `paused`." `setHp`, `setTick`,
// and `setWeapon` apply on a run screen and `spawnEnemy` on `playing` and
// `paused`, none of them on `title`; `setPlayerPosition` applies on a run
// screen, not on `levelup`.
//
// THE POSES. The title reached by `reset`, four calls, the whole snapshot
// compared with the one before them; then an isolated run with the overlay
// opened by the real tick, one call, the same comparison.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  isolate,
  openLevelUp,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("leaves the state as it was on title and on levelup", async () => {
  h.reset();
  const title = h.snapshot();
  h.debug.setHp(10);
  h.debug.spawnEnemy("moth", 0, 0);
  h.debug.setTick(100);
  h.debug.setWeapon(0, "pin", 1);
  assertDeepEqual(
    h.snapshot(),
    title,
    "snapshot after four run-screen calls on title",
  );

  isolate(h);
  const overlay = await openLevelUp(h, 1);
  assertEqual(overlay.screen, "levelup", "screen before the call");
  h.debug.setPlayerPosition(5, 5);
  const after = h.snapshot();
  await h.frameDraw();
  captureStill(h, "inert");
  assertDeepEqual(
    after,
    overlay,
    "snapshot after setPlayerPosition on levelup",
  );
});
